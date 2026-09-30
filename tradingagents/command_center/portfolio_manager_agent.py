"""Portfolio Manager Agent — orchestrates per-ticker analysis in parallel.

This is the orchestration layer that sits *above* TradingAgentsGraph.
It runs the full agent pipeline (analysts → researchers → debate → trader →
risk analysis → Portfolio Manager) on each ticker in your portfolio
*concurrently* using a thread pool, then aggregates the results into a
portfolio-level summary.

The "Portfolio Manager" in this context is not the same as the in-graph
PortfolioManager node — that node produces a per-ticker rating. This agent
is the *command-center* Portfolio Manager: it owns the whole book and decides
what to show you first.

Output is a list of ``PortfolioAnalysis`` dataclasses, one per ticker,
each carrying the rating, thesis, and timing info pulled from the graph's
final state.
"""
from __future__ import annotations

import builtins
import concurrent.futures
import datetime
import logging
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from tradingagents.agents.rating import parse_rating
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.trading_graph import TradingAgentsGraph

logger = logging.getLogger(__name__)


@dataclass
class PortfolioAnalysis:
    """Result of running the full graph on a single ticker."""
    ticker: str
    status: str = "pending"  # pending, running, done, error
    rating: str = "Hold"
    executive_summary: str = ""
    investment_thesis: str = ""
    price_target: Optional[float] = None
    time_horizon: Optional[str] = None
    final_decision: str = ""
    elapsed_seconds: float = 0.0
    error: Optional[str] = None
    signal: str = "Hold"
    log_lines: list[str] = field(default_factory=list)
    raw_state: dict = field(default_factory=dict)


class _TeeStream:
    """Redirect target that writes to both the real stdout and the live analysis.

    TradingAgents' debug mode calls ``msg.pretty_print()`` (LangChain), which
    writes to ``sys.stdout`` via ``write()`` — NOT through ``builtins.print()``.
    Patching only ``builtins.print`` misses that output, so we redirect
    ``sys.stdout`` here instead, writing each line directly to the live
    ``PortfolioAnalysis.log_lines`` list (protected by a lock) so the UI
    can poll it in real time.
    """

    def __init__(self, real_stdout: object, analysis: "PortfolioAnalysis", lock: threading.Lock):
        self._real = real_stdout
        self._analysis = analysis
        self._lock = lock

    def write(self, s: str) -> int:
        if s and s.strip():
            line = s.rstrip("\n")
            with self._lock:
                self._analysis.log_lines.append(line)
        return self._real.write(s)  # type: ignore[union-attr]

    def flush(self) -> None:
        self._real.flush()  # type: ignore[union-attr]


class PortfolioManagerAgent:
    """Run TradingAgentsGraph on multiple tickers in parallel.

    Usage:
        pm = PortfolioManagerAgent(config=config)
        pm.run(["AAPL", "TSLA", "NVDA"], date_str="2025-01-15")
        # Poll pm.results()
        # Or use run_async() + callback for live updates
    """

    def __init__(
        self,
        config: dict | None = None,
        max_workers: int = 4,
        log_callback: Optional[Callable[[str, str], None]] = None,
    ):
        """
        Args:
            config: TradingAgents config dict (copy of DEFAULT_CONFIG if None).
            max_workers: Max concurrent ticker analyses.
            log_callback: Optional (ticker, line) called for each log line
                from any ticker — useful for live UI updates.
        """
        self.config = config or DEFAULT_CONFIG.copy()
        self.max_workers = max_workers
        self.log_callback = log_callback
        self._results: dict[str, PortfolioAnalysis] = {}
        self._lock = threading.Lock()
        self._executor: Optional[concurrent.futures.ThreadPoolExecutor] = None

    def _run_single(self, ticker: str, trade_date: str) -> None:
        """Run the full graph for one ticker. Writes to self._results."""

        analysis = PortfolioAnalysis(ticker=ticker.upper(), status="running")
        with self._lock:
            self._results[ticker.upper()] = analysis

        # Capture stdout (catches both print() and LangChain pretty_print())
        # _TeeStream writes each line directly to the live PortfolioAnalysis
        # so the UI can poll log_lines in real time.
        _real_stdout = sys.stdout
        _original_print = builtins.print

        def _capturing_print(*args, **kwargs):
            msg = " ".join(str(a) for a in args)
            with self._lock:
                analysis.log_lines.append(msg)
            _original_print(*args, **kwargs)
            if self.log_callback:
                self.log_callback(ticker.upper(), msg)

        builtins.print = _capturing_print
        sys.stdout = _TeeStream(_real_stdout, analysis, self._lock)

        start = time.time()
        try:
            ta = TradingAgentsGraph(debug=True, config=self.config.copy())
            final_state, signal = ta.propagate(ticker, trade_date)
            analysis.elapsed_seconds = time.time() - start
            analysis.status = "done"

            # Extract structured fields from final_state
            decision = final_state.get("final_trade_decision", "")
            analysis.rating = parse_rating(decision)
            analysis.final_decision = decision

            # Parse structured output if available
            if "**Executive Summary**" in decision:
                lines = decision.split("\n")
                for i, line in enumerate(lines):
                    if "**Rating**" in line:
                        analysis.rating = parse_rating(line)
                    elif "**Executive Summary**" in line:
                        summary = []
                        for ln in lines[i + 1:]:
                            if ln.strip().startswith("**") or ln.strip() == "":
                                break
                            summary.append(ln.strip())
                        analysis.executive_summary = " ".join(summary)
                    elif "**Investment Thesis**" in line:
                        thesis = []
                        for ln in lines[i + 1:]:
                            if ln.strip().startswith("**") or ln.strip() == "":
                                break
                            thesis.append(ln.strip())
                        analysis.investment_thesis = " ".join(thesis)
                    elif "**Price Target**" in line:
                        txt = line.split(":", 1)[-1].strip() if ":" in line else ""
                        txt = txt.replace("**", "").strip()
                        try:
                            analysis.price_target = float(txt)
                        except ValueError:
                            pass
                    elif "**Time Horizon**" in line:
                        txt = line.split(":", 1)[-1].strip() if ":" in line else ""
                        analysis.time_horizon = txt.replace("**", "").strip()

            analysis.signal = signal
            analysis.raw_state = {
                "market_report": final_state.get("market_report", "")[:500],
                "sentiment_report": final_state.get("sentiment_report", "")[:500],
                "news_report": final_state.get("news_report", "")[:500],
                "fundamentals_report": final_state.get("fundamentals_report", "")[:500],
            }

        except Exception as e:
            logger.exception("Portfolio analysis failed for %s", ticker)
            analysis.status = "error"
            analysis.error = str(e)
            analysis.elapsed_seconds = time.time() - start
        finally:
            # Restore stdout + print
            builtins.print = _original_print
            sys.stdout = _real_stdout
            with self._lock:
                self._results[ticker.upper()] = analysis

    def run(
        self,
        tickers: list[str],
        trade_date: str | None = None,
        wait_for_completion: bool = True,
        timeout_per_ticker: float = 3600,
    ) -> dict[str, PortfolioAnalysis]:
        """Run analysis on all tickers. Blocks until all done if wait_for_completion.

        Args:
            tickers: List of ticker symbols.
            trade_date: ISO date string (defaults to today).
            wait_for_completion: If True, blocks until all done.
            timeout_per_ticker: Max seconds per ticker (for safety).
        """
        if trade_date is None:
            trade_date = datetime.date.today().isoformat()

        tickers = [t.upper() for t in tickers]

        # Clear stale results for these tickers
        with self._lock:
            for t in tickers:
                self._results[t] = PortfolioAnalysis(ticker=t, status="pending")

        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=min(self.max_workers, len(tickers))
        )

        futures = {
            self._executor.submit(self._run_single, t, trade_date): t
            for t in tickers
        }

        if wait_for_completion:
            for future in concurrent.futures.as_completed(
                futures, timeout=timeout_per_ticker * len(tickers)
            ):
                future.result()  # Re-raises any exception
            self._executor.shutdown(wait=True)

        return self.results()

    def run_async(
        self,
        tickers: list[str],
        trade_date: str | None = None,
    ) -> dict[str, PortfolioAnalysis]:
        """Same as run() but non-blocking — returns immediately with live results."""
        return self.run(tickers, trade_date, wait_for_completion=False)

    def results(self) -> dict[str, PortfolioAnalysis]:
        """Return a snapshot of current results (thread-safe)."""
        with self._lock:
            return dict(self._results)

    def get_ranked(self) -> list[PortfolioAnalysis]:
        """Return analyses sorted by rating — Buy first, then Overweight, etc.

        Within each rating tier, sorts by elapsed time (faster = more confident).
        Incomplete tickers sort last.
        """
        order = {"Buy": 0, "Overweight": 1, "Hold": 2, "Underweight": 3, "Sell": 4}
        results = self.results()

        def _sort_key(a: PortfolioAnalysis):
            if a.status != "done":
                return (99, a.ticker)
            return (order.get(a.rating, 99), a.ticker)

        return sorted(results.values(), key=_sort_key)

    def shutdown(self) -> None:
        if self._executor:
            self._executor.shutdown(wait=False, cancel_futures=True)
