# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner, at a desk on a MacBook Pro, in focused sessions. Not shared, not demoed. The owner is a former business-development and customer-success executive who is learning to code, and trades their own money across several accounts.

## Product Purpose

A local-first console over the TradingAgents multi-agent LLM framework. Agents research a ticker, argue it out, and produce a rating with target, stop, size and horizon; the console then connects that judgement to the owner's real brokerage accounts.

Today it is a decision aid: every order is reviewed and confirmed by hand. The stated direction is **toward automation** — agents eventually placing trades within limits the owner sets. Success is agent judgement trustworthy enough, and auditable enough, to earn that autonomy step by step.

## Positioning

Every model runs on the owner's own hardware (llama-swap on a Mac Studio, reached over Tailscale), so research costs no API spend and nothing leaves the tailnet. The agents' calls are scored against what the owner and a robo-advisor (Wealthfront) actually did, not against a backtest alone.

## Operating Context

- Console served by FastAPI on the MacBook at `127.0.0.1:8551`; React/Vite front end in `ui/web`, built to `ui/web/dist`.
- LLM inference on the Mac Studio (`studio-*` model ids) and the MacBook (`macbook-*`), via OpenAI-compatible endpoints.
- A run takes minutes: analysts in parallel, bull/bear debate, research manager, trader, three risk analysts, portfolio manager. Results append to `trading_memory.md`, which later records realised return and a reflection.
- Brokers: Public.com (API secret in `.env`) and E*TRADE (consumer key plus a one-time authorization each day) for live trading; Wealthfront via exported QFX statements, read-only.

## Capabilities and Constraints

- **Real money is live.** Orders go to real accounts. The ticket is two-step by construction: preflight review, then an explicit confirm. An agent proposal pre-fills the ticket and never submits.
- Brokers reject prices finer than a cent; quotes can arrive with sub-cent precision.
- Past-dated runs see only data known on that date.
- Single user, no auth layer beyond the tailnet.
- **Undecided:** what limits govern agent autonomy (per-order size, daily exposure, which accounts, which ratings may act unattended), and how an autonomous action is surfaced, paused and reversed.

## Brand Commitments

"PitPal" is a working name only — do not build identity around it yet. The upstream project is TradingAgents (fork: `prasta1/fork-TradingAgents`).

## Evidence on Hand

- Real account data through the connected brokers and Wealthfront statements.
- `trading_memory.md` run history with realised returns and reflections.
- `scorecard_screenshot.png`: a populated Scorecard from an earlier build.
- No backtest or strategy performance exists yet. The Strategy screen is a mockup; its figures are illustrative and must not be presented as results.

## Product Principles

1. **Opinion is never mistaken for money.** Agent output and broker truth must stay unmistakably distinct everywhere they meet.
2. **Autonomy is earned, not assumed.** Every step toward automation is bounded by owner-set limits, visible, and reversible.
3. **Every decision is auditable.** A trade traces back to the run, the debate and the data that motivated it; a rating traces forward to what actually happened.
4. **Broken is never shown as empty.** On a money console, a failed call must look different from no data.
5. **Local-first is the point.** Nothing should require a cloud service the owner does not already choose to use.
