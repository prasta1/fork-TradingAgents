"""Structured market data for the console.

The repo's dataflow helpers return formatted markdown because their consumer is
an LLM. The console needs values it can lay out, so this module goes to the
same sources (yfinance, Polymarket's Gamma API) and returns plain dicts.

Everything here is cached with a short TTL — the dashboard and research screens
each fan out to several tickers on load, and these are all network calls.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import yfinance as yf

from tradingagents.dataflows.polymarket import (
    GAMMA_BASE,  # noqa: F401  (re-exported for callers that want the source URL)
    _is_forward_looking,
    _parse_json_list,
    _request,
)
from tradingagents.dataflows.symbol_utils import normalize_symbol
from tradingagents.dataflows.yfinance_news import _extract_article_data

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()


def cached(ttl: float):
    """Memoise a function's result per-arguments for ``ttl`` seconds."""

    def decorator(fn: Callable):
        def wrapper(*args, **kwargs):
            key = f"{fn.__name__}:{args}:{sorted(kwargs.items())}"
            now = time.time()
            with _CACHE_LOCK:
                hit = _CACHE.get(key)
                if hit and now - hit[0] < ttl:
                    return hit[1]
            value = fn(*args, **kwargs)
            with _CACHE_LOCK:
                _CACHE[key] = (now, value)
            return value

        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = fn.__doc__
        return wrapper

    return decorator


def _clean(value):
    """yfinance returns NaN for missing numerics; JSON cannot carry it."""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _age(dt: datetime | None) -> str:
    """Human-readable age, e.g. ``4h`` / ``2d``."""
    if not dt:
        return ""
    delta = datetime.now(timezone.utc) - dt
    hours = delta.total_seconds() / 3600
    if hours < 1:
        return f"{int(delta.total_seconds() // 60)}m"
    if hours < 24:
        return f"{int(hours)}h"
    return f"{int(hours // 24)}d"


@cached(ttl=60)
def quote(ticker: str) -> dict:
    """Snapshot quote plus the six header stats the research screen shows."""
    symbol = normalize_symbol(ticker)
    tk = yf.Ticker(symbol)
    info = tk.info or {}

    price = _clean(info.get("currentPrice") or info.get("regularMarketPrice"))
    prev = _clean(info.get("previousClose") or info.get("regularMarketPreviousClose"))
    change = round(price - prev, 4) if price is not None and prev else None
    change_pct = round(change / prev * 100, 2) if change is not None and prev else None

    hist = tk.history(period="3mo")
    atr = vol_20d = None
    if not hist.empty and len(hist) > 20:
        tr = (hist["High"] - hist["Low"]).tail(14)
        atr = round(float(tr.mean()), 2)
        returns = hist["Close"].pct_change().tail(20)
        vol_20d = round(float(returns.std()) * math.sqrt(252) * 100, 1)

    return {
        "ticker": ticker.upper(),
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or ticker.upper(),
        "exchange": info.get("fullExchangeName") or info.get("exchange") or "",
        "price": price,
        "change": change,
        "change_pct": change_pct,
        "market_state": info.get("marketState") or "",
        "stats": [
            {"k": "MARKET CAP", "v": _fmt_big(info.get("marketCap"))},
            {"k": "P/E RATIO", "v": _fmt_num(info.get("trailingPE"))},
            {"k": "DIV YIELD", "v": _fmt_dividend_yield(info, price)},
            {"k": "52W RANGE", "v": _fmt_range(info)},
            {"k": "ATR (14)", "v": _fmt_num(atr)},
            {"k": "20D VOL", "v": f"{vol_20d}%" if vol_20d is not None else "—"},
        ],
    }


def _fmt_big(v) -> str:
    v = _clean(v)
    if not v:
        return "—"
    for div, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if v >= div:
            return f"{v / div:.2f}{suffix}"
    return f"{v:,.0f}"


def _fmt_num(v) -> str:
    v = _clean(v)
    return f"{v:.2f}" if v is not None else "—"


def _fmt_dividend_yield(info: dict, price: float | None) -> str:
    """Dividend yield as a percentage.

    ``dividendYield`` is ambiguous across yfinance versions — older releases
    return a ratio (0.0034), newer ones a percentage (0.34) — and the two
    overlap, so no threshold can tell them apart. Derive it from the annual
    ``dividendRate`` and the price instead, which has only one meaning, and
    fall back to the reported field only when the rate is missing.
    """
    rate = _clean(info.get("dividendRate"))
    if rate and price:
        return f"{rate / price * 100:.2f}%"

    reported = _clean(info.get("dividendYield"))
    if reported is None:
        return "—"
    # No rate to cross-check against: assume the modern percentage form.
    return f"{reported:.2f}%"


def _fmt_range(info: dict) -> str:
    lo, hi = _clean(info.get("fiftyTwoWeekLow")), _clean(info.get("fiftyTwoWeekHigh"))
    return f"{lo:.2f} - {hi:.2f}" if lo and hi else "—"


@cached(ttl=300)
def sparkline(ticker: str, days: int = 30) -> dict:
    """Daily closes for the price-action chart, as SVG polyline points."""
    hist = yf.Ticker(normalize_symbol(ticker)).history(period=f"{days}d")
    closes = [float(c) for c in hist["Close"].tolist()] if not hist.empty else []
    if len(closes) < 2:
        return {"points": "", "closes": closes}

    lo, hi = min(closes), max(closes)
    span = (hi - lo) or 1.0
    step = 600 / (len(closes) - 1)
    # SVG y grows downward, so invert; 8px padding keeps the stroke off the edge.
    points = " ".join(
        f"{i * step:.1f},{124 - (c - lo) / span * 116:.1f}" for i, c in enumerate(closes)
    )
    return {"points": points, "closes": closes, "low": lo, "high": hi}


@cached(ttl=600)
def macro_news(limit: int = 5) -> list[dict]:
    """Headline per macro theme for the dashboard's macro strip."""
    themes = [
        ("RATES", "Federal Reserve interest rates inflation"),
        ("EARNINGS", "S&P 500 earnings outlook"),
        ("GEOPOLITICAL", "geopolitical risk trade war sanctions"),
        ("CENTRAL BANKS", "ECB Bank of England BOJ policy"),
        ("COMMODITIES", "oil commodities energy supply"),
    ]
    out = []
    for tag, query in themes[:limit]:
        try:
            results = yf.Search(query, news_count=3).news or []
        except Exception:
            continue
        for raw in results:
            article = _extract_article_data(raw)
            if not article.get("title"):
                continue
            out.append(
                {
                    "tag": tag,
                    "head": article["title"],
                    "src": article["publisher"],
                    "age": _age(article["pub_date"]),
                    "link": article["link"],
                }
            )
            break
    return out


@cached(ttl=600)
def ticker_headline(ticker: str) -> dict | None:
    """Most recent headline for one holding."""
    try:
        news = yf.Ticker(normalize_symbol(ticker)).news or []
    except Exception:
        return None
    for raw in news:
        article = _extract_article_data(raw)
        if not article.get("title"):
            continue
        return {
            "sym": ticker.upper(),
            "head": article["title"],
            "src": article["publisher"],
            "age": _age(article["pub_date"]),
            "link": article["link"],
            "published": article["pub_date"].isoformat() if article["pub_date"] else None,
        }
    return None


# Macro themes worth a chip on a trading dashboard. Ranking Polymarket by raw
# volume instead surfaces sports, which dominate the exchange and say nothing
# about markets.
PREDICTION_TOPICS = [
    "Fed interest rate decision",
    "recession",
    "inflation",
]


def _yes_probability(market: dict) -> int | None:
    """Implied probability of the ``Yes`` outcome, as a whole percent."""
    outcomes = _parse_json_list(market.get("outcomes"))
    prices = _parse_json_list(market.get("outcomePrices"))
    if not outcomes or not prices:
        return None
    try:
        yes_idx = next((i for i, o in enumerate(outcomes) if str(o).lower() == "yes"), 0)
        return round(float(prices[yes_idx]) * 100)
    except (ValueError, IndexError, TypeError):
        return None


@cached(ttl=900)
def prediction_markets(limit: int = 3) -> list[dict]:
    """Forward-looking Polymarket odds on macro themes, as label + percentage.

    One chip per theme — the deepest market matching it — so the row stays
    stable rather than churning with whatever is trending.
    """
    now = datetime.now(timezone.utc)
    out = []

    for topic in PREDICTION_TOPICS[:limit]:
        try:
            data = _request("public-search", {"q": topic, "limit_per_type": 20})
        except Exception:
            continue

        candidates = [
            m
            for event in data.get("events", []) or []
            for m in event.get("markets", []) or []
            if _is_forward_looking(m, now)
        ]
        candidates.sort(key=lambda m: m.get("volumeNum") or 0, reverse=True)

        for market in candidates:
            pct = _yes_probability(market)
            if pct is None:
                continue
            question = market.get("question", "").strip()
            out.append(
                {
                    "k": question[:58] + ("…" if len(question) > 58 else ""),
                    "v": f"{pct}%",
                    "pct": pct,
                }
            )
            break

    return out


def market_window(days: int = 7) -> str:
    """Label describing the news lookback, shown next to the macro strip."""
    start = (datetime.now() - timedelta(days=days)).strftime("%b %d")
    return f"{start} – today · {days}d lookback"
