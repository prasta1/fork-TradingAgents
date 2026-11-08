# TradingAgents — Local Setup (MBP + Studio)

Multi-agent LLM financial trading framework running entirely on local hardware — no cloud API keys required.

## Architecture

```
┌─────────────────┐    HTTPS (9292) ───┐         ┌──────────┐
│  Mac Studio     │                   │         │  MBP     │
│  llama-swap     │◄── tailnet ───────┼────────►│  Console │
│  ms-* models    │                   │  http   │  :8551   │
└─────────────────┘                   │         └──────────┘
                                      │
┌─────────────────┐    HTTP (8999)     │
│  MacBook Pro    │◄──────────────────┘
│  (same machine) │
└─────────────────┘
```

- **Studio** runs `llama-swap` on port 9292 (HTTPS via `studio.taile85139.ts.net`)
- **MBP** (this machine) runs the web console, which proxies LLM calls to the Studio over Tailscale
- The configured model is `ms-qwen3.6-35b-a3b`
- Studio model ids are prefixed `ms-` (the Studio's llama-swap serves them from its `/v1/models`)

## Quick Start

### 1. Go to the repo

```bash
cd /Users/prasta/Projects/forks/fork-tradingagents
```

No activation needed — the commands below call the venv's Python directly.

### 2. Build the console (first time, or after front-end changes)

```bash
cd ui/web && npm install && npm run build && cd ../..
```

### 3. Start the console

```bash
.venv/bin/python -m uvicorn ui.server.app:app --host 0.0.0.0 --port 8551
```

Use `.venv/bin/python -m uvicorn`, not `.venv/bin/uvicorn` or a bare `uvicorn`:

- The venv was created at the old `Projects/Trading/TradingAgents` path, so the
  shebang in `.venv/bin/uvicorn` (and every other script there) points at a folder
  that no longer exists and fails with "No such file or directory".
- A bare `uvicorn` may resolve to Homebrew's `/opt/homebrew/bin/uvicorn` on a
  different Python, giving `ModuleNotFoundError: No module named 'dotenv'`.

If it fails with **address already in use**, something is already on 8551:

```bash
lsof -nP -iTCP:8551 -sTCP:LISTEN     # see what
kill <pid>
```

Then open:
- Local: `http://127.0.0.1:8551`
- Tailnet: `http://100.68.81.83:8551` (from Studio or any Tailscale device)

For front-end work, run Vite's dev server alongside it for hot reload — it proxies
`/api` to port 8551:

```bash
cd ui/web && npm run dev     # http://127.0.0.1:5173
```

### 4. Run an analysis

1. Go to **Deploy run**
2. Enter a ticker (e.g. `AAPL`, `TSLA`, `BTC-USD`) and an analysis date
3. Pick the analyst team, provider and models, and debate/risk rounds
4. Click **Initialize agent run**

**Live run** lights up each of the 12 graph nodes as it executes, streams the log,
and shows each agent's report as it lands. The Portfolio Manager's decision appears
in the right rail when the graph reaches the end.

## Console screens

| Screen | What it shows |
|---|---|
| Dashboard | Live Public.com positions, net worth, allocation, joined to the agent rating for each holding |
| Trade desk | Order entry against Public.com — preflight, then explicit confirm |
| Research hub | Quote, 1M price action, watchlist, and the latest run's analyst reports |
| Debate room | Bull vs bear exchange, Research Manager verdict, risk team |
| Deploy run | Run configuration + live config preview |
| Live run | The 12-node pipeline executing, with per-node reports |
| Run history | Every entry in `trading_memory.md` with realised return, alpha and reflection |
| Strategy | Design mockup — there is no backtest engine in this repo |
| Settings | Which credentials are detected, data vendors, on-disk paths |

## Brokerage (optional)

Dashboard and Trade desk read and trade a real brokerage account. Two are
supported; pick the active one under **Settings → Brokerage**.

All credentials go in `.env` at the repo root — there is deliberately no field in
the UI for them, because both providers' secrets must never reach client-side
code. Restart the server after editing.

### Public.com

Generate a secret key at [public.com/settings/security/api](https://public.com/settings/security/api):

```bash
PUBLIC_API_SECRET=your_secret_key
# PUBLIC_ACCOUNT_ID=...   # optional; the first brokerage account is used otherwise
```

That's the whole setup — the server exchanges the secret for a short-lived access
token on its own.

### E\*TRADE

Request a key at [developer.etrade.com](https://developer.etrade.com/getting-started).
An **individual** key (tied to your own login) is issued immediately once you
complete the API Developer Agreement and User Intent Survey.

```bash
ETRADE_CONSUMER_KEY=your_consumer_key
ETRADE_CONSUMER_SECRET=your_consumer_secret
# ETRADE_SANDBOX=1   # use apisb.etrade.com with your sandbox key
```

E\*TRADE additionally needs a **one-time authorization each day**, because its
OAuth 1.0a tokens expire at midnight US/Eastern. Go to **Settings → Brokerage →
Connect**: the console gives you an E\*TRADE link, you sign in there, and you
paste back the verification code E\*TRADE displays. Your E\*TRADE credentials
never touch this app. The token is cached at `~/.tradingagents/etrade_token.json`
(mode 600) so a server restart doesn't force you to redo it.

### Order safety

Both brokers use the same two-step flow: **Review order** runs a preflight (which
places nothing), and only then can you **Place order**, which asks for one more
explicit confirmation naming the brokerage. Editing any field invalidates the
review. An agent decision only pre-fills the ticket — nothing is ever submitted
automatically. E\*TRADE enforces this server-side too: it will not accept an order
without the `previewId` from a preview.

Without credentials those two screens say so, and the rest of the console works
normally.

## What the agents do

The pipeline runs 8+ specialized LLM agents:

| Agent | Role |
|---|---|
| Market Analyst | Pulls Yahoo Finance price data, technical indicators |
| Sentiment Analyst | Scrapes Reddit, StockTwits, news for sentiment |
| News Analyst | Monitors global news + macro events |
| Fundamental Analyst | Reviews financials, balance sheets, cash flow |
| Bull Researcher | Builds the case for buying |
| Bear Researcher | Finds risks and arguments against |
| Trader | Synthesizes everything into a trade proposal |
| Risk Manager | Stress-tests the proposal under downside scenarios |
| Portfolio Manager | Final approval / position sizing |

## CLI (alternative to web UI)

```bash
# Interactive CLI
python -m cli.main

# Programmatic API
python3 -c "
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG
ta = TradingAgentsGraph(debug=True, config=DEFAULT_CONFIG.copy())
_, decision = ta.propagate('AAPL', '2025-03-14')
print(decision)
"
```

## Configuration

The `.env` file controls which LLM the agents use:

```bash
TRADINGAGENTS_LLM_PROVIDER=openai_compatible
TRADINGAGENTS_DEEP_THINK_LLM=ms-qwen3.6-35b-a3b
TRADINGAGENTS_QUICK_THINK_LLM=ms-qwen3.6-35b-a3b
TRADINGAGENTS_LLM_BACKEND_URL=https://studio.taile85139.ts.net:9292/v1
TRADINGAGENTS_TEMPERATURE=0.2
```

To use a different model, update the deep/quick model names. List what the backend serves right now with:

```bash
curl -s https://studio.taile85139.ts.net:9292/v1/models | python3 -c "import sys,json; print('\n'.join(m['id'] for m in json.load(sys.stdin)['data']))"
```

Chat models on the Studio (`:9292`) as of 2026-11-08: `ms-qwen3.6-35b-a3b`, `ms-qwen3-30b-a3b-2507`, `ms-qwen3-14b`, `ms-qwen3-coder-30b`, `ms-qwen3-vl-8b`, `ms-qwen3.5-4b-mtp`, `ms-qwythos-27b-v1`, `ms-devstral-24b`, `ms-kat-coder-v2.5`, `ms-laguna-xs-2.1`, `ms-lfm2.5-24b-qad`, `ms-lfm3-1.7b`, `ms-minicpm-v-4.7`, `ms-minicpm-v-4.7-hires`, `ms-ministral-3-3b`, `sushi`. The endpoint also serves embedding models (`ms-bge-*`) and audio/omni models (`ms-lfm3-audio-2b`, `ms-lfm3-omni-2b`), which aren't usable as agent LLMs.

The MBP backend (`:8999`) wasn't running when this was checked, so its model list isn't recorded here.

## File layout

```
TradingAgents/
├── .venv/              # Python virtual environment
├── .env                # LLM config (gitignored)
├── ui/server/          # FastAPI backend: graph streaming, market data, brokerage
├── ui/web/             # React console (Vite); `npm run build` emits ui/web/dist
├── cli/main.py         # Typer CLI
├── tradingagents/      # Core framework (agents, graph, tools)
├── models/             # Local results/reports output
├── main.py             # Example script
├── pyproject.toml      # Package dependencies
└── README.md           # Upstream TradingAgents documentation
```

## Tips

- **First run is slowest** — llama-swap spins up the model (30-60s), then each agent LLM call adds latency. Total run: ~5-10 minutes.
- **Subsequent runs are faster** — the model stays warm for 15 minutes.
- **Reddit rate limits** — the social sentiment agent may hit 429s; it retries automatically.
- **FRED API** — macro indicators require a free [FRED key](https://fred.stlouisfed.org/docs/api/api_key.html). Set `FRED_API_KEY` in `.env` to enable.
- **Reports are saved** — each completed analysis writes a markdown report to `~/.tradingagents/results/reports/`.
