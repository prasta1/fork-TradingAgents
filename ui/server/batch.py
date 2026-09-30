"""Portfolio batch runs: every selected holding through the agent pipeline, in turn.

A batch is a queue on top of :class:`ui.server.runs.RunManager`, not a second
executor. Each ticker becomes an ordinary run (so it shows up in Live run, Run
history and the memory log like any other); the batch just starts the next one
when the last finishes. Runs cannot overlap — the graph config is
process-global — so a batch of N tickers takes N run-lengths.

When the last ticker finishes the batch produces a verdict: a table ordered so
downgrades and bearish calls on big positions come first, plus one LLM memo
reading every decision against its portfolio weight. The verdict is written to
disk; the batch itself lives in memory like runs do.
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from tradingagents.agents.rating import RATING_REVIEW, RATINGS_5_TIER
from tradingagents.default_config import DEFAULT_CONFIG

from . import alerts, history
from .runs import RunManager

TERMINAL = ("complete", "error", "cancelled")


def rating_rank(rating: str | None) -> int | None:
    """Position on the 5-tier scale, 0 = Buy … 4 = Sell; None if off-scale."""
    try:
        return RATINGS_5_TIER.index(rating)
    except ValueError:
        return None


def attention_group(item: dict) -> int:
    """Sort bucket for the verdict table — lower needs a look sooner.

    0: downgraded since the last run · 1: bearish or unreadable (REVIEW) call ·
    2: everything else · 3: no new rating (errored, skipped, cancelled).
    """
    new = item.get("signal")
    if item["status"] != "complete" or not new:
        return 3
    old_rank, new_rank = rating_rank(item.get("prev_rating")), rating_rank(new)
    if old_rank is not None and new_rank is not None and new_rank > old_rank:
        return 0
    if new in ("Underweight", "Sell", RATING_REVIEW):
        return 1
    return 2


def verdict_rows(items: list[dict]) -> list[dict]:
    """The batch's items in verdict order: attention group, then weight descending."""
    return sorted(items, key=lambda i: (attention_group(i), -(i.get("weight") or 0)))


def _decision_brief(item: dict) -> str:
    """One ticker's decision, trimmed for the memo prompt.

    Local models have small context windows and a batch can be dozens of
    tickers, so the memo reads the parsed summary and thesis rather than every
    Portfolio Manager write-up in full.
    """
    d = item.get("decision") or {}
    body = "\n".join(p for p in (d.get("executive_summary"), d.get("investment_thesis")) if p)
    if not body:
        body = (item.get("final_trade_decision") or "")[:1500]
    return (
        f"### {item['sym']} — weight {item.get('weight', 0) * 100:.1f}% — "
        f"{item.get('prev_rating') or 'unrated'} → {item.get('signal')}\n"
        f"Target: {d.get('price_target') or 'n/a'} · Stop: {d.get('stop') or 'n/a'} · "
        f"Horizon: {d.get('horizon') or 'n/a'} · Size: {d.get('size') or 'n/a'}\n{body}"
    )


MEMO_PROMPT = """You are the portfolio manager reviewing a full-portfolio batch of analyses.
Each holding below was just analysed on its own; you see all of them together with
their weight in the portfolio and how their rating moved since the previous run.

Write a short markdown memo (under 400 words) with these sections:
**Trim / exit** — holdings to reduce, biggest-impact first, one line of why each.
**Add** — holdings worth adding to, if any.
**Concentration & correlation** — overweight exposures, holdings riding the same factor.
**Conflicts** — calls that contradict each other (e.g. opposite macro assumptions).
Do not restate every holding. Be specific and name tickers.

{briefs}
"""


def write_memo(items: list[dict], settings: dict) -> str:
    """One deep-think LLM call over every completed decision in the batch.

    Args:
        items: The batch's items; only completed ones are included.
        settings: The batch's run settings — provider, models, backend URL.

    Returns:
        The memo as markdown.
    """
    # Imported here so the module (and its tests) load without LLM SDKs.
    from tradingagents.llm_clients import build_llm_kwargs, create_llm_client

    cfg = RunManager._build_config(settings)
    llm = create_llm_client(
        provider=cfg["llm_provider"],
        model=cfg["deep_think_llm"],
        base_url=cfg.get("backend_url"),
        **build_llm_kwargs(cfg),
    ).get_llm()
    briefs = "\n\n".join(_decision_brief(i) for i in verdict_rows(items) if i["status"] == "complete")
    return llm.invoke(MEMO_PROMPT.format(briefs=briefs)).content


def verdict_markdown(batch: "Batch") -> str:
    """The verdict as a standalone markdown file: memo, then the table."""
    lines = [f"# Portfolio batch {batch.id} — {batch.trade_date}", ""]
    if batch.memo:
        lines += ["## Memo", "", batch.memo, ""]
    elif batch.memo_error:
        lines += [f"_Memo failed: {batch.memo_error}_", ""]
    lines += [
        "## Positions",
        "",
        "| Ticker | Weight | Previous | New | Target | Stop | Horizon | Status |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for i in verdict_rows(batch.items):
        d = i.get("decision") or {}
        lines.append(
            f"| {i['sym']} | {(i.get('weight') or 0) * 100:.1f}% | {i.get('prev_rating') or '—'} | "
            f"{i.get('signal') or '—'} | {d.get('price_target') or '—'} | {d.get('stop') or '—'} | "
            f"{d.get('horizon') or '—'} | {i['status']} |"
        )
    return "\n".join(lines) + "\n"


class Batch:
    """One batch: its settings, one item per ticker, and the verdict once done."""

    def __init__(self, batch_id: str, positions: list[dict], settings: dict):
        self.id = batch_id
        self.settings = settings
        self.trade_date = settings["trade_date"]
        self.status = "running"  # running | complete | cancelled
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.memo: str | None = None
        self.memo_error: str | None = None
        self.verdict_path: str | None = None
        self._cancel = threading.Event()

        # Snapshot before any run writes a new rating, so "previous" means
        # what you had going in.
        prior = history.latest_by_ticker()
        self.items = [
            {
                "sym": p["sym"],
                "weight": p.get("weight") or 0,
                "asset_type": p.get("asset_type", "stock"),
                "prev_rating": (prior.get(p["sym"]) or {}).get("rating"),
                "prev_date": (prior.get(p["sym"]) or {}).get("date"),
                "status": "queued",  # queued | running | complete | error | cancelled | skipped
                "run_id": None,
                "signal": None,
                "decision": None,
                "final_trade_decision": None,
                "error": None,
                "elapsed": None,
            }
            for p in positions
        ]

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def snapshot(self) -> dict:
        done = [i for i in self.items if i["status"] in TERMINAL + ("skipped",)]
        timed = [i["elapsed"] for i in self.items if i["status"] == "complete" and i["elapsed"]]
        remaining = sum(1 for i in self.items if i["status"] in ("queued", "running"))
        # Queue order while running (so progress reads top-down), verdict order after.
        rows = self.items if self.status == "running" else verdict_rows(self.items)
        return {
            "batch_id": self.id,
            "status": self.status,
            "trade_date": self.trade_date,
            "settings": self.settings,
            "started_at": self.started_at,
            "elapsed": round((self.finished_at or time.time()) - self.started_at, 1),
            "done": len(done),
            "total": len(self.items),
            # Average of finished tickers × tickers left; None until one finishes.
            "eta": round(sum(timed) / len(timed) * remaining) if timed and remaining else None,
            # The full decision markdown is for the memo, not the browser.
            "items": [{k: v for k, v in i.items() if k != "final_trade_decision"} for i in rows],
            "memo": self.memo,
            "memo_error": self.memo_error,
            "verdict_path": self.verdict_path,
        }


class BatchManager:
    """Runs one batch at a time on a worker thread, one ticker after another."""

    def __init__(
        self,
        runs: RunManager,
        memo_fn: Callable[[list[dict], dict], str] = write_memo,
        poll: float = 2.0,
        verdict_dir: Path | None = None,
    ):
        self._runs = runs
        self._memo_fn = memo_fn
        self._poll = poll
        self._verdict_dir = verdict_dir or Path(DEFAULT_CONFIG["results_dir"]) / "batches"
        self._latest: Batch | None = None
        self._lock = threading.Lock()

    @property
    def latest(self) -> Batch | None:
        with self._lock:
            return self._latest

    @property
    def running(self) -> bool:
        latest = self.latest
        return bool(latest and latest.status == "running")

    def start(self, positions: list[dict], settings: dict) -> Batch:
        """Queue ``positions`` and start working through them.

        Raises:
            RuntimeError: A batch or a single run is already in progress.
            ValueError: No positions were given.
        """
        if not positions:
            raise ValueError("no positions selected")
        with self._lock:
            if self._latest and self._latest.status == "running":
                raise RuntimeError("a batch is already in progress")
            active = self._runs.active
            if active and active.status in ("queued", "running"):
                raise RuntimeError(f"a run is already in progress ({active.request['ticker']})")
            batch = Batch(uuid.uuid4().hex[:8], positions, settings)
            self._latest = batch
        threading.Thread(target=self._execute, args=(batch,), daemon=True).start()
        return batch

    def _execute(self, batch: Batch) -> None:
        for item in batch.items:
            if batch.cancelled:
                item["status"] = "skipped"
                continue
            self._run_one(batch, item)

        if any(i["status"] == "complete" for i in batch.items):
            try:
                batch.memo = self._memo_fn(batch.items, batch.settings)
            except Exception as exc:  # the table stands on its own without the memo
                batch.memo_error = f"{type(exc).__name__}: {exc}"

        batch.finished_at = time.time()
        try:
            self._verdict_dir.mkdir(parents=True, exist_ok=True)
            path = self._verdict_dir / f"{batch.trade_date}-{batch.id}.md"
            path.write_text(verdict_markdown(batch))
            batch.verdict_path = str(path)
        except OSError as exc:
            batch.memo_error = (batch.memo_error or "") + f" · verdict not saved: {exc}"
        # Last, so a poller that sees the batch finish also sees its verdict.
        batch.status = "cancelled" if batch.cancelled else "complete"
        rated = sum(1 for i in batch.items if i["status"] == "complete")
        failed = sum(1 for i in batch.items if i["status"] == "error")
        alerts.feed.add(
            "warn" if failed or batch.cancelled or batch.memo_error else "info",
            "batch",
            f"Batch {batch.status}: {rated} of {len(batch.items)} rated"
            + (f" · {failed} failed" if failed else ""),
            batch.memo_error or "",
            {"screen": "batch"},
        )

    def _run_one(self, batch: Batch, item: dict) -> None:
        """Start one ticker's run and block until it ends, relaying a cancel."""
        request = {
            **batch.settings,
            "ticker": item["sym"],
            "asset_type": item["asset_type"],
            # Crypto has no fundamentals data (see filter_analysts_for_asset_type).
            "analysts": [
                a for a in batch.settings["analysts"]
                if not (item["asset_type"] == "crypto" and a == "fundamentals")
            ],
        }
        try:
            run = self._runs.start(request)
        except Exception as exc:
            item["status"], item["error"] = "error", str(exc)
            return

        item["status"], item["run_id"] = "running", run.id
        while run.status not in TERMINAL:
            if batch.cancelled:
                run.cancel()
            time.sleep(self._poll)

        item["status"] = run.status
        item["elapsed"] = round(run.elapsed, 1)
        item["error"] = run.error
        item["signal"] = run.signal
        item["decision"] = run.decision
        item["final_trade_decision"] = run.state.get("final_trade_decision")
