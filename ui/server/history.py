"""Run history and agent ratings, read from the markdown memory log.

``trading_memory.md`` is the system of record for what the agents decided and
how those decisions turned out — each run appends a ``pending`` entry, and the
next run on the same ticker resolves it with realised return, alpha and a
written reflection. The console's Run history screen is a view onto that file.
"""

from __future__ import annotations

from tradingagents.agents.utils.memory import TradingMemoryLog
from tradingagents.default_config import DEFAULT_CONFIG


def _log(config: dict | None = None) -> TradingMemoryLog:
    return TradingMemoryLog(config or DEFAULT_CONFIG)


def _as_float(value: str | None) -> float | None:
    """Numeric value behind a display string like ``+1.7%``.

    The memory log stores returns already formatted, so the console gets the
    string for display and this number only to decide the colour.
    """
    if not value or value == "n/a":
        return None
    try:
        return float(str(value).replace("%", "").replace("+", "").strip())
    except ValueError:
        return None


def entries(config: dict | None = None) -> list[dict]:
    """All memory-log entries, newest first."""
    raw = _log(config).load_entries()
    out = [
        {
            "date": e.get("date", ""),
            "ticker": e.get("ticker", ""),
            "rating": e.get("rating", "Hold"),
            "pending": bool(e.get("pending")),
            # Display strings as stored, plus numbers for colouring.
            "raw_return": e.get("raw"),
            "alpha": e.get("alpha"),
            "holding": e.get("holding"),
            "raw_return_value": _as_float(e.get("raw")),
            "alpha_value": _as_float(e.get("alpha")),
            "reflection": e.get("reflection", ""),
            "decision": e.get("decision", ""),
        }
        for e in raw
    ]
    out.sort(key=lambda e: e["date"], reverse=True)
    return out


def latest_by_ticker(config: dict | None = None) -> dict[str, dict]:
    """Most recent entry per ticker — the rating shown against each holding."""
    latest: dict[str, dict] = {}
    for entry in entries(config):
        symbol = entry["ticker"].upper()
        if symbol and symbol not in latest:
            latest[symbol] = entry
    return latest


def recent_decisions(limit: int = 4, config: dict | None = None) -> list[dict]:
    """Newest decisions for the dashboard's sidebar card."""
    out = []
    for entry in entries(config)[:limit]:
        # First sentence of the reflection, or of the decision when still pending.
        note = entry["reflection"] or entry["decision"]
        note = note.strip().split(". ")[0][:120] if note else ""
        out.append(
            {
                "sym": entry["ticker"],
                "rating": entry["rating"],
                "when": entry["date"],
                "note": note,
            }
        )
    return out
