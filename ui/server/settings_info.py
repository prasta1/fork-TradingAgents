"""Environment introspection for the Settings screen.

Reports which provider credentials are present, which data vendors are wired,
and where the framework writes on disk. Key *values* are never returned — only
whether the variable is set.
"""

from __future__ import annotations

import os

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.llm_clients.api_key_env import get_api_key_env

# Providers surfaced in Settings, in menu order.
PROVIDERS = [
    ("OpenAI", "openai"),
    ("Anthropic", "anthropic"),
    ("Google", "google"),
    ("DeepSeek", "deepseek"),
    ("xAI", "xai"),
    ("OpenRouter", "openrouter"),
    ("Groq", "groq"),
    ("Mistral", "mistral"),
    ("Moonshot / Kimi", "kimi"),
    ("Qwen", "qwen"),
    ("GLM", "glm"),
    ("MiniMax", "minimax"),
    ("NVIDIA NIM", "nvidia"),
    ("Azure OpenAI", "azure"),
    ("Amazon Bedrock", "bedrock"),
    ("Ollama", "ollama"),
    ("OpenAI-compatible", "openai_compatible"),
]

# Non-LLM credentials the data vendors use.
DATA_KEYS = [
    ("Alpha Vantage", "ALPHA_VANTAGE_API_KEY"),
    ("FRED", "FRED_API_KEY"),
    ("Public.com", "PUBLIC_API_SECRET"),
]


def _status(env_var: str | None) -> tuple[str, bool]:
    if env_var is None:
        return "no key required", True
    return ("detected", True) if os.getenv(env_var) else ("not set", False)


def providers() -> list[dict]:
    """Provider credential status. Never returns key values."""
    out = []
    for label, key in PROVIDERS:
        env_var = get_api_key_env(key)
        status, present = _status(env_var)
        if key == "ollama":
            status = os.getenv("OLLAMA_BASE_URL", "localhost:11434")
        out.append(
            {"k": label, "provider": key, "env": env_var or "—", "status": status, "ok": present}
        )
    return out


def data_credentials() -> list[dict]:
    out = []
    for label, env_var in DATA_KEYS:
        status, present = _status(env_var)
        out.append({"k": label, "env": env_var, "status": status, "ok": present})
    return out


def vendors(config: dict | None = None) -> list[dict]:
    cfg = config or DEFAULT_CONFIG
    return [{"k": k, "v": v} for k, v in (cfg.get("data_vendors") or {}).items()]


def paths(config: dict | None = None) -> list[dict]:
    cfg = config or DEFAULT_CONFIG
    return [
        {"k": "results_dir", "v": cfg["results_dir"]},
        {"k": "data_cache_dir", "v": cfg["data_cache_dir"]},
        {"k": "memory_log_path", "v": cfg["memory_log_path"]},
    ]


def runtime_defaults(config: dict | None = None) -> dict:
    """Config values the Deploy screen pre-fills from."""
    cfg = config or DEFAULT_CONFIG
    return {
        "llm_provider": cfg["llm_provider"],
        "deep_think_llm": cfg["deep_think_llm"],
        "quick_think_llm": cfg["quick_think_llm"],
        "backend_url": cfg.get("backend_url"),
        "max_debate_rounds": cfg["max_debate_rounds"],
        "max_risk_discuss_rounds": cfg["max_risk_discuss_rounds"],
        "checkpoint_enabled": cfg["checkpoint_enabled"],
        "output_language": cfg["output_language"],
        "data_vendors": cfg.get("data_vendors", {}),
        "data_cache_dir": cfg["data_cache_dir"],
    }
