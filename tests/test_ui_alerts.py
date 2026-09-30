"""Console alerts: persistence, dedupe, connection-error wording, backend watcher."""

import openai
import httpx

from ui.server.alerts import AlertFeed, BackendWatcher, describe_run_error


def test_alerts_survive_a_restart_and_keep_counting(tmp_path):
    path = tmp_path / "alerts.jsonl"
    AlertFeed(path).add("error", "run", "VEA run failed", "boom")
    reloaded = AlertFeed(path)
    assert [a["title"] for a in reloaded.list()] == ["VEA run failed"]
    # New ids continue past the reloaded ones, so the browser's "last seen" id stays valid.
    assert reloaded.add("info", "run", "next")["id"] == 2


def test_repeats_inside_the_window_are_dropped():
    feed = AlertFeed(dedupe_window=600)
    assert feed.add("error", "broker", "E*TRADE failed", dedupe="k")
    assert feed.add("error", "broker", "E*TRADE failed", dedupe="k") is None
    assert len(feed.list()) == 1


def test_connection_error_names_the_backend():
    request = httpx.Request("POST", "http://100.89.133.43:9293/v1/chat/completions")
    exc = openai.APIConnectionError(request=request)
    msg = describe_run_error(exc, {"backend_url": "http://100.89.133.43:9293/v1", "llm_provider": "openai_compatible"})
    assert msg.startswith("Couldn't reach http://100.89.133.43:9293/v1 (openai_compatible)")
    # Anything else passes through untouched.
    assert describe_run_error(ValueError("bad"), {}) == "ValueError: bad"


def test_backend_alerts_on_down_and_recovery_only():
    feed = AlertFeed()
    state = {"up": False}
    watcher = BackendWatcher(feed, probe=lambda url, t: (state["up"], "refused"))
    watcher.watch("http://x/v1")
    watcher.check_once()
    watcher.check_once()  # still down: no second alert
    state["up"] = True
    watcher.check_once()
    watcher.check_once()  # still up: nothing
    assert [a["title"] for a in reversed(feed.list())] == [
        "Model backend unreachable: http://x/v1",
        "Model backend back up: http://x/v1",
    ]


def test_healthy_backend_is_silent():
    feed = AlertFeed()
    watcher = BackendWatcher(feed, probe=lambda url, t: (True, ""))
    watcher.watch("http://x/v1")
    watcher.check_once()
    assert feed.list() == []
