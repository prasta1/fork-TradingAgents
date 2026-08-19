"""Wealthfront scorecard: real executed trades vs agent ratings.

Loads a Wealthfront QFX export (transaction-level), resolves CUSIPs to
tickers, and lines each discretionary trade (buystock/sellstock) up against
the agent's rating for that ticker around the trade date. The result is a
"did the AI agree with what Wealthfront actually did" scorecard.

The QFX file is a snapshot the user exports from Wealthfront (Documents ->
Export to Quicken). Nothing here reaches out to Wealthfront at runtime.
"""

from __future__ import annotations

import os
from pathlib import Path

from ofxparse import OfxParser

from tradingagents.default_config import DEFAULT_CONFIG

from . import history

# Where the most recent QFX export lives. Overridable via env for testing.
QFX_PATH = Path(os.getenv("WEALTHFRONT_QFX", "~/Downloads/2025.QFX")).expanduser()

# Trade types the agents can have an opinion on. Everything else (buymf,
# dividends, fees, transfers, reinvests) is money-market plumbing or cash
# motion, not a discretionary equity decision.
_DISCRETIONARY = {"buystock", "sellstock"}

# Ratings that read as a directional opinion.
_BULLISH = {"buy", "overweight", "strong buy", "bullish"}
_BEARISH = {"sell", "underweight", "strong sell", "bearish"}
_HOLDISH = {"hold", "neutral", "market weight", "equal weight"}


def load_transactions(qfx_path: Path | None = None) -> tuple[list[dict], str | None]:
    """Parse a Wealthfront QFX export into normalised trade rows.

    Returns (trades, error) — error is set when the file is missing or
    unparseable, so the UI can show a friendly "export it from Wealthfront"
    message instead of crashing.
    """
    path = qfx_path or QFX_PATH
    if not path.exists():
        return [], f"No QFX export at {path} — export it from Wealthfront (Documents → Export to Quicken)."

    try:
        with open(path, "rb") as f:
            ofx = OfxParser.parse(f)
    except Exception as exc:
        return [], f"Could not parse {path}: {exc}"

    # CUSIP -> (ticker, name)
    sec_map: dict[str, tuple[str, str]] = {}
    for sec in ofx.security_list or []:
        ticker = (sec.ticker or sec.uniqueid).upper()
        sec_map[sec.uniqueid] = (ticker, sec.name or ticker)

    trades = []
    for account in ofx.accounts:
        stmt = account.statement
        if stmt is None:
            continue
        for txn in stmt.transactions:
            if txn.type not in _DISCRETIONARY:
                continue
            cusip = getattr(txn, "security", "")
            ticker, name = sec_map.get(cusip, (cusip.upper(), cusip.upper()))
            date = (txn.tradeDate or txn.settleDate)
            trades.append({
                "date": date.strftime("%Y-%m-%d") if date else "",
                "symbol": ticker,
                "name": name,
                "action": "BUY" if txn.type == "buystock" else "SELL",
                "units": abs(float(txn.units or 0)),
                "unit_price": float(txn.unit_price) if txn.unit_price else None,
                "total": float(txn.total) if txn.total else None,
                "fitid": getattr(txn, "id", None),
            })

    trades.sort(key=lambda t: t["date"], reverse=True)
    return trades, None


def scorecard(config: dict | None = None) -> dict:
    """Trades joined to the agent rating in effect at the trade date."""
    trades, error = load_transactions()
    if error:
        return {"error": error, "trades": [], "summary": {}}

    # Ratings from the memory log, newest first per ticker.
    ratings = history.entries(config)

    def rating_at(symbol: str, date: str) -> dict | None:
        """Closest agent rating for this symbol at or before the trade date."""
        best = None
        for entry in ratings:
            if entry["ticker"].upper() != symbol.upper():
                continue
            if entry["date"] > date:
                continue
            if best is None or entry["date"] > best["date"]:
                best = entry
        return best

    rows = []
    for trade in trades:
        rating = rating_at(trade["symbol"], trade["date"])
        ai_rating = (rating or {}).get("rating", "")
        ai_date = (rating or {}).get("date", "")
        ai_note = (rating or {}).get("reflection", "") or (rating or {}).get("decision", "")
        agreement = classify(trade["action"], ai_rating)
        rows.append({
            **trade,
            "ai_rating": ai_rating or None,
            "ai_date": ai_date or None,
            "ai_note": (ai_note or "")[:240],
            "agreement": agreement,
        })

    # Summary stats.
    counted = [r for r in rows if r["agreement"] in ("agree", "disagree")]
    agrees = sum(1 for r in counted if r["agreement"] == "agree")
    summary = {
        "total_trades": len(rows),
        "counted": len(counted),
        "agree": agrees,
        "disagree": len(counted) - agrees,
        "no_rating": sum(1 for r in rows if not r["ai_rating"]),
        "agree_pct": round(agrees / len(counted) * 100) if counted else None,
    }
    return {"error": None, "trades": rows, "summary": summary}


def classify(action: str, rating: str) -> str:
    """Agree / disagree / neutral / unrated for a trade vs a rating."""
    rating_norm = (rating or "").strip().lower()
    if not rating_norm:
        return "unrated"
    if action == "BUY":
        if rating_norm in _BULLISH:
            return "agree"
        if rating_norm in _BEARISH:
            return "disagree"
        return "neutral"
    # SELL
    if rating_norm in _BEARISH:
        return "agree"
    if rating_norm in _BULLISH:
        return "disagree"
    return "neutral"
