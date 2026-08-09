"""E*TRADE brokerage API client.

Wraps the subset of https://developer.etrade.com the console needs: accounts,
balances, portfolio, quotes, and the preview/place/cancel order flow.

Two things differ materially from Public.com:

1. **OAuth 1.0a with a human in the loop.** There is no secret-for-token
   exchange. The user must visit an E*TRADE URL, log in, and copy back a
   verification code (the flow is out-of-band — E*TRADE displays the code
   rather than redirecting). So connecting is a two-call dance the console
   drives, not something the server can do unattended.

2. **Tokens expire daily.** An access token goes inactive after two hours idle
   and expires at midnight US/Eastern. The idle case is recoverable with a
   renew call; the midnight case requires the user to authorize again. Tokens
   are cached on disk so a server restart does not force re-authorization.

E*TRADE's own order flow is preview-then-place, where placing requires the
previewId returned by the preview. That maps exactly onto the console's
"Review order" then "Confirm" steps.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from requests_oauthlib import OAuth1Session

SANDBOX_BASE = "https://apisb.etrade.com"
PRODUCTION_BASE = "https://api.etrade.com"
AUTHORIZE_URL = "https://us.etrade.com/e/t/etws/authorize"

REQUEST_TIMEOUT = 30

CONSUMER_KEY_ENV = "ETRADE_CONSUMER_KEY"
CONSUMER_SECRET_ENV = "ETRADE_CONSUMER_SECRET"
SANDBOX_ENV = "ETRADE_SANDBOX"

# Access tokens survive a server restart but not the daily expiry.
TOKEN_PATH = Path(os.path.expanduser("~/.tradingagents/etrade_token.json"))


class ETradeNotConfigured(RuntimeError):
    """Raised when no E*TRADE consumer key is present in the environment."""


class ETradeNotAuthorized(RuntimeError):
    """Raised when there is no usable access token — the user must authorize."""


class ETradeAPIError(RuntimeError):
    """Raised when E*TRADE returns a non-2xx response."""

    def __init__(self, status: int, body: str):
        super().__init__(f"E*TRADE API error {status}: {body}")
        self.status = status
        self.body = body


class ETradeClient:
    """Thread-safe E*TRADE client with on-disk token caching."""

    def __init__(
        self,
        consumer_key: str | None = None,
        consumer_secret: str | None = None,
        sandbox: bool | None = None,
    ):
        self._key = consumer_key if consumer_key is not None else os.getenv(CONSUMER_KEY_ENV)
        self._secret = (
            consumer_secret if consumer_secret is not None else os.getenv(CONSUMER_SECRET_ENV)
        )
        if sandbox is None:
            sandbox = os.getenv(SANDBOX_ENV, "").lower() in ("1", "true", "yes")
        self.sandbox = sandbox
        self.base = SANDBOX_BASE if sandbox else PRODUCTION_BASE

        self._lock = threading.Lock()
        self._token: dict | None = None
        self._request_token: dict | None = None
        self._account_key: str | None = None
        self._load_token()

    # -- configuration ----------------------------------------------------

    @property
    def configured(self) -> bool:
        """True when a consumer key/secret pair is available."""
        return bool(self._key and self._secret)

    @property
    def authorized(self) -> bool:
        """True when a cached access token exists and has not expired."""
        with self._lock:
            return bool(self._token and time.time() < self._token.get("expires_at", 0))

    def _require_config(self) -> None:
        if not self.configured:
            raise ETradeNotConfigured(
                f"{CONSUMER_KEY_ENV} / {CONSUMER_SECRET_ENV} are not set — request a key at "
                "developer.etrade.com and add both to your .env"
            )

    # -- token persistence ------------------------------------------------

    def _load_token(self) -> None:
        try:
            data = json.loads(TOKEN_PATH.read_text())
        except (OSError, ValueError):
            return
        if data.get("sandbox") == self.sandbox and time.time() < data.get("expires_at", 0):
            self._token = data

    def _save_token(self, token: dict) -> None:
        token = {**token, "sandbox": self.sandbox}
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = TOKEN_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(token))
        tmp.replace(TOKEN_PATH)
        # The token grants account access; keep it off other users' eyes.
        TOKEN_PATH.chmod(0o600)
        self._token = token

    @staticmethod
    def _midnight_eastern_epoch() -> float:
        """Epoch seconds at the next US/Eastern midnight, when tokens expire."""
        from datetime import datetime, timedelta
        from zoneinfo import ZoneInfo

        eastern = ZoneInfo("America/New_York")
        now = datetime.now(eastern)
        tomorrow = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return tomorrow.timestamp()

    def disconnect(self) -> None:
        """Drop the cached token, requiring a fresh authorization."""
        with self._lock:
            self._token = None
            self._account_key = None
        TOKEN_PATH.unlink(missing_ok=True)

    # -- OAuth 1.0a flow --------------------------------------------------

    def start_authorization(self) -> str:
        """Get a request token and return the URL the user must visit.

        E*TRADE uses out-of-band authorization: the page shows a verification
        code that the user pastes back into :meth:`complete_authorization`.
        """
        self._require_config()
        session = OAuth1Session(self._key, client_secret=self._secret, callback_uri="oob")
        response = session.fetch_request_token(
            f"{self.base}/oauth/request_token", timeout=REQUEST_TIMEOUT
        )
        with self._lock:
            self._request_token = {
                "oauth_token": response.get("oauth_token"),
                "oauth_token_secret": response.get("oauth_token_secret"),
            }
        return f"{AUTHORIZE_URL}?key={self._key}&token={response.get('oauth_token')}"

    def complete_authorization(self, verifier: str) -> None:
        """Exchange the verification code for an access token."""
        self._require_config()
        with self._lock:
            pending = self._request_token
        if not pending:
            raise ETradeNotAuthorized("no authorization in progress — start one first")

        session = OAuth1Session(
            self._key,
            client_secret=self._secret,
            resource_owner_key=pending["oauth_token"],
            resource_owner_secret=pending["oauth_token_secret"],
            verifier=verifier.strip(),
        )
        token = session.fetch_access_token(
            f"{self.base}/oauth/access_token", timeout=REQUEST_TIMEOUT
        )
        self._save_token(
            {
                "oauth_token": token["oauth_token"],
                "oauth_token_secret": token["oauth_token_secret"],
                "expires_at": self._midnight_eastern_epoch(),
            }
        )
        with self._lock:
            self._request_token = None

    def _session(self) -> OAuth1Session:
        self._require_config()
        with self._lock:
            token = self._token
        if not token or time.time() >= token.get("expires_at", 0):
            raise ETradeNotAuthorized(
                "E*TRADE access token is missing or expired — reconnect from Settings"
            )
        return OAuth1Session(
            self._key,
            client_secret=self._secret,
            resource_owner_key=token["oauth_token"],
            resource_owner_secret=token["oauth_token_secret"],
        )

    def _renew(self) -> bool:
        """Reactivate a token that went idle. Returns False if unrecoverable."""
        try:
            self._session().get(
                f"{self.base}/oauth/renew_access_token", timeout=REQUEST_TIMEOUT
            )
            return True
        except (ETradeNotAuthorized, Exception):
            return False

    def _request(self, method: str, path: str, *, retry: bool = True, **kwargs) -> Any:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        response = self._session().request(
            method, f"{self.base}{path}", headers=headers, timeout=REQUEST_TIMEOUT, **kwargs
        )
        # A token idle for over two hours returns 401 until it is renewed.
        if response.status_code == 401 and retry and self._renew():
            return self._request(method, path, retry=False, **kwargs)
        if not response.ok:
            raise ETradeAPIError(response.status_code, response.text[:500])
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise ETradeAPIError(response.status_code, response.text[:500]) from exc

    # -- accounts ---------------------------------------------------------

    def accounts(self) -> list[dict]:
        """Brokerage accounts on this login."""
        data = self._request("GET", "/v1/accounts/list")
        listing = (data or {}).get("AccountListResponse", {}).get("Accounts", {})
        return listing.get("Account", []) or []

    def account_key(self) -> str:
        """The ``accountIdKey`` every other endpoint is scoped by.

        E*TRADE keys account URLs by an opaque ``accountIdKey``, not by the
        human-readable account number.
        """
        with self._lock:
            if self._account_key:
                return self._account_key

        accounts = [a for a in self.accounts() if a.get("accountStatus") != "CLOSED"]
        if not accounts:
            raise ETradeAPIError(200, "no open accounts returned for this login")
        chosen = next(
            (a for a in accounts if a.get("accountType") in ("INDIVIDUAL", "BROKERAGE")),
            accounts[0],
        )
        key = chosen["accountIdKey"]
        with self._lock:
            self._account_key = key
        return key

    def balance(self) -> dict:
        """Cash and buying power for the active account."""
        key = self.account_key()
        data = self._request(
            "GET",
            f"/v1/accounts/{key}/balance",
            params={"instType": "BROKERAGE", "realTimeNAV": "true"},
        )
        return (data or {}).get("BalanceResponse", {})

    def portfolio(self) -> list[dict]:
        """Open positions for the active account.

        Returns an empty list when the account holds nothing — E*TRADE answers
        204 for an empty portfolio rather than an empty collection.
        """
        key = self.account_key()
        try:
            data = self._request("GET", f"/v1/accounts/{key}/portfolio")
        except ETradeAPIError as exc:
            if exc.status == 204:
                return []
            raise
        if not data:
            return []
        accounts = (data.get("PortfolioResponse", {}) or {}).get("AccountPortfolio", [])
        positions: list[dict] = []
        for account in accounts:
            positions.extend(account.get("Position", []) or [])
        return positions

    # -- market data ------------------------------------------------------

    def quotes(self, symbols: list[str]) -> dict[str, dict]:
        """Quotes keyed by symbol, for up to 25 symbols per call."""
        if not symbols:
            return {}
        joined = ",".join(s.upper() for s in symbols[:25])
        data = self._request("GET", f"/v1/market/quote/{joined}")
        out = {}
        for quote in (data or {}).get("QuoteResponse", {}).get("QuoteData", []) or []:
            symbol = (quote.get("Product") or {}).get("symbol")
            if symbol:
                out[symbol.upper()] = quote
        return out

    # -- orders -----------------------------------------------------------

    @staticmethod
    def _order_payload(
        symbol: str,
        side: str,
        quantity: str,
        order_type: str,
        time_in_force: str = "DAY",
        limit_price: str | None = None,
        stop_price: str | None = None,
    ) -> dict:
        """Build the Order block shared by preview and place."""
        price_type = {"MARKET": "MARKET", "LIMIT": "LIMIT", "STOP": "STOP"}[order_type.upper()]
        order_term = {"DAY": "GOOD_FOR_DAY", "GTC": "GOOD_UNTIL_CANCEL"}.get(
            time_in_force.upper(), "GOOD_FOR_DAY"
        )
        return {
            "allOrNone": "false",
            "priceType": price_type,
            "orderTerm": order_term,
            "marketSession": "REGULAR",
            "stopPrice": str(stop_price) if stop_price else "",
            "limitPrice": str(limit_price) if limit_price else "",
            "Instrument": [
                {
                    "Product": {"securityType": "EQ", "symbol": symbol.upper()},
                    "orderAction": side.upper(),
                    "quantityType": "QUANTITY",
                    "quantity": str(quantity),
                }
            ],
        }

    def preview_order(self, **order) -> dict:
        """Validate and cost an order. Places nothing.

        The returned ``previewId`` is required to place — E*TRADE will not
        accept an order that was not previewed first.
        """
        key = self.account_key()
        body = {
            "PreviewOrderRequest": {
                "orderType": "EQ",
                "clientOrderId": uuid.uuid4().hex[:20],
                "Order": [self._order_payload(**order)],
            }
        }
        data = self._request("POST", f"/v1/accounts/{key}/orders/preview", json=body)
        return (data or {}).get("PreviewOrderResponse", {})

    def place_order(self, preview_id: str, client_order_id: str, **order) -> dict:
        """Submit a previously previewed order."""
        key = self.account_key()
        body = {
            "PlaceOrderRequest": {
                "orderType": "EQ",
                "clientOrderId": client_order_id,
                "PreviewIds": [{"previewId": preview_id}],
                "Order": [self._order_payload(**order)],
            }
        }
        data = self._request("POST", f"/v1/accounts/{key}/orders/place", json=body)
        return (data or {}).get("PlaceOrderResponse", {})

    def orders(self, order_id: str | None = None) -> list[dict]:
        """Recent orders, optionally filtered to one order id."""
        key = self.account_key()
        params = {"orderId": order_id} if order_id else {}
        try:
            data = self._request("GET", f"/v1/accounts/{key}/orders", params=params)
        except ETradeAPIError as exc:
            if exc.status == 204:
                return []
            raise
        return ((data or {}).get("OrdersResponse", {}) or {}).get("Order", []) or []

    def cancel_order(self, order_id: str) -> dict:
        """Cancel a working order."""
        key = self.account_key()
        body = {"CancelOrderRequest": {"orderId": int(order_id)}}
        data = self._request("PUT", f"/v1/accounts/{key}/orders/cancel", json=body)
        return (data or {}).get("CancelOrderResponse", {})
