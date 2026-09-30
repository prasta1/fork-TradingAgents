"""Portfolio batch runner: ordering, error isolation, cancel, verdict sort."""

import threading
import time

import pytest

from ui.server import batch as batch_mod
from ui.server.batch import BatchManager, attention_group, verdict_rows


class FakeRun:
    def __init__(self, request, outcome):
        self.id = request["ticker"].lower()
        self.request = request
        self.status = "running"
        self.error = None
        self.signal = None
        self.decision = {}
        self.state = {}
        self.elapsed = 1.0
        self._cancel = threading.Event()
        self._outcome = outcome

    def cancel(self):
        self._cancel.set()

    def finish(self):
        if self._cancel.is_set():
            self.status = "cancelled"
        elif isinstance(self._outcome, Exception):
            self.status, self.error = "error", str(self._outcome)
        else:
            self.status, self.signal = "complete", self._outcome
            self.state = {"final_trade_decision": f"Rating: {self._outcome}"}


class FakeRuns:
    """Stands in for RunManager: each run finishes on the next poll."""

    def __init__(self, outcomes, on_start=None):
        self.outcomes = outcomes
        self.started = []
        self.active = None
        self.on_start = on_start

    def start(self, request):
        self.started.append(request)
        run = FakeRun(request, self.outcomes[request["ticker"]])
        if self.on_start:
            self.on_start(request)
        threading.Timer(0.02, run.finish).start()
        return run


SETTINGS = {"trade_date": "2026-09-30", "analysts": ["market", "fundamentals"]}


@pytest.fixture(autouse=True)
def prior_ratings(monkeypatch):
    monkeypatch.setattr(
        batch_mod.history, "latest_by_ticker", lambda: {"AAA": {"rating": "Buy", "date": "2026-01-01"}}
    )


def wait(mgr):
    deadline = time.time() + 5
    while mgr.running and time.time() < deadline:
        time.sleep(0.01)
    assert not mgr.running


def test_runs_in_order_and_survives_an_error(tmp_path):
    runs = FakeRuns({"AAA": "Sell", "BBB": RuntimeError("boom"), "BTC-USD": "Hold"})
    memo_inputs = []
    mgr = BatchManager(runs, memo_fn=lambda items, s: memo_inputs.append(items) or "memo", poll=0.01, verdict_dir=tmp_path)
    b = mgr.start(
        [{"sym": "AAA", "weight": 0.5}, {"sym": "BBB", "weight": 0.3}, {"sym": "BTC-USD", "asset_type": "crypto"}],
        SETTINGS,
    )
    wait(mgr)

    assert [r["ticker"] for r in runs.started] == ["AAA", "BBB", "BTC-USD"]
    # Crypto drops the fundamentals analyst.
    assert runs.started[2]["analysts"] == ["market"]
    statuses = {i["sym"]: i["status"] for i in b.items}
    assert statuses == {"AAA": "complete", "BBB": "error", "BTC-USD": "complete"}
    assert b.status == "complete" and b.memo == "memo"
    assert b.items[0]["prev_rating"] == "Buy"
    assert "AAA" in (tmp_path / f"2026-09-30-{b.id}.md").read_text()


def test_cancel_skips_the_rest(tmp_path):
    mgr = None

    def cancel_after_first(request):
        if request["ticker"] == "AAA":
            mgr.latest.cancel()

    runs = FakeRuns({"AAA": "Hold", "BBB": "Hold", "CCC": "Hold"}, on_start=cancel_after_first)
    mgr = BatchManager(runs, memo_fn=lambda *a: "memo", poll=0.01, verdict_dir=tmp_path)
    b = mgr.start([{"sym": s} for s in ("AAA", "BBB", "CCC")], SETTINGS)
    wait(mgr)

    assert [r["ticker"] for r in runs.started] == ["AAA"]
    assert [i["status"] for i in b.items] == ["cancelled", "skipped", "skipped"]
    assert b.status == "cancelled"
    assert b.memo is None  # nothing completed, so no memo call


def test_memo_failure_keeps_the_table(tmp_path):
    def broken(*_):
        raise ConnectionError("backend down")

    mgr = BatchManager(FakeRuns({"AAA": "Hold"}), memo_fn=broken, poll=0.01, verdict_dir=tmp_path)
    b = mgr.start([{"sym": "AAA"}], SETTINGS)
    wait(mgr)
    assert b.status == "complete" and "backend down" in b.memo_error and b.verdict_path


def test_refuses_to_overlap_a_single_run(tmp_path):
    runs = FakeRuns({})
    runs.active = type("R", (), {"status": "running", "request": {"ticker": "ZZZ"}})()
    with pytest.raises(RuntimeError, match="ZZZ"):
        BatchManager(runs, verdict_dir=tmp_path).start([{"sym": "AAA"}], SETTINGS)


def test_verdict_order():
    def item(sym, prev, new, weight, status="complete"):
        return {"sym": sym, "prev_rating": prev, "signal": new, "weight": weight, "status": status}

    items = [
        item("HOLD_BIG", "Hold", "Hold", 0.4),
        item("SELL_SMALL", None, "Sell", 0.05),
        item("DOWN_SMALL", "Buy", "Hold", 0.02),
        item("DOWN_BIG", "Overweight", "Underweight", 0.2),
        item("FAILED", "Buy", None, 0.5, status="error"),
        item("UP", "Hold", "Buy", 0.1),
    ]
    assert attention_group(items[3]) == 0
    assert [i["sym"] for i in verdict_rows(items)] == [
        "DOWN_BIG", "DOWN_SMALL", "SELL_SMALL", "HOLD_BIG", "UP", "FAILED",
    ]
