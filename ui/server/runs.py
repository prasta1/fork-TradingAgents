"""Agent run orchestration for the web console.

Drives the LangGraph directly with ``stream_mode="updates"`` so every chunk
carries a real node name. That is what lets the console light up the pipeline
node-by-node — the CLI infers progress from which state keys have filled in,
and the old Streamlit UI scraped stdout; neither is needed here.

Around the stream we replicate the bookkeeping ``TradingAgentsGraph.propagate``
does (pending-reflection resolution, instrument context, memory-log injection
and write-back, checkpointing), because ``propagate`` itself is blocking and
gives no progress events.

Only one run executes at a time: ``TradingAgentsGraph.__init__`` calls
``set_config`` on a process-global, so two concurrent runs with different
configs would corrupt each other's data-vendor settings.
"""

from __future__ import annotations

import re
import threading
import time
import traceback
import uuid
from datetime import datetime
from typing import Any

from cli.stats_handler import StatsCallbackHandler
from tradingagents.agents.rating import parse_rating, run_rating
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.checkpointer import clear_checkpoint, get_checkpointer, thread_id
from tradingagents.graph.trading_graph import TradingAgentsGraph

# Analyst wire key -> (node label, state key holding its report).
ANALYST_NODES = {
    "market": ("Market Analyst", "market_report"),
    "social": ("Sentiment Analyst", "sentiment_report"),
    "news": ("News Analyst", "news_report"),
    "fundamentals": ("Fundamentals Analyst", "fundamentals_report"),
}

# Fixed nodes after the analyst chain, grouped into the console's columns.
RESEARCH_NODES = ["Bull Researcher", "Bear Researcher", "Research Manager"]
RISK_NODES = ["Aggressive Analyst", "Conservative Analyst", "Neutral Analyst"]

# Node label -> where its output lands in AgentState. A tuple means a nested
# lookup into one of the debate-state dicts.
NODE_REPORT_KEYS: dict[str, Any] = {
    "Market Analyst": "market_report",
    "Sentiment Analyst": "sentiment_report",
    "News Analyst": "news_report",
    "Fundamentals Analyst": "fundamentals_report",
    "Bull Researcher": ("investment_debate_state", "bull_history"),
    "Bear Researcher": ("investment_debate_state", "bear_history"),
    "Research Manager": ("investment_debate_state", "judge_decision"),
    "Trader": "trader_investment_plan",
    "Aggressive Analyst": ("risk_debate_state", "aggressive_history"),
    "Conservative Analyst": ("risk_debate_state", "conservative_history"),
    "Neutral Analyst": ("risk_debate_state", "neutral_history"),
    "Portfolio Manager": "final_trade_decision",
}

# Short provenance line shown under each report title in the console.
NODE_SOURCES = {
    "Market Analyst": "quick_think_llm · yfinance · stockstats",
    "Sentiment Analyst": "quick_think_llm · reddit · stocktwits",
    "News Analyst": "quick_think_llm · news · FRED macro · polymarket",
    "Fundamentals Analyst": "quick_think_llm · fundamentals",
    "Bull Researcher": "quick_think_llm · reads all analyst reports",
    "Bear Researcher": "quick_think_llm · reads all analyst reports",
    "Research Manager": "deep_think_llm · debate verdict",
    "Trader": "quick_think_llm · trade proposal",
    "Aggressive Analyst": "quick_think_llm · risk debate",
    "Conservative Analyst": "quick_think_llm · risk debate",
    "Neutral Analyst": "quick_think_llm · risk debate",
    "Portfolio Manager": "deep_think_llm · final decision · memory log injected",
}


def build_pipeline(selected_analysts: list[str]) -> list[dict]:
    """Describe the run's node graph as the console's five columns."""
    analysts = [
        {"id": ANALYST_NODES[k][0], "label": ANALYST_NODES[k][0]}
        for k in selected_analysts
        if k in ANALYST_NODES
    ]
    return [
        {"num": "01", "title": "ANALYST TEAM", "nodes": analysts},
        {
            "num": "02",
            "title": "RESEARCH TEAM",
            "nodes": [{"id": n, "label": n} for n in RESEARCH_NODES],
        },
        {"num": "03", "title": "TRADING", "nodes": [{"id": "Trader", "label": "Trader"}]},
        {
            "num": "04",
            "title": "RISK TEAM",
            "nodes": [{"id": n, "label": n} for n in RISK_NODES],
        },
        {
            "num": "05",
            "title": "PORTFOLIO",
            "nodes": [{"id": "Portfolio Manager", "label": "Portfolio Manager"}],
        },
    ]


def expected_turn_count(selected_analysts: list[str], debate_rounds: int, risk_rounds: int) -> int:
    """Total agent turns for a run — deterministic given the round counts.

    The debate routers run ``2 x debate_rounds`` bull/bear turns and
    ``3 x risk_rounds`` risk turns before handing off, so a real progress
    denominator is available before the run starts.
    """
    return (
        len(selected_analysts)
        + 2 * debate_rounds
        + 1  # Research Manager
        + 1  # Trader
        + 3 * risk_rounds
        + 1  # Portfolio Manager
    )


def _labelled_section(text: str, *labels: str) -> str:
    """Pull a ``**Label**`` section out of an agent's markdown decision.

    Agents are prompted for these headings but phrasing drifts between models,
    so every known alias is tried and a miss returns "" rather than raising.
    """
    for label in labels:
        pattern = rf"\*\*{re.escape(label)}\*\*:?\s*(.+?)(?=\n\s*\*\*|\Z)"
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            return m.group(1).strip()
    return ""


def _first_number(text: str) -> float | None:
    """First number in a fragment, tolerating ``$``, commas and ranges."""
    m = re.search(r"-?\$?\s*([\d,]+(?:\.\d+)?)", text)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_decision(text: str) -> dict:
    """Extract the Portfolio Manager's structured fields from its markdown."""
    if not text:
        return {}
    target = _labelled_section(text, "Price Target", "Target Price", "Target")
    stop = _labelled_section(text, "Stop Loss", "Stop", "Initial Stop")
    size = _labelled_section(text, "Position Size", "Size", "Sizing")
    return {
        "rating": parse_rating(text),
        "executive_summary": _labelled_section(text, "Executive Summary", "Summary"),
        "investment_thesis": _labelled_section(text, "Investment Thesis", "Thesis"),
        "memory_log": _labelled_section(text, "Memory Log", "Prior Runs", "Memory"),
        "horizon": _labelled_section(text, "Time Horizon", "Horizon"),
        "price_target": _first_number(target) if target else None,
        "stop": _first_number(stop) if stop else None,
        "size": size,
    }


class Run:
    """One agent run: its config, its event log, and its accumulated state."""

    def __init__(self, run_id: str, request: dict, pipeline: list[dict]):
        self.id = run_id
        self.request = request
        self.pipeline = pipeline
        self.status = "queued"  # queued | running | complete | error | cancelled
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.state: dict = {}
        self.reports: dict[str, str] = {}
        self.node_status: dict[str, str] = {}
        self.node_elapsed: dict[str, float] = {}
        self.decision: dict = {}
        self.signal: str | None = None
        self.error: str | None = None
        self.report_path: str | None = None
        self.stats: dict = {}
        self.events: list[dict] = []
        self._lock = threading.Lock()
        self._cancel = threading.Event()

    # -- event log --------------------------------------------------------

    def emit(self, type_: str, **payload) -> None:
        """Append an event. Subscribers poll ``events`` by index."""
        with self._lock:
            self.events.append(
                {
                    "seq": len(self.events),
                    "type": type_,
                    "t": round(time.time() - self.started_at, 1),
                    **payload,
                }
            )

    def events_since(self, seq: int) -> list[dict]:
        with self._lock:
            return self.events[seq:]

    def log(self, message: str, level: str = "info") -> None:
        self.emit("log", message=message, level=level)

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    @property
    def elapsed(self) -> float:
        return (self.finished_at or time.time()) - self.started_at

    def snapshot(self) -> dict:
        """Everything the console needs to render this run from cold."""
        return {
            "run_id": self.id,
            "status": self.status,
            "request": self.request,
            "pipeline": self.pipeline,
            # Epoch seconds, so the console can compute a live elapsed clock
            # that survives a page reload mid-run.
            "started_at": self.started_at,
            "node_status": dict(self.node_status),
            "node_elapsed": {k: round(v, 1) for k, v in self.node_elapsed.items()},
            "node_sources": NODE_SOURCES,
            "reports": dict(self.reports),
            "decision": self.decision,
            "signal": self.signal,
            "error": self.error,
            "elapsed": round(self.elapsed, 1),
            "stats": self.stats,
            "report_path": self.report_path,
            "investment_debate_state": self.state.get("investment_debate_state", {}),
            "risk_debate_state": self.state.get("risk_debate_state", {}),
        }


class RunManager:
    """Owns the active run and a bounded history of finished ones."""

    HISTORY_LIMIT = 20

    def __init__(self):
        self._runs: dict[str, Run] = {}
        self._order: list[str] = []
        self._active: Run | None = None
        self._lock = threading.Lock()

    @property
    def active(self) -> Run | None:
        with self._lock:
            return self._active

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def recent(self) -> list[Run]:
        with self._lock:
            return [self._runs[r] for r in reversed(self._order)]

    def start(self, request: dict) -> Run:
        """Launch a run on a worker thread. Raises if one is already active."""
        with self._lock:
            if self._active and self._active.status in ("queued", "running"):
                raise RuntimeError(
                    f"a run is already in progress ({self._active.request['ticker']})"
                )

            analysts = request["analysts"]
            run = Run(uuid.uuid4().hex[:10], request, build_pipeline(analysts))
            self._runs[run.id] = run
            self._order.append(run.id)
            while len(self._order) > self.HISTORY_LIMIT:
                self._runs.pop(self._order.pop(0), None)
            self._active = run

        threading.Thread(target=self._execute, args=(run,), daemon=True).start()
        return run

    # -- execution --------------------------------------------------------

    def _build_config(self, request: dict) -> dict:
        cfg = DEFAULT_CONFIG.copy()
        for key in (
            "llm_provider",
            "deep_think_llm",
            "quick_think_llm",
            "backend_url",
            "max_debate_rounds",
            "max_risk_discuss_rounds",
            "checkpoint_enabled",
            "output_language",
        ):
            if request.get(key) not in (None, ""):
                cfg[key] = request[key]
        return cfg

    def _execute(self, run: Run) -> None:
        ticker = run.request["ticker"]
        trade_date = run.request["trade_date"]
        asset_type = run.request.get("asset_type", "stock")
        analysts = run.request["analysts"]
        cfg = self._build_config(run.request)
        stats = StatsCallbackHandler()

        run.status = "running"
        for col in run.pipeline:
            for node in col["nodes"]:
                run.node_status[node["id"]] = "pending"

        run.emit("run.started", **run.snapshot())
        run.log(f"initialising graph — {len(analysts)} analysts, {cfg['llm_provider']}")

        try:
            graph = TradingAgentsGraph(
                selected_analysts=analysts,
                debug=False,
                config=cfg,
                callbacks=[stats],
            )

            # Settles the ticker's pending decisions, then injects memory-log
            # lessons and instrument identity — the same entry propagate() uses.
            init_state = graph.create_run_state(ticker, trade_date, asset_type)
            if init_state.get("past_context"):
                run.log("memory log: prior decisions injected into Portfolio Manager")

            args = graph.propagator.get_graph_args(callbacks=[stats])
            # "updates" yields {node_name: delta}; the default "values" yields
            # full snapshots with no node attribution.
            args["stream_mode"] = "updates"

            signature = None
            if cfg.get("checkpoint_enabled"):
                signature = graph._run_signature(asset_type)
                with get_checkpointer(cfg["data_cache_dir"], ticker) as saver:
                    compiled = graph.workflow.compile(checkpointer=saver)
                    args.setdefault("config", {}).setdefault("configurable", {})[
                        "thread_id"
                    ] = thread_id(ticker, trade_date, signature)
                    self._stream(run, compiled, init_state, args, stats)
            else:
                self._stream(run, graph.graph, init_state, args, stats)

            if run.cancelled:
                run.status = "cancelled"
                run.log("run cancelled", level="warn")
            else:
                final_decision = run.state.get("final_trade_decision", "")
                if final_decision:
                    run.signal = run_rating(run.state)
                    run.decision = parse_decision(final_decision)
                    graph.memory_log.store_decision(
                        ticker, trade_date, final_decision, rating=run.signal
                    )
                    run.log("decision appended to trading_memory.md")
                else:
                    run.log("graph ended without a Portfolio Manager decision", level="warn")

                try:
                    path = graph.save_reports(run.state, ticker)
                    run.report_path = str(path)
                    run.log(f"report tree written to {path.parent}")
                except Exception as exc:  # report writing must not fail the run
                    run.log(f"report write failed: {exc}", level="warn")

                run.status = "complete"
                # Only drop the resume point once the run has actually finished.
                if signature is not None:
                    clear_checkpoint(cfg["data_cache_dir"], ticker, trade_date, signature)

                run.emit(
                    "decision",
                    decision=run.decision,
                    signal=run.signal,
                    report_path=run.report_path,
                )

        except Exception as exc:
            run.status = "error"
            run.error = f"{type(exc).__name__}: {exc}"
            run.log(run.error, level="error")
            run.emit("run.error", message=run.error, traceback=traceback.format_exc()[-2000:])

        finally:
            run.finished_at = time.time()
            run.stats = stats.get_stats()
            run.emit("run.finished", **run.snapshot())
            with self._lock:
                if self._active is run:
                    self._active = None

    def _stream(self, run: Run, compiled, init_state: dict, args: dict, stats) -> None:
        """Consume the graph stream, emitting a console event per node."""
        pipeline_ids = {n["id"] for col in run.pipeline for n in col["nodes"]}
        node_started_at: dict[str, float] = {}
        last_node: str | None = None

        # Nothing has completed yet, so mark the entry node active up front —
        # otherwise the first analyst sits on "pending" until it finishes.
        order = [n["id"] for col in run.pipeline for n in col["nodes"]]
        if order:
            run.node_status[order[0]] = "running"
            node_started_at[order[0]] = time.time()
            run.emit("node.started", node=order[0])

        for chunk in compiled.stream(init_state, **args):
            if run.cancelled:
                run.log("cancel requested — stopping after current node", level="warn")
                break

            for node_name, delta in chunk.items():
                if not isinstance(delta, dict):
                    continue
                run.state.update(delta)

                # Tool nodes and message-clear nodes are graph plumbing, not
                # pipeline stages — surface them as log lines only.
                if node_name.startswith("tools_"):
                    run.log(f"{last_node or node_name} → tool call")
                    continue
                if node_name.startswith("Msg Clear"):
                    continue

                # An analyst re-enters its own node after each tool call, so
                # seeing the name only means it is active, not finished.
                if node_name in pipeline_ids:
                    if run.node_status.get(node_name) == "pending":
                        run.node_status[node_name] = "running"
                        node_started_at.setdefault(node_name, time.time())
                        run.emit("node.started", node=node_name)
                    last_node = node_name

            # Completion is decided by state, not by node names: a node is done
            # once the key it writes is non-empty.
            for node_id in order:
                report = self._extract_report(run.state, node_id)
                if not report:
                    continue

                if run.reports.get(node_id) != report:
                    run.reports[node_id] = report
                    run.emit("report", node=node_id, content=report)

                if run.node_status.get(node_id) != "complete":
                    started = node_started_at.get(node_id, run.started_at)
                    elapsed = time.time() - started
                    run.node_status[node_id] = "complete"
                    run.node_elapsed[node_id] = elapsed
                    run.emit("node.completed", node=node_id, elapsed=round(elapsed, 1))
                    run.log(f"{node_id} → complete ({elapsed:.0f}s)")

                    nxt = self._next_pending(run, node_id)
                    if nxt:
                        run.node_status[nxt] = "running"
                        node_started_at.setdefault(nxt, time.time())
                        run.emit("node.started", node=nxt)

            run.stats = stats.get_stats()
            run.emit("stats", **run.stats)

    @staticmethod
    def _extract_report(state: dict, node_name: str) -> str:
        key = NODE_REPORT_KEYS.get(node_name)
        if key is None:
            return ""
        if isinstance(key, tuple):
            outer, inner = key
            return (state.get(outer) or {}).get(inner, "") or ""
        return state.get(key, "") or ""

    @staticmethod
    def _next_pending(run: Run, after: str) -> str | None:
        """The next node still pending, in pipeline order."""
        order = [n["id"] for col in run.pipeline for n in col["nodes"]]
        try:
            idx = order.index(after)
        except ValueError:
            return None
        for candidate in order[idx + 1 :]:
            if run.node_status.get(candidate) == "pending":
                return candidate
        return None


def default_trade_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")
