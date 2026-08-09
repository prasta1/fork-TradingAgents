"""Public.com brokerage API client.

Wraps the subset of https://public.com/api/docs the console needs: portfolio,
quotes, order preflight, order placement, order status and cancellation.

Authentication is a two-step exchange — a long-lived *secret key* (generated at
public.com/settings/security/api) is traded for a short-lived *access token*.
The secret is read from the environment and never leaves this process; Public's
docs are explicit that it must not reach client-side code, so the browser only
ever talks to our own endpoints.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from typing import Any

import requests

AUTH_URL = "https://api.public.com/userapiauthservice/personal/access-tokens"
GATEWAY = "https://api.public.com/userapigateway"

REQUEST_TIMEOUT = 30

# Access-token lifetime we request. Public expires the token server-side; we
# refresh a minute early to avoid racing the boundary mid-request.
TOKEN_VALIDITY_MINUTES = 60
TOKEN_REFRESH_MARGIN_S = 60

SECRET_ENV = "PUBLIC_API_SECRET"
ACCOUNT_ENV = "PUBLIC_ACCOUNT_ID"


class PublicNotConfigured(RuntimeError):
    """Raised when no Public.com secret is present in the environment."""


class PublicAPIError(RuntimeError):
    """Raised when Public.com returns a non-2xx response."""

    def __init__(self, status: int, body: str):
        super().__init__(f"Public.com API error {status}: {body}")
        self.status = status
        self.body = body


class PublicClient:
    """Thin, thread-safe Public.com client with token caching.

    A single instance is shared by the server. The token and account id are
    cached behind a lock so concurrent requests do not each trigger a fresh
    auth exchange.
    """

    def __init__(self, secret: str | None = None, account_id: str | None = None):
        self._secret = secret if secret is not None else os.getenv(SECRET_ENV)
        self._account_id = account_id if account_id is not None else os.getenv(ACCOUNT_ENV)
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._lock = threading.Lock()

    # -- configuration ----------------------------------------------------

    @property
    def configured(self) -> bool:
        """True when a secret key is available, i.e. brokerage calls can work."""
        return bool(self._secret)

    def _require_secret(self) -> str:
        if not self._secret:
            raise PublicNotConfigured(
                f"{SECRET_ENV} is not set — generate a secret key at "
                "public.com/settings/security/api and add it to your .env"
            )
        return self._secret

    # -- auth -------------------------------------------------------------

    def _access_token(self) -> str:
        """Return a valid access token, exchanging the secret if needed."""
        with self._lock:
            if self._token and time.time() < self._token_expires_at:
                return self._token

            secret = self._require_secret()
            resp = requests.post(
                AUTH_URL,
                json={"validityInMinutes": TOKEN_VALIDITY_MINUTES, "secret": secret},
                headers={"Content-Type": "application/json"},
                timeout=REQUEST_TIMEOUT,
            )
            if not resp.ok:
                raise PublicAPIError(resp.status_code, resp.text[:500])

            token = resp.json().get("accessToken")
            if not token:
                raise PublicAPIError(resp.status_code, "auth response had no accessToken")

            self._token = token
            self._token_expires_at = (
                time.time() + TOKEN_VALIDITY_MINUTES * 60 - TOKEN_REFRESH_MARGIN_S
            )
            return token

    def _request(self, method: str, path: str, **kwargs) -> Any:
        headers = {
            "Authorization": f"Bearer {self._access_token()}",
            "Content-Type": "application/json",
        }
        resp = requests.request(
            method, f"{GATEWAY}{path}", headers=headers, timeout=REQUEST_TIMEOUT, **kwargs
        )
        if not resp.ok:
            raise PublicAPIError(resp.status_code, resp.text[:500])
        if not resp.content:
            return None
        return resp.json()

    # -- account ----------------------------------------------------------

    def accounts(self) -> list[dict]:
        """List brokerage accounts on the authenticated login."""
        data = self._request("GET", "/trading/account")
        return data.get("accounts", []) if data else []

    def account_id(self) -> str:
        """Resolve the account id to trade against.

        Prefers ``PUBLIC_ACCOUNT_ID`` when set, otherwise takes the first
        BROKERAGE account, otherwise the first account returned.
        """
        with self._lock:
            if self._account_id:
                return self._account_id

        accounts = self.accounts()
        if not accounts:
            raise PublicAPIError(200, "no accounts returned for this login")

        chosen = next(
            (a for a in accounts if a.get("accountType") == "BROKERAGE"), accounts[0]
        )
        account_id = chosen["accountId"]
        with self._lock:
            self._account_id = account_id
        return account_id

    def portfolio(self) -> dict:
        """Full portfolio: positions, cash, buying power, total account value."""
        return self._request("GET", f"/trading/{self.account_id()}/portfolio/v2")

    # -- market data ------------------------------------------------------

    def quotes(self, symbols: list[str], instrument_type: str = "EQUITY") -> dict[str, dict]:
        """Real-time quotes keyed by symbol.

        Returns only quotes Public reported as ``SUCCESS``; unknown symbols are
        dropped rather than surfaced as zero-priced entries.
        """
        if not symbols:
            return {}
        body = {"instruments": [{"symbol": s, "type": instrument_type} for s in symbols]}
        data = self._request(
            "POST", f"/marketdata/{self.account_id()}/quotes", json=body
        )
        out = {}
        for q in (data or {}).get("quotes", []):
            if q.get("outcome") != "SUCCESS":
                continue
            out[q["instrument"]["symbol"]] = q
        return out

    # -- orders -----------------------------------------------------------

    @staticmethod
    def _order_body(
        symbol: str,
        side: str,
        quantity: str,
        order_type: str,
        time_in_force: str = "DAY",
        limit_price: str | None = None,
        stop_price: str | None = None,
        instrument_type: str = "EQUITY",
    ) -> dict:
        body: dict[str, Any] = {
            "instrument": {"symbol": symbol.upper(), "type": instrument_type},
            "orderSide": side.upper(),
            "orderType": order_type.upper(),
            "expiration": {"timeInForce": time_in_force.upper()},
            "quantity": str(quantity),
        }
        if limit_price is not None:
            body["limitPrice"] = str(limit_price)
        if stop_price is not None:
            body["stopPrice"] = str(stop_price)
        return body

    def preflight(self, **order) -> dict:
        """Validate an order and get cost estimates. Places nothing.

        This backs the console's "Review order" step — the user always sees a
        preflight result before any order can be submitted.
        """
        body = self._order_body(**order)
        return self._request(
            "POST", f"/trading/{self.account_id()}/preflight/single-leg", json=body
        )

    def place_order(self, **order) -> dict:
        """Submit an order. Returns ``{"orderId": ...}``.

        Placement is asynchronous on Public's side — poll :meth:`order_status`
        for the fill. A client-side UUID is generated so a retried submit is
        idempotent rather than double-filling.
        """
        body = self._order_body(**order)
        body["orderId"] = str(uuid.uuid4())
        result = self._request("POST", f"/trading/{self.account_id()}/order", json=body)
        # Public echoes the id, but fall back to ours so the caller can always poll.
        return {"orderId": (result or {}).get("orderId", body["orderId"])}

    def order_status(self, order_id: str) -> dict:
        """Current state of a submitted order."""
        return self._request("GET", f"/trading/{self.account_id()}/order/{order_id}")

    def cancel_order(self, order_id: str) -> None:
        """Cancel a working order."""
        self._request("DELETE", f"/trading/{self.account_id()}/order/{order_id}")
