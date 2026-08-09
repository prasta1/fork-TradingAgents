"""FastAPI app for the TradingAgents console.

Serves the built React console and the JSON/SSE API behind it. Run with::

    uvicorn ui.server.app:app --port 8551

Brokerage credentials stay on this side of the wire: the browser never sees a
Public.com secret or an E*TRADE consumer secret, only the results of calls made
with them.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from tradingagents.command_center.portfolio_store import PortfolioStore

from . import history, market, models, portfolio, runs, settings_info
from .brokers import BrokerError, BrokerRegistry

load_dotenv()

app = FastAPI(title="TradingAgents Console", version="0.3.1")

manager = runs.RunManager()
brokers = BrokerRegistry()
store = PortfolioStore()

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


# -- request models -------------------------------------------------------


class RunRequest(BaseModel):
    ticker: str
    trade_date: str = Field(default_factory=runs.default_trade_date)
    asset_type: str = "stock"
    analysts: list[str] = ["market", "social", "news", "fundamentals"]
    llm_provider: str | None = None
    deep_think_llm: str | None = None
    quick_think_llm: str | None = None
    backend_url: str | None = None
    max_debate_rounds: int = 1
    max_risk_discuss_rounds: int = 1
    checkpoint_enabled: bool = False


class OrderRequest(BaseModel):
    symbol: str
    side: str  # BUY | SELL
    quantity: str
    order_type: str = "LIMIT"  # MARKET | LIMIT | STOP
    limit_price: str | None = None
    stop_price: str | None = None
    time_in_force: str = "DAY"


class PlaceRequest(BaseModel):
    order: OrderRequest
    # Handle issued by preflight. E*TRADE will not place without it.
    token: dict | None = None


def _call(fn, *args, **kwargs):
    """Run a broker call, mapping its failure modes onto clean HTTP errors."""
    try:
        return fn(*args, **kwargs)
    except BrokerError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


# -- bootstrap ------------------------------------------------------------


@app.get("/api/bootstrap")
def bootstrap():
    """Everything the console needs on first paint.

    Falls back to the most recent finished run when nothing is executing, so
    reloading the page after a run does not lose it from the console.
    """
    recent = manager.recent()
    active = manager.active or (recent[0] if recent else None)
    return {
        "version": app.version,
        "defaults": settings_info.runtime_defaults(),
        "analysts": [
            {"key": "market", "label": "Market Analyst", "desc": "MACD, RSI, price/volume structure"},
            {"key": "social", "label": "Sentiment Analyst", "desc": "Reddit, StockTwits, news mood"},
            {"key": "news", "label": "News Analyst", "desc": "Headlines, FRED macro, prediction markets"},
            {"key": "fundamentals", "label": "Fundamentals Analyst", "desc": "Financials, margins, valuation"},
        ],
        "trade_date": runs.default_trade_date(),
        "brokers": brokers.status(),
        "active_broker": brokers.active_name,
        "broker_connected": brokers.active.connected,
        "active_run": active.snapshot() if active else None,
    }


@app.get("/api/models")
def get_models(provider: str = Query(""), backend_url: str = Query("")):
    """Model options for the Deploy pickers.

    Live from the endpoint when one is configured (llama-swap reports which
    models are resident), otherwise from the shared model catalog.
    """
    return models.list_models(provider, backend_url or None)


@app.get("/api/settings")
def get_settings():
    return {
        "providers": settings_info.providers(),
        "data_credentials": settings_info.data_credentials(),
        "vendors": settings_info.vendors(),
        "paths": settings_info.paths(),
        "brokers": brokers.status(),
        "active_broker": brokers.active_name,
    }


# -- brokers --------------------------------------------------------------


@app.get("/api/brokers")
def list_brokers():
    return {"brokers": brokers.status(), "active": brokers.active_name}


@app.post("/api/brokers/active")
def set_active_broker(name: str = Body(..., embed=True)):
    _call(brokers.set_active, name)
    return {"brokers": brokers.status(), "active": brokers.active_name}


@app.post("/api/brokers/etrade/authorize")
def etrade_authorize():
    """Begin E*TRADE OAuth: returns the URL the user must visit.

    E*TRADE authorizes out-of-band — the page shows a verification code the
    user pastes back into /verify. The server never sees their credentials.
    """
    client = brokers.get("etrade").client
    try:
        return {"authorize_url": client.start_authorization()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/brokers/etrade/verify")
def etrade_verify(verifier: str = Body(..., embed=True)):
    """Complete E*TRADE OAuth with the verification code from the browser."""
    client = brokers.get("etrade").client
    try:
        client.complete_authorization(verifier)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"brokers": brokers.status(), "active": brokers.active_name}


@app.post("/api/brokers/etrade/disconnect")
def etrade_disconnect():
    brokers.get("etrade").client.disconnect()
    return {"brokers": brokers.status(), "active": brokers.active_name}


# -- runs -----------------------------------------------------------------


@app.post("/api/runs")
def start_run(request: RunRequest):
    try:
        run = manager.start(request.model_dump())
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return run.snapshot()


@app.get("/api/runs")
def list_runs():
    return [
        {
            "run_id": r.id,
            "ticker": r.request["ticker"],
            "trade_date": r.request["trade_date"],
            "status": r.status,
            "signal": r.signal,
            "elapsed": round(r.elapsed, 1),
        }
        for r in manager.recent()
    ]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = manager.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="unknown run")
    return run.snapshot()


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str):
    run = manager.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="unknown run")
    run.cancel()
    return {"status": "cancelling"}


@app.get("/api/runs/{run_id}/stream")
async def stream_run(run_id: str):
    """Server-sent events for one run: node transitions, reports, logs, stats.

    Replays the run's whole event log first, so a browser that connects late
    (or reconnects) renders the same thing as one that watched from the start.
    """
    run = manager.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="unknown run")

    async def events():
        seq = 0
        while True:
            pending = run.events_since(seq)
            for event in pending:
                seq = event["seq"] + 1
                yield f"data: {json.dumps(event)}\n\n"
            if run.status in ("complete", "error", "cancelled") and not pending:
                yield f"data: {json.dumps({'type': 'stream.end'})}\n\n"
                return
            await asyncio.sleep(0.25)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# -- history --------------------------------------------------------------


@app.get("/api/history")
def get_history():
    return history.entries()


# -- portfolio / market ---------------------------------------------------


@app.get("/api/portfolio")
def get_portfolio():
    return _call(portfolio.dashboard, brokers.active)


@app.get("/api/portfolio/headlines")
def get_position_headlines(symbols: str = Query("")):
    wanted = [s for s in symbols.split(",") if s]
    return portfolio.position_headlines(wanted)


@app.get("/api/macro")
def get_macro():
    return {
        "news": market.macro_news(),
        "prediction_markets": market.prediction_markets(),
        "window": market.market_window(),
    }


@app.get("/api/quote/{ticker}")
def get_quote(ticker: str):
    return {"quote": market.quote(ticker), "spark": market.sparkline(ticker)}


@app.get("/api/watchlist")
def get_watchlist():
    symbols = store.get_watchlist()
    quotes = {}
    if symbols and brokers.active.connected:
        try:
            quotes = brokers.active.quotes(symbols)
        except BrokerError:
            quotes = {}
    return [
        {
            "sym": s,
            "last": (quotes.get(s) or {}).get("last"),
            "change_pct": (quotes.get(s) or {}).get("change_pct"),
        }
        for s in symbols
    ]


@app.post("/api/watchlist")
def add_watchlist(symbol: str = Body(..., embed=True)):
    store.add_to_watchlist(symbol)
    return {"watchlist": store.get_watchlist()}


@app.delete("/api/watchlist/{symbol}")
def remove_watchlist(symbol: str):
    store.remove_from_watchlist(symbol)
    return {"watchlist": store.get_watchlist()}


# -- trading --------------------------------------------------------------


@app.post("/api/trade/quotes")
def trade_quotes(symbols: list[str] = Body(..., embed=True)):
    """Top-of-book bid/ask for the order ticket."""
    return _call(brokers.active.quotes, symbols)


@app.post("/api/trade/preflight")
def trade_preflight(order: OrderRequest):
    """Validate and cost an order. Places nothing.

    Returns a ``token`` that :func:`trade_order` requires, so an order can
    never be submitted without having been reviewed first.
    """
    return _call(brokers.active.preflight, order.model_dump())


@app.post("/api/trade/order")
def trade_order(request: PlaceRequest):
    """Submit a real order to the active brokerage.

    The console always runs a preflight first and requires an explicit second
    confirmation before calling this — an agent decision never reaches here on
    its own.
    """
    return _call(brokers.active.place, request.order.model_dump(), request.token)


@app.get("/api/trade/order/{order_id}")
def trade_order_status(order_id: str):
    return _call(brokers.active.order_status, order_id)


@app.delete("/api/trade/order/{order_id}")
def trade_cancel(order_id: str):
    _call(brokers.active.cancel, order_id)
    return {"status": "cancelled"}


# -- static ---------------------------------------------------------------

if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """Serve the console, letting the client router own unknown paths."""
        candidate = WEB_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")


def main():
    import uvicorn

    uvicorn.run(
        "ui.server.app:app",
        host=os.getenv("CONSOLE_HOST", "127.0.0.1"),
        port=int(os.getenv("CONSOLE_PORT", "8551")),
        reload=False,
    )


if __name__ == "__main__":
    main()
