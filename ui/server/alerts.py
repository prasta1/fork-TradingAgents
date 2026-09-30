"""Console alerts: the bell in the sidebar.

One feed for everything worth telling you about when you aren't looking at the
screen it happened on — a run failing (and why), a batch finishing, a model
backend going down or coming back, a broker call failing.

Alerts are appended to a JSONL file so a failed run's reason survives a server
restart even though the run itself (held in memory) does not. ``feed`` starts
memory-only; the app points it at a file on startup, which keeps tests and
importers from writing into the real results directory.
"""

from __future__ import annotations

import itertools
import json
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

KEEP = 100


class AlertFeed:
    """Bounded, append-only alert log, optionally mirrored to a JSONL file."""

    def __init__(self, path: Path | None = None, dedupe_window: float = 600):
        self._path = path
        self._dedupe_window = dedupe_window
        self._alerts: deque[dict] = deque(maxlen=KEEP)
        self._last_raised: dict[str, float] = {}
        self._lock = threading.Lock()
        if path and path.exists():
            for line in path.read_text().splitlines()[-KEEP:]:
                try:
                    self._alerts.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a torn last line from a crash shouldn't lose the rest
        start = max((a["id"] for a in self._alerts), default=0) + 1
        self._ids = itertools.count(start)

    def add(
        self,
        level: str,
        source: str,
        title: str,
        detail: str = "",
        action: dict | None = None,
        dedupe: str | None = None,
    ) -> dict | None:
        """Record an alert.

        Args:
            level: ``error`` | ``warn`` | ``info``.
            source: ``run`` | ``batch`` | ``backend`` | ``broker``.
            title: One line for the bell's list.
            detail: The full explanation, shown when expanded.
            action: What clicking it opens, e.g. ``{"run_id": ...}``.
            dedupe: Key for suppressing repeats inside the dedupe window —
                a screen that retries a failing broker call shouldn't flood the bell.

        Returns:
            The alert, or None if it was suppressed as a repeat.
        """
        now = time.time()
        with self._lock:
            if dedupe:
                if now - self._last_raised.get(dedupe, 0) < self._dedupe_window:
                    return None
                self._last_raised[dedupe] = now
            alert = {
                "id": next(self._ids),
                "t": now,
                "level": level,
                "source": source,
                "title": title,
                "detail": detail,
                "action": action,
            }
            self._alerts.append(alert)
            if self._path:
                try:
                    self._path.parent.mkdir(parents=True, exist_ok=True)
                    with self._path.open("a") as f:
                        f.write(json.dumps(alert) + "\n")
                except OSError:
                    pass  # the in-memory feed still has it; losing the file copy isn't worth a crash
            return alert

    def list(self) -> list[dict]:
        """Every kept alert, newest first."""
        with self._lock:
            return list(reversed(self._alerts))


feed = AlertFeed()

# Exception type names that mean "never reached the model server", across the
# OpenAI, Anthropic and Google SDKs and the httpx/requests layers beneath them.
_CONNECTION_ERRORS = {
    "APIConnectionError", "APITimeoutError", "ConnectError", "ConnectTimeout",
    "ConnectionError", "ReadTimeout", "ServiceUnavailable",
}


def is_connection_error(exc: BaseException) -> bool:
    """Whether ``exc`` (or anything it was raised from) is a failure to connect."""
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, ConnectionError) or type(exc).__name__ in _CONNECTION_ERRORS:
            return True
        exc = exc.__cause__ or exc.__context__
    return False


def describe_run_error(exc: BaseException, cfg: dict) -> str:
    """A run's failure in words that say what to fix.

    The SDKs report an unreachable server as a bare "Connection error.", which
    doesn't say which server; name the backend URL the run was pointed at.
    """
    raw = f"{type(exc).__name__}: {exc}"
    if is_connection_error(exc):
        url = cfg.get("backend_url") or "the provider's default endpoint"
        return (
            f"Couldn't reach {url} ({cfg.get('llm_provider')}) — is the model server "
            f"running and reachable from this machine? [{raw}]"
        )
    return raw


def _reachable(url: str, timeout: float) -> tuple[bool, str]:
    """Whether a model server answers at all at ``{url}/models``.

    Any HTTP response counts as up — a cloud endpoint answering 401 without a
    key is still there. Only a refused, unresolvable or timed-out connection is down.
    """
    try:
        urllib.request.urlopen(url.rstrip("/") + "/models", timeout=timeout)
        return True, ""
    except urllib.error.HTTPError:
        return True, ""
    except (urllib.error.URLError, OSError) as exc:
        return False, str(getattr(exc, "reason", exc))


class BackendWatcher:
    """Polls every backend the console has used; alerts on down and on recovery."""

    def __init__(self, alerts: AlertFeed | None = None, interval: float = 60, timeout: float = 5, probe=_reachable):
        self._alerts = alerts
        self._interval = interval
        self._timeout = timeout
        self._probe = probe
        self._up: dict[str, bool | None] = {}  # url -> last known state; None = not checked yet
        self._lock = threading.Lock()

    def watch(self, url: str | None) -> None:
        """Add a backend URL to the rotation (no-op for empty or already-watched)."""
        if url:
            with self._lock:
                self._up.setdefault(url, None)

    def check_once(self) -> None:
        with self._lock:
            urls = list(self._up)
        sink = self._alerts or feed
        for url in urls:
            up, reason = self._probe(url, self._timeout)
            before = self._up.get(url)
            self._up[url] = up
            if not up and before is not False:
                sink.add("error", "backend", f"Model backend unreachable: {url}",
                         f"{reason}. Runs pointed at this backend will fail until it answers.")
            elif up and before is False:
                sink.add("info", "backend", f"Model backend back up: {url}")

    def start(self) -> None:
        def loop():
            while True:
                self.check_once()
                time.sleep(self._interval)

        threading.Thread(target=loop, daemon=True).start()


watcher = BackendWatcher()
