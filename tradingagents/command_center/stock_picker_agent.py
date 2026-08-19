"""Stock Picker Agent — scans a universe of tickers for opportunities.

This agent sits *above* the PortfolioManagerAgent and adds a market-scanning
layer. It can either:

1. **Quick scan** a universe (e.g., S&P 500 constituents) using lightweight
   technical/fundamental screens to filter candidates, then run the full
   TradingAgentsGraph only on the top N candidates.

2. **Deep scan** a smaller watchlist of hand-picked tickers, running the full
   graph on each in parallel.

The quick-scan uses yfinance to pull basic metrics (price change, volume,
market cap, P/E) and applies configurable filters. The deep scan delegates
to PortfolioManagerAgent for the heavy multi-agent analysis.
"""
from __future__ import annotations

import datetime
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import yfinance as yf

from tradingagents.command_center.portfolio_manager_agent import (
    PortfolioAnalysis,
    PortfolioManagerAgent,
)
from tradingagents.default_config import DEFAULT_CONFIG

logger = logging.getLogger(__name__)

# Default S&P 500 tickers — a lightweight way to scan the broad market.
# In production you'd pull the real S&P 500 list, but this is enough for prototyping.
DEFAULT_UNIVERSE = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "BRK-B",
    "JPM", "V", "WMT", "JNJ", "XOM", "UNH", "PG", "MA", "XAI",
    "AVGO", "LLY", "KO", "PEP", "NFLX", "ABBV", "TMO", "CVH",
    "PEP", "ADBE", "NEM", "TRV", "DHR", "MDT", "SBUX", "ORCL",
]


@dataclass
class ScanCandidate:
    """A ticker that passed the quick-scan filter."""
    ticker: str
    price: float | None = None
    change_pct: float | None = None
    volume: int | None = None
    market_cap: float | None = None
    pe_ratio: float | None = None
    score: float = 0.0  # composite score (higher = more attractive)
    reasons: list[str] = field(default_factory=list)


class StockPickerAgent:
    """Scans a ticker universe in two phases: quick screen → deep analysis.

    Usage:
        sp = StockPickerAgent(config=config)
        sp.scan_universe(universe=["AAPL", "TSLA", ...], deep_count=5)
        # Poll sp.results() for ScanCandidate + PortfolioAnalysis combos
        # Or use scan_async() for non-blocking
    """

    def __init__(
        self,
        config: dict | None = None,
        max_workers: int = 4,
    ):
        self.config = config or DEFAULT_CONFIG.copy()
        self.max_workers = max_workers
        self._quick_results: dict[str, ScanCandidate] = {}
        self._deep_results: dict[str, PortfolioAnalysis] = {}
        self._lock = threading.Lock()
        self._pm_agent: Optional[PortfolioManagerAgent] = None

    # ── Phase 1: Quick scan ─────────────────────────────────

    def quick_scan(
        self,
        universe: list[str] | None = None,
        min_volume: float = 1e6,
        min_price: float = 5.0,
        max_pe: float = 50.0,
        top_n: int = 20,
    ) -> list[ScanCandidate]:
        """Pull basic metrics via yfinance and filter/sort.

        Args:
            universe: Tickers to scan. Defaults to DEFAULT_UNIVERSE.
            min_volume: Minimum avg daily volume to consider.
            min_price: Minimum share price (filters penny stocks).
            max_pe: Maximum P/E ratio to consider (None = skip this filter).
            top_n: How many candidates to return after filtering.
        """
        if universe is None:
            universe = DEFAULT_UNIVERSE

        universe = list(dict.fromkeys(t.upper() for t in universe))

        for ticker in universe:
            try:
                tk = yf.Ticker(ticker)
                info = tk.info
                hist = tk.history(period="5d", interval="1d")

                if len(hist) < 2:
                    continue

                price = info.get("previousClose") or hist["Close"].iloc[-1]
                change_pct = (
                    (hist["Close"].iloc[-1] - hist["Close"].iloc[0])
                    / hist["Close"].iloc[0] * 100
                ) if hist["Close"].iloc[0] > 0 else 0.0

                volume = info.get("averageVolume", 0)
                market_cap = info.get("marketCap", 0)
                pe = info.get("trailingPE")

                # Apply filters
                if volume < min_volume:
                    continue
                if price < min_price:
                    continue
                if max_pe is not None and pe is not None and pe > max_pe:
                    continue

                # Simple scoring: upward momentum + reasonable valuation
                # (This is a placeholder — a real scan would use ML or more factors)
                score = 0.0
                reasons = []
                if change_pct > 0:
                    score += change_pct  # momentum
                    reasons.append(f"+{change_pct:.1f}% 5d")
                if pe is not None and pe < 25:
                    score += (25 - pe) * 0.5  # cheap-ish
                    reasons.append(f"P/E {pe:.1f}")
                if market_cap and market_cap > 10e9:
                    score += 2.0  # large cap stability
                    reasons.append("large-cap")

                candidate = ScanCandidate(
                    ticker=ticker,
                    price=price,
                    change_pct=change_pct,
                    volume=volume,
                    market_cap=market_cap,
                    pe_ratio=pe,
                    score=score,
                    reasons=reasons,
                )

                with self._lock:
                    self._quick_results[ticker] = candidate

            except Exception as e:
                logger.warning("Quick scan failed for %s: %s", ticker, e)
                continue

        # Sort by score descending, return top_n
        results = sorted(
            self._quick_results.values(),
            key=lambda c: c.score,
            reverse=True,
        )
        return results[:top_n]

    # ── Phase 2: Deep analysis ─────────────────────────────────

    def deep_scan(
        self,
        tickers: list[str],
        trade_date: str | None = None,
        top_n: int = 5,
    ) -> list[PortfolioAnalysis]:
        """Run full TradingAgentsGraph on the top N tickers from quick scan.

        Args:
            tickers: Tickers from quick_scan() results.
            trade_date: ISO date string (defaults to today).
            top_n: Run full analysis on only the top N candidates.
        """
        top_tickers = tickers[:top_n]
        if not top_tickers:
            return []

        log_callback = self._log_callback

        self._pm_agent = PortfolioManagerAgent(
            config=self.config.copy(),
            max_workers=self.max_workers,
            log_callback=log_callback,
        )
        self._pm_agent.run(top_tickers, trade_date, wait_for_completion=False)

        # Wait for completion (with timeout)
        timeout = 1800  # 30 min max
        start = time.time()
        while time.time() - start < timeout:
            results = self._pm_agent.results()
            done = sum(1 for r in results.values() if r.status in ("done", "error"))
            total = len(top_tickers)
            if done >= total:
                break
            time.sleep(2)

        # Collect results, sort by rating
        results = self._pm_agent.results()
        analyses = list(results.values())
        analyses.sort(key=self._analysis_sort_key)
        self._deep_results = {a.ticker: a for a in analyses}
        return analyses

    def _analysis_sort_key(self, a: PortfolioAnalysis) -> tuple[int, str]:
        order = {"Buy": 0, "Overweight": 1, "Hold": 2, "Underweight": 3, "Sell": 4}
        return (order.get(a.rating, 99), a.ticker)

    def _log_callback(self, ticker: str, line: str) -> None:
        # Store the latest log line for this ticker
        with self._lock:
            if ticker in self._deep_results:
                self._deep_results[ticker].log_lines.append(line)

    # ── Combined scan ────────────────────────────────────────

    def scan_universe(
        self,
        universe: list[str] | None = None,
        trade_date: str | None = None,
        deep_count: int = 5,
        min_volume: float = 1e6,
        min_price: float = 5.0,
        max_pe: float = 50.0,
        quick_top_n: int = 20,
    ) -> tuple[list[ScanCandidate], list[PortfolioAnalysis]]:
        """Full two-phase scan: quick screen then deep analysis.

        Returns (quick_candidates, deep_analyses).
        """
        trade_date = trade_date or datetime.date.today().isoformat()

        # Phase 1: Quick scan
        candidates = self.quick_scan(
            universe=universe,
            min_volume=min_volume,
            min_price=min_price,
            max_pe=max_pe,
            top_n=quick_top_n,
        )

        # Phase 2: Deep analysis on top N candidates
        deep_analyses = self.deep_scan(
            [c.ticker for c in candidates],
            trade_date,
            top_n=deep_count,
        )

        return candidates, deep_analyses

    def scan_universe_async(
        self,
        universe: list[str] | None = None,
        trade_date: str | None = None,
        deep_count: int = 5,
    ) -> None:
        """Non-blocking scan — spawns a background thread."""
        threading.Thread(
            target=self.scan_universe,
            args=(universe, trade_date, deep_count),
            daemon=True,
        ).start()

    # ── Accessors ────────────────────────────────────────────

    def quick_results(self) -> dict[str, ScanCandidate]:
        with self._lock:
            return dict(self._quick_results)

    def deep_results(self) -> dict[str, PortfolioAnalysis]:
        with self._lock:
            return dict(self._deep_results)

    def is_deep_running(self) -> bool:
        """Check if the deep analysis phase is still running."""
        if self._pm_agent is None:
            return False
        results = self._pm_agent.results()
        done = sum(1 for r in results.values() if r.status in ("done", "error"))
        return done < len(results)

    def shutdown(self) -> None:
        if self._pm_agent:
            self._pm_agent.shutdown()
