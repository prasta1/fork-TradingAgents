"""Dashboard data: real brokerage positions joined to agent ratings.

Positions, cash, buying power and allocation come from whichever brokerage is
active (see :mod:`ui.server.brokers`) — this is an actual account, not a local
ledger. Ratings come from the memory log, which is where the agents record what
they decided and when.

The join is the point of the screen: a rating is pinned to the analysis date of
the run that produced it, so a holding whose newest headline postdates its
rating is flagged — no agent has read that story yet.
"""

from __future__ import annotations

from tradingagents.command_center.portfolio_store import PortfolioStore

from . import history, market
from .brokers import Broker


def dashboard(broker: Broker) -> dict:
    """Positions, NAV, allocation and agent ratings for the dashboard."""
    data = broker.portfolio()
    ratings = history.latest_by_ticker()

    for position in data["positions"]:
        rating = ratings.get(position["sym"])
        position["rating"] = rating["rating"] if rating else None
        position["rated_on"] = rating["date"] if rating else None

    data["recent_decisions"] = history.recent_decisions()
    return data


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
