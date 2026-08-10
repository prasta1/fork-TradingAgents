# TradingAgents — Local Deployment Guide (MBP + Studio)

**Multi-agent LLM financial trading framework running entirely on local hardware — no cloud API keys required.**

Built on the [TradingAgents](https://github.com/TauricWar/TradingAgents) open-source project. The upstream README is in [`README.md`](README.md). This file documents the local deployment, infrastructure, and upcoming changes.

## Architecture

```
┌─────────────────────┐   HTTPS (9292) ───┐      ┌──────────────┐
│  Mac Studio         │                   │      │  MacBook Pro │
│  LLM inference      │◄── tailnet ───────┼─────►│  Console    │
│  studio-* models    │                   │ http │  UI: 8551    │
└─────────────────────┘                   │      └──────────────┘
                                          │      ┌──────────────┐
┌─────────────────────┐  HTTP (8999)     │      │  llama-swap │
│  MacBook Pro        │◄─────────────────┘      │  :8999       │
│  Secondary node     │                         └──────────────┘
└─────────────────────┘
                                          ┌──────────────┐
                                          │  Dashboard   │
                                          │  :8710       │
                                          └──────────────┘
```

- **Studio** runs `llama-swap` on port 9292 (exposed via Tailscale Funnel HTTPS)
- **MBP** (this machine) runs the web console on port 8551, proxying LLM calls to the Studio over the tailnet
- **Dashboard server** runs on the MBP on port 8710, providing a unified view of both llama-swap nodes

---

## Quick Start

### 1. Activate the environment

```bash
source /Users/prasta/Projects/Trading/TradingAgents/.venv/bin/activate
cd /Users/prasta/Projects/Trading/TradingAgents
```

### 2. Start the console

```bash
# first time, or after front-end changes
cd ui/web && npm install && npm run build && cd ../..

.venv/bin/uvicorn ui.server.app:app --host 0.0.0.0 --port 8551
```

Use the venv path, not a bare `uvicorn` — Homebrew ships one on a different
Python that lacks this project's dependencies.

### 3. Access from any device

| Access | URL |
|---|---|
| **Local** (Console) | http://127.0.0.1:8551 |
| **Tailnet** (Console, from any Tailscale device) | http://100.68.81.83:8551 |
| **Browser** (Dashboard, any tailnet device) | https://macbookpro.taile85139.ts.net:8710/ |
| **Local** (Dashboard) | http://127.0.0.1:8710/ |

### 4. Run an analysis

1. Open the console (link above) and go to **Deploy run**
2. Enter a ticker (e.g. `AAPL`, `TSLA`, `BTC-USD`) and an analysis date
3. Pick the analyst team, provider/models, and debate/risk rounds (1-2 to start)
4. Click **Initialize agent run**

**Live run** lights up each of the 12 graph nodes as it executes and streams each
agent's report as it lands. Completed runs append to `trading_memory.md` and show
up under **Run history** with their realised return and reflection.

---

## LLM Swap Dashboard

Monitor both inference nodes from one pane:

| Access | URL |
|---|---|
| **Browser (anywhere on tailnet)** | https://macbookpro.taile85139.ts.net:8710/ |
| **Local** | http://127.0.0.1:8710/ |
| **API status** | https://macbookpro.taile85139.ts.net:8710/api/status |

The dashboard (`/api/status`) provides enriched data:

- **Loaded vs. total** model count per node (e.g., "1/10 loaded")
- **Standby models** — full list of configured but unloaded models, collapsible in the browser UI
- **TTL/resident** status — resident models (stay loaded) vs. on-demand (auto-unload after 900s idle)
- **File sizes** — GGUF file sizes in GB for locally-accessible models
- **Response latency** — sparkline chart showing API response times
- **GPU info** — VRAM usage, utilization, and temperature (when llama-server supports the `/ps` endpoint)

**TUI widget**: While in the Hermes TUI, type `/llama-swap-dashboard` to dock the live status panel.

---

## Infrastructure

| Component | Config |
|---|---|
| llama-swap (Studio) | `/Users/macstudio/.hermes/llama-swap/config.yaml` |
| llama-swap (MBP) | `~/.hermes/llama-swap/config.yaml` |
| llama-swap run script (Studio) | `/Users/macstudio/.hermes/llama-swap/run.sh` — listens on `127.0.0.1:9292` |
| llama-swap run script (MBP) | `~/.hermes/llama-swap/run.sh` — listens on `127.0.0.1:8999` |
| Dashboard server | `~/.hermes/tui-widgets/server.py` — proxies both nodes with CORS headers |
| Dashboard HTML | `~/.hermes/tui-widgets/llama-swap-dashboard.html` |
| Dashboard TUI widget | `~/.hermes/tui-widgets/llama-swap-dashboard.mjs` |
| Tailscale Funnel (Studio) | `https://studio.taile85139.ts.net:9292/` → `http://127.0.0.1:9292` |
| Tailscale Funnel (MBP) | `https://macbookpro.taile85139.ts.net:8710/` → `http://127.0.0.1:8710` |

### Current model inventory

Model ids are host-prefixed so the two backends can be listed side by side without colliding.

- **Studio** (10 configured): studio-bge-m3-1024, studio-bge-small-384, studio-devstral-24b, studio-gemma-4-12b, studio-gemma-4-26b-moe, studio-glm-4-6-vision, studio-ministral-14b, studio-nemotron-30b-omni, studio-qwen3-coder-next, studio-qwen3-6-27b
- **MBP** (5 configured): macbook-devstral-24b, macbook-gemma-4-12b, macbook-gemma-4-31b, macbook-nemotron-4b, macbook-smollm3-3b

Both hosts still carry `aliases` mapping the old un-prefixed ids, as a temporary migration bridge.

---

## Configuration

The `.env` file holds runtime overrides for TradingAgents itself. See `.env.example` for all options.

llama-swap config is hot-reloaded (`--watch-config`), so editing the config files applies without a restart.

---

## The console

The Streamlit UI has been replaced by a web console (`ui/server` + `ui/web`) built
from the TradingAgents Console design. What changed materially:

- **Real per-node progress.** The console drives `graph.graph.stream(stream_mode="updates")`
  directly, so every chunk carries a node name. Streamlit scraped stdout and threw
  away `final_state`; the console keeps every analyst report, both debate states and
  the trader plan, and renders each as its node completes.
- **No monkeypatching.** No `builtins.print` patch, no process-global log queue, no
  cross-thread `st.session_state` writes, no 1 Hz full-page rerun.
- **Reconnectable.** Each run's event log is replayed on connect, so reloading the
  page mid-run resumes exactly where it was.
- **Brokerage integration.** Dashboard and Trade desk read and trade a live
  Public.com account (see README.local.md).

Runs are serialised one at a time on purpose: `TradingAgentsGraph.__init__` calls
`set_config` on a process-global, so concurrent runs with different configs would
corrupt each other's data-vendor settings. A second start returns HTTP 409.

### Known gaps

- **Strategy screen is a mockup.** There is no strategy runner or backtest engine in
  this repo, so that screen renders sample data behind a visible badge.
- **Cancel is cooperative.** LangGraph cannot be interrupted mid-node, so cancelling
  stops after the current node finishes.
- **Market depth is top-of-book.** Public's market-data API returns best bid/ask
  only, not a full depth ladder.

A native SwiftUI macOS client remains a possible future direction; nothing has been
built for it (`ui/native/` does not exist).
