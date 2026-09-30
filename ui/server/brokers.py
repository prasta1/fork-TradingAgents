"""One shape for two brokerages.

Public.com and E*TRADE describe an account very differently — different field
names, different nesting, different order lifecycles. The console's screens
should not care, so everything is normalised here and the rest of the server
talks only in these dicts.

The order flow is deliberately identical for both: ``preflight`` returns a
``token`` that ``place`` requires. Public does not need one, but E*TRADE will
not accept an order that was not previewed, so threading a token through makes
review-before-submit structural rather than a UI convention.
"""

from __future__ import annotations

from datetime import UTC, datetime

from .etrade_client import (
    ETradeAPIError,
    ETradeClient,
    ETradeNotAuthorized,
    ETradeNotConfigured,
)
from .public_client import PublicAPIError, PublicClient, PublicNotConfigured


class BrokerError(RuntimeError):
    """A broker call failed. ``status`` mirrors the HTTP code to return."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _f(value) -> float | None:
    """Both APIs return numerics as strings in places."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _derive_allocation(positions: list[dict], cash: float | None) -> list[dict]:
    """Group holdings by instrument type, plus cash, as percentages of total.

    Used when a broker gives no allocation breakdown of its own.
    """
    buckets: dict[str, float] = {}
    for position in positions:
        label = {"EQ": "Equities", "OPTN": "Options", "MF": "Mutual funds", "MMF": "Cash"}.get(
            position.get("type") or "", position.get("type") or "Other"
        )
        buckets[label] = buckets.get(label, 0.0) + (position.get("value") or 0.0)
    if cash:
        buckets["Cash"] = buckets.get("Cash", 0.0) + cash

    total = sum(buckets.values())
    if not total:
        return []
    return [
        {"k": k, "v": v, "pct": round(v / total * 100, 2)}
        for k, v in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    ]


class Broker:
    """Interface the console's routes are written against."""

    name: str
    label: str

    @property
    def configured(self) -> bool:
        raise NotImplementedError

    @property
    def connected(self) -> bool:
        """Configured *and* holding valid credentials to call the API."""
        raise NotImplementedError

    def portfolio(self) -> dict: ...
    def quotes(self, symbols: list[str]) -> dict[str, dict]: ...
    def preflight(self, order: dict) -> dict: ...
    def place(self, order: dict, token: dict | None) -> dict: ...
    def order_status(self, order_id: str) -> dict: ...
    def cancel(self, order_id: str) -> None: ...
    def activity(self) -> list[dict]: ...


def _activity_row(date, symbol, action, qty, price, amount, description) -> dict:
    """One normalised account transaction, the shape every activity source returns."""
    qty = abs(qty) if qty is not None else None
    if price is None and qty and amount is not None:
        price = abs(amount) / qty
    return {
        "date": date,
        "symbol": (symbol or "").upper(),
        "action": (action or "").upper(),
        "qty": qty,
        "price": round(price, 4) if price is not None else None,
        "amount": amount,
        "description": description or "",
    }


class PublicBroker(Broker):
    name = "public"
    label = "Public.com"

    def __init__(self, client: PublicClient | None = None):
        self.client = client or PublicClient()

    @property
    def configured(self) -> bool:
        return self.client.configured

    @property
    def connected(self) -> bool:
        # A secret is all Public needs; the token exchange is unattended.
        return self.client.configured

    def _call(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except PublicNotConfigured as exc:
            raise BrokerError(str(exc), status=503) from exc
        except PublicAPIError as exc:
            raise BrokerError(str(exc), status=502) from exc

    def portfolio(self) -> dict:
        raw = self._call(self.client.portfolio)
        positions = []
        daily_change = 0.0
        for pos in raw.get("positions", []):
            instrument = pos.get("instrument", {})
            gain = pos.get("instrumentGain") or {}
            daily = _f((pos.get("positionDailyGain") or {}).get("gainValue"))
            if daily is not None:
                daily_change += daily
            positions.append(
                {
                    "sym": (instrument.get("symbol") or "").upper(),
                    "name": instrument.get("name") or instrument.get("symbol") or "",
                    "type": instrument.get("type") or "EQ",
                    "qty": _f(pos.get("quantity")),
                    "cost": _f((pos.get("costBasis") or {}).get("unitCost")),
                    "price": _f((pos.get("lastPrice") or {}).get("lastPrice")),
                    "value": _f(pos.get("currentValue")),
                    "pl": _f(gain.get("gainValue")),
                    "pl_pct": _f(gain.get("gainPercentage")),
                }
            )

        nav = _f(raw.get("totalAccountValue"))
        prior = (nav - daily_change) if nav is not None else None
        allocation = [
            {
                "k": (row.get("type") or "").replace("_", " ").title(),
                "v": _f(row.get("value")),
                "pct": _f(row.get("percentageOfPortfolio")),
            }
            for row in raw.get("equity", [])
        ]
        return {
            "broker": self.name,
            "account_id": raw.get("accountId"),
            "account_type": raw.get("accountType"),
            "nav": nav,
            "cash": _f(raw.get("cash")),
            "buying_power": _f((raw.get("buyingPower") or {}).get("buyingPower")),
            "daily_change": round(daily_change, 2),
            "daily_change_pct": round(daily_change / prior * 100, 2) if prior else None,
            "positions": sorted(positions, key=lambda p: p["value"] or 0, reverse=True),
            "allocation": allocation or _derive_allocation(positions, _f(raw.get("cash"))),
        }

    def quotes(self, symbols: list[str]) -> dict[str, dict]:
        raw = self._call(self.client.quotes, symbols)
        return {
            sym: {
                "last": _f(q.get("last")),
                "bid": _f(q.get("bid")),
                "ask": _f(q.get("ask")),
                "bid_size": q.get("bidSize"),
                "ask_size": q.get("askSize"),
                "volume": q.get("volume"),
                "previous_close": _f(q.get("previousClose")),
                "change_pct": _f((q.get("oneDayChange") or {}).get("percentChange")),
            }
            for sym, q in raw.items()
        }

    def preflight(self, order: dict) -> dict:
        raw = self._call(self.client.preflight, **_public_order(order))
        fees = raw.get("regulatoryFees") or {}
        return {
            "order_value": _f(raw.get("orderValue")),
            "commission": _f(raw.get("estimatedCommission")),
            "fees": (_f(fees.get("secFee")) or 0) + (_f(fees.get("tafFee")) or 0),
            "estimated_cost": _f(raw.get("estimatedCost")),
            "estimated_quantity": raw.get("estimatedQuantity"),
            "buying_power_requirement": _f(raw.get("buyingPowerRequirement")),
            "token": None,  # Public accepts an order without a preview handle.
        }

    def place(self, order: dict, token: dict | None) -> dict:
        raw = self._call(self.client.place_order, **_public_order(order))
        return {"order_id": raw["orderId"]}

    def order_status(self, order_id: str) -> dict:
        raw = self._call(self.client.order_status, order_id)
        return {
            "order_id": raw.get("orderId", order_id),
            "status": raw.get("status"),
            "side": raw.get("side"),
            "quantity": raw.get("quantity"),
            "filled_quantity": raw.get("filledQuantity"),
            "average_price": _f(raw.get("averagePrice")),
        }

    def cancel(self, order_id: str) -> None:
        self._call(self.client.cancel_order, order_id)

    def activity(self) -> list[dict]:
        # Public's default window is short; ask for everything since the
        # account could have opened.
        raw = self._call(self.client.history, "2000-01-01T00:00:00Z")
        return [
            _activity_row(
                date=(t.get("timestamp") or "")[:10],
                symbol=t.get("symbol"),
                # Trades carry a side; everything else (dividends, deposits,
                # fees) is identified by its subtype.
                action=t.get("side") if t.get("type") == "TRADE" else (t.get("subType") or t.get("type")),
                qty=_f(t.get("quantity")),
                price=None,
                amount=_f(t.get("netAmount")),
                description=t.get("description"),
            )
            for t in raw
        ]


def _public_order(order: dict) -> dict:
    """Console order -> PublicClient kwargs."""
    return {
        "symbol": order["symbol"],
        "side": order["side"],
        "quantity": order["quantity"],
        "order_type": order["order_type"],
        "limit_price": order.get("limit_price"),
        "stop_price": order.get("stop_price"),
        "time_in_force": order.get("time_in_force", "DAY"),
    }


class ETradeBroker(Broker):
    name = "etrade"
    label = "E*TRADE"

    def __init__(self, client: ETradeClient | None = None):
        self.client = client or ETradeClient()

    @property
    def configured(self) -> bool:
        return self.client.configured

    @property
    def connected(self) -> bool:
        # A consumer key is not enough — the user must have authorized today.
        return self.client.configured and self.client.authorized

    def _call(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ETradeNotConfigured as exc:
            raise BrokerError(str(exc), status=503) from exc
        except ETradeNotAuthorized as exc:
            raise BrokerError(str(exc), status=401) from exc
        except ETradeAPIError as exc:
            raise BrokerError(str(exc), status=502) from exc

    def portfolio(self) -> dict:
        raw_positions = self._call(self.client.portfolio)
        balance = self._call(self.client.balance)

        positions = []
        daily_change = 0.0
        for pos in raw_positions:
            product = pos.get("Product") or {}
            daily = _f(pos.get("daysGain"))
            if daily is not None:
                daily_change += daily
            positions.append(
                {
                    "sym": (product.get("symbol") or "").upper(),
                    "name": pos.get("symbolDescription") or product.get("symbol") or "",
                    "type": product.get("securityType") or "EQ",
                    "qty": _f(pos.get("quantity")),
                    "cost": _f(pos.get("pricePaid")),
                    "price": _f((pos.get("Quick") or {}).get("lastTrade")),
                    "value": _f(pos.get("marketValue")),
                    "pl": _f(pos.get("totalGain")),
                    "pl_pct": _f(pos.get("totalGainPct")),
                }
            )

        computed = balance.get("Computed") or {}
        realtime = computed.get("RealTimeValues") or {}
        nav = _f(realtime.get("totalAccountValue"))
        cash = _f(computed.get("cashAvailableForInvestment"))
        buying_power = _f(computed.get("cashBuyingPower")) or _f(computed.get("marginBuyingPower"))
        prior = (nav - daily_change) if nav is not None else None

        return {
            "broker": self.name,
            "account_id": balance.get("accountId"),
            "account_type": balance.get("accountType"),
            "nav": nav,
            "cash": cash,
            "buying_power": buying_power,
            "daily_change": round(daily_change, 2),
            "daily_change_pct": round(daily_change / prior * 100, 2) if prior else None,
            "positions": sorted(positions, key=lambda p: p["value"] or 0, reverse=True),
            # E*TRADE has no allocation breakdown of its own.
            "allocation": _derive_allocation(positions, cash),
        }

    def quotes(self, symbols: list[str]) -> dict[str, dict]:
        raw = self._call(self.client.quotes, symbols)
        out = {}
        for sym, quote in raw.items():
            all_ = quote.get("All") or {}
            out[sym] = {
                "last": _f(all_.get("lastTrade")),
                "bid": _f(all_.get("bid")),
                "ask": _f(all_.get("ask")),
                "bid_size": all_.get("bidSize"),
                "ask_size": all_.get("askSize"),
                "volume": all_.get("totalVolume"),
                "previous_close": _f(all_.get("previousClose")),
                "change_pct": _f(all_.get("changeClosePercentage")),
            }
        return out

    def preflight(self, order: dict) -> dict:
        raw = self._call(self.client.preview_order, **_etrade_order(order))
        preview_ids = raw.get("PreviewIds") or []
        orders = raw.get("Order") or [{}]
        first = orders[0]
        return {
            "order_value": _f(first.get("estimatedTotalAmount")),
            "commission": _f(first.get("estimatedCommission")),
            "fees": _f(first.get("estimatedFees")) or 0,
            "estimated_cost": _f(first.get("estimatedTotalAmount")),
            "estimated_quantity": order.get("quantity"),
            "buying_power_requirement": None,
            # Placing requires the preview handle E*TRADE just issued.
            "token": {
                "preview_id": (preview_ids[0] or {}).get("previewId") if preview_ids else None,
                "client_order_id": raw.get("clientOrderId"),
            },
        }

    def place(self, order: dict, token: dict | None) -> dict:
        if not token or not token.get("preview_id"):
            raise BrokerError(
                "E*TRADE requires a preview before placing — review the order first",
                status=409,
            )
        raw = self._call(
            self.client.place_order,
            token["preview_id"],
            token.get("client_order_id") or "",
            **_etrade_order(order),
        )
        orders = raw.get("OrderIds") or []
        order_id = (orders[0] or {}).get("orderId") if orders else raw.get("orderId")
        return {"order_id": str(order_id)}

    def order_status(self, order_id: str) -> dict:
        matches = self._call(self.client.orders, order_id)
        if not matches:
            return {"order_id": order_id, "status": "UNKNOWN"}
        detail = (matches[0].get("OrderDetail") or [{}])[0]
        instrument = (detail.get("Instrument") or [{}])[0]
        return {
            "order_id": str(matches[0].get("orderId", order_id)),
            "status": detail.get("status"),
            "side": instrument.get("orderAction"),
            "quantity": instrument.get("orderedQuantity"),
            "filled_quantity": instrument.get("filledQuantity"),
            "average_price": _f(instrument.get("averageExecutionPrice")),
        }

    def cancel(self, order_id: str) -> None:
        self._call(self.client.cancel_order, order_id)

    def activity(self) -> list[dict]:
        rows = []
        for t in self._call(self.client.transactions):
            brokerage = t.get("brokerage") or {}
            epoch_ms = t.get("transactionDate")
            rows.append(
                _activity_row(
                    date=(
                        datetime.fromtimestamp(epoch_ms / 1000, tz=UTC).strftime("%Y-%m-%d")
                        if epoch_ms
                        else ""
                    ),
                    symbol=(brokerage.get("product") or {}).get("symbol") or brokerage.get("displaySymbol"),
                    action=t.get("transactionType"),
                    qty=_f(brokerage.get("quantity")),
                    price=_f(brokerage.get("price")),
                    amount=_f(t.get("amount")),
                    description=t.get("description"),
                )
            )
        return rows


def _etrade_order(order: dict) -> dict:
    """Console order -> ETradeClient kwargs."""
    return {
        "symbol": order["symbol"],
        "side": order["side"],
        "quantity": order["quantity"],
        "order_type": order["order_type"],
        "limit_price": order.get("limit_price"),
        "stop_price": order.get("stop_price"),
        "time_in_force": order.get("time_in_force", "DAY"),
    }


class BrokerRegistry:
    """Holds both brokers and which one the console is pointed at."""

    def __init__(self):
        self._brokers: dict[str, Broker] = {
            "public": PublicBroker(),
            "etrade": ETradeBroker(),
        }
        # Default to whichever is actually usable, preferring Public since it
        # needs no interactive authorization.
        self._active = next(
            (name for name, b in self._brokers.items() if b.connected), "public"
        )

    def get(self, name: str) -> Broker:
        broker = self._brokers.get(name)
        if not broker:
            raise BrokerError(f"unknown broker: {name}", status=404)
        return broker

    @property
    def active(self) -> Broker:
        return self._brokers[self._active]

    @property
    def active_name(self) -> str:
        return self._active

    def set_active(self, name: str) -> Broker:
        broker = self.get(name)
        self._active = name
        return broker

    def status(self) -> list[dict]:
        """Per-broker connection state for Settings and the broker picker."""
        return [
            {
                "name": b.name,
                "label": b.label,
                "configured": b.configured,
                "connected": b.connected,
                "active": name == self._active,
                # Only E*TRADE needs a user-interactive authorization step.
                "needs_authorization": b.configured and not b.connected,
            }
            for name, b in self._brokers.items()
        ]

    def any_connected(self) -> bool:
        return any(b.connected for b in self._brokers.values())
