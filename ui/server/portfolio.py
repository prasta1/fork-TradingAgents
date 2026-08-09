"""Dashboard data: real brokerage positions joined to agent ratings.

Positions, cash, buying power and allocation come from Public.com — this is the
actual account, not a local ledger. Ratings come from the memory log, which is
where the agents record what they decided and when.

The join is the point of the screen: a rating is pinned to the analysis date of
the run that produced it, so a holding whose newest headline postdates its
rating is flagged — no agent has read that story yet.
"""

from __future__ import annotations

from tradingagents.command_center.portfolio_store import PortfolioStore

from . import history, market
from .public_client import PublicClient


def _f(value) -> float | None:
    """Public returns numerics as strings."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def dashboard(client: PublicClient) -> dict:
    """Positions, NAV, allocation and agent ratings for the dashboard."""
    raw = client.portfolio()
    ratings = history.latest_by_ticker()

    positions = []
    daily_change = 0.0
    for pos in raw.get("positions", []):
        instrument = pos.get("instrument", {})
        symbol = (instrument.get("symbol") or "").upper()
        cost = pos.get("costBasis") or {}
        gain = pos.get("instrumentGain") or {}
        daily = _f((pos.get("positionDailyGain") or {}).get("gainValue"))
        if daily is not None:
            daily_change += daily
        rating = ratings.get(symbol)

        positions.append(
            {
                "sym": symbol,
                "name": instrument.get("name") or symbol,
                "type": instrument.get("type") or "EQUITY",
                "qty": _f(pos.get("quantity")),
                "cost": _f(cost.get("unitCost")),
                "price": _f((pos.get("lastPrice") or {}).get("lastPrice")),
                "value": _f(pos.get("currentValue")),
                "pl": _f(gain.get("gainValue")),
                "pl_pct": _f(gain.get("gainPercentage")),
                "pct_of_portfolio": _f(pos.get("percentOfPortfolio")),
                "rating": rating["rating"] if rating else None,
                "rated_on": rating["date"] if rating else None,
            }
        )

    positions.sort(key=lambda p: p["value"] or 0, reverse=True)
    buying_power = raw.get("buyingPower") or {}
    nav = _f(raw.get("totalAccountValue"))
    # Daily move as a percentage of yesterday's close-equivalent value.
    prior = (nav - daily_change) if nav is not None else None
    daily_pct = (daily_change / prior * 100) if prior else None

    return {
        "account_id": raw.get("accountId"),
        "account_type": raw.get("accountType"),
        "nav": nav,
        "daily_change": round(daily_change, 2),
        "daily_change_pct": round(daily_pct, 2) if daily_pct is not None else None,
        "cash": _f(raw.get("cash")),
        "buying_power": _f(buying_power.get("buyingPower")),
        "positions": positions,
        "allocation": [
            {
                "k": (row.get("type") or "").replace("_", " ").title(),
                "v": _f(row.get("value")),
                "pct": _f(row.get("percentageOfPortfolio")),
            }
            for row in raw.get("equity", [])
        ],
        "recent_decisions": history.recent_decisions(),
    }


def position_headlines(symbols: list[str]) -> list[dict]:
    """One live headline per holding, flagged when it postdates the rating.

    Fetched separately from :func:`dashboard` so the positions table paints
    immediately — these are one network round-trip per symbol.
    """
    ratings = history.latest_by_ticker()
    out = []
    for symbol in symbols:
        headline = market.ticker_headline(symbol)
        if not headline:
            continue
        published = headline.get("published")
        rated_on = (ratings.get(symbol.upper()) or {}).get("date")
        # Rating dates are plain YYYY-MM-DD; compare on the date prefix.
        headline["flag"] = (
            "postdates rating" if published and rated_on and published[:10] > rated_on else ""
        )
        out.append(headline)
    return out


def watchlist(store: PortfolioStore) -> list[str]:
    """Local watchlist — a console concept, not something the broker tracks."""
    return store.get_watchlist()
