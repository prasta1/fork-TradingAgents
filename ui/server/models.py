"""Model options for the Deploy screen's model pickers.

Two sources, depending on where inference lives:

- **Live** — any OpenAI-compatible endpoint answers ``GET /models``. For a
  llama-swap node that list is the ground truth, and it carries whether each
  model is currently resident: a loaded model answers immediately, an unloaded
  one has to be swapped in first.
- **Catalog** — hosted providers have no endpoint worth querying per-keystroke,
  so the repo's shared CLI catalog is reused instead.

Either way the picker still accepts a free-typed id, because neither source is
guaranteed to be complete.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import requests

from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS, get_model_options

# Short: this is called while someone is waiting on a dropdown.
FETCH_TIMEOUT = 6


def _live_models(backend_url: str, timeout: float = FETCH_TIMEOUT) -> list[dict]:
    """Query an OpenAI-compatible ``/models`` endpoint.

    llama-swap adds a ``status.value`` of ``loaded``/``unloaded`` per model;
    plain OpenAI-compatible servers omit it, so state stays None there.
    """
    url = f"{backend_url.rstrip('/')}/models"
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    payload = response.json()

    models = []
    for entry in payload.get("data", []) or []:
        model_id = entry.get("id")
        if not model_id:
            continue
        models.append(
            {
                "value": model_id,
                "label": model_id,
                "state": (entry.get("status") or {}).get("value"),
            }
        )
    return sorted(models, key=lambda m: m["value"])


# Default ports of the common local inference servers. Several share 8080, so
# a hit there is reported by port, not guessed at by name.
# ponytail: fixed well-known list, not a full port sweep — add ports here as needed.
LOCAL_PORTS = {
    11434: "Ollama",
    1234: "LM Studio",
    8000: "vLLM",
    8080: "llama.cpp / llama-swap / LocalAI",
    5000: "text-generation-webui",
    1337: "Jan",
    4000: "LiteLLM",
}

# Localhost refuses a closed port instantly; this only bounds a hung server.
SCAN_TIMEOUT = 1.5


def _probe(port: int) -> dict | None:
    """Return the endpoint on ``port`` if it answers ``/v1/models``, else None."""
    backend_url = f"http://localhost:{port}/v1"
    try:
        models = _live_models(backend_url, timeout=SCAN_TIMEOUT)
    except (requests.RequestException, ValueError):
        # ValueError: something is listening but it isn't JSON (e.g. a web app).
        return None
    return {
        "backend_url": backend_url,
        "port": port,
        "server": LOCAL_PORTS[port],
        "models": len(models),
    }


def scan_local() -> list[dict]:
    """Probe the well-known local ports in parallel for OpenAI-compatible servers."""
    with ThreadPoolExecutor(max_workers=len(LOCAL_PORTS)) as pool:
        return [hit for hit in pool.map(_probe, LOCAL_PORTS) if hit]


def _catalog_models(provider: str, mode: str) -> list[dict]:
    """Fall back to the shared CLI catalog for hosted providers."""
    try:
        options = get_model_options(provider, mode)
    except KeyError:
        return []
    return [
        {"value": value, "label": display, "state": None}
        for display, value in options
        # "custom" is the CLI's free-text sentinel; the console always allows
        # free text, so it would just be a dead entry here.
        if value != "custom"
    ]


def list_models(provider: str, backend_url: str | None) -> dict:
    """Model options for both think tiers, plus where they came from."""
    provider = (provider or "").lower()

    if backend_url:
        try:
            live = _live_models(backend_url)
            if live:
                loaded = [m["value"] for m in live if m["state"] == "loaded"]
                return {
                    "source": "live",
                    "endpoint": backend_url,
                    "deep": live,
                    "quick": live,
                    "loaded": loaded,
                    "error": None,
                }
            return {
                "source": "live",
                "endpoint": backend_url,
                "deep": [],
                "quick": [],
                "loaded": [],
                "error": "endpoint returned no models",
            }
        except requests.RequestException as exc:
            # Unreachable node is expected (asleep, off the tailnet) — report it
            # rather than silently showing an empty menu.
            return {
                "source": "live",
                "endpoint": backend_url,
                "deep": [],
                "quick": [],
                "loaded": [],
                "error": f"{type(exc).__name__}: {exc}",
            }

    return {
        "source": "catalog" if provider in MODEL_OPTIONS else "none",
        "endpoint": None,
        "deep": _catalog_models(provider, "deep"),
        "quick": _catalog_models(provider, "quick"),
        "loaded": [],
        "error": None,
    }
