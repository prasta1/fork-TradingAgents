"""Persistent portfolio and watchlist storage for the Command Center.

Stores portfolio positions and watchlist tickers as a JSON file so the
command center survives app restarts. Each portfolio entry tracks the
ticker, shares held, entry price, and whether it belongs to the active
portfolio (vs. just the watchlist).

The store is intentionally simple — a single JSON file with two top-level
keys: ``portfolio`` and ``watchlist``. No migrations, no schema evolution.
If you need something heavier, use the memory log or a real DB.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_STORE_PATH = os.path.expanduser(
    "~/.tradingagents/command_center_portfolio.json"
)


def _default_store() -> dict:
    return {"portfolio": [], "watchlist": []}


class PortfolioStore:
    """JSON-backed portfolio + watchlist store."""

    def __init__(self, path: str | None = None):
        self.path = Path(path or DEFAULT_STORE_PATH)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write(_default_store())

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (json.JSONDecodeError, FileNotFoundError):
            return _default_store()

    def _write(self, data: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self.path)

    # ── Portfolio ───────────────────────────────────────────

    def add_position(self, ticker: str, shares: float = 0, cost_basis: float = 0) -> None:
        """Add or update a position in the portfolio."""
        data = self._read()
        positions = data["portfolio"]
        # Idempotent: if ticker exists, update; otherwise append.
        for pos in positions:
            if pos["ticker"].upper() == ticker.upper():
                pos["shares"] = shares
                pos["cost_basis"] = cost_basis
                self._write(data)
                return
        positions.append({
            "ticker": ticker.upper(),
            "shares": shares,
            "cost_basis": cost_basis,
        })
        self._write(data)

    def remove_position(self, ticker: str) -> None:
        data = self._read()
        data["portfolio"] = [
            p for p in data["portfolio"]
            if p["ticker"].upper() != ticker.upper()
        ]
        self._write(data)

    def get_portfolio(self) -> list[dict]:
        """Return all portfolio positions."""
        return self._read()["portfolio"]

    def get_tickers(self) -> list[str]:
        """Return just the tickers from the portfolio."""
        return [p["ticker"] for p in self.get_portfolio()]

    # ── Watchlist ───────────────────────────────────────────

    def add_to_watchlist(self, ticker: str) -> None:
        data = self._read()
        wl = data["watchlist"]
        tickers = [t.upper() for t in wl]
        if ticker.upper() not in tickers:
            wl.append(ticker.upper())
            self._write(data)

    def remove_from_watchlist(self, ticker: str) -> None:
        data = self._read()
        data["watchlist"] = [
            t for t in data["watchlist"] if t.upper() != ticker.upper()
        ]
        self._write(data)

    def get_watchlist(self) -> list[str]:
        return self._read()["watchlist"]

    # ── Combined ────────────────────────────────────────────

    def get_all_universe(self) -> list[str]:
        """All tickers across portfolio and watchlist, deduplicated, uppercase."""
        portfolio = self.get_tickers()
        watchlist = self.get_watchlist()
        seen: set[str] = set()
        result: list[str] = []
        for t in portfolio + watchlist:
            tu = t.upper()
            if tu not in seen:
                seen.add(tu)
                result.append(tu)
        return result
