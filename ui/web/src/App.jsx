import { useEffect, useState } from 'react'
import { api } from './api.js'
import { C, MONO, label9 } from './theme.js'
import { useRun } from './useRun.js'
import AlertBell from './components/AlertBell.jsx'

import BatchRun from './screens/BatchRun.jsx'
import DebateRoom from './screens/DebateRoom.jsx'
import DeployRun from './screens/DeployRun.jsx'
import Holdings from './screens/Holdings.jsx'
import LiveRun from './screens/LiveRun.jsx'
import Portfolio from './screens/Portfolio.jsx'
import ResearchHub from './screens/ResearchHub.jsx'
import RunHistory from './screens/RunHistory.jsx'
import Scorecard from './screens/Scorecard.jsx'
import Settings from './screens/Settings.jsx'
import Strategy from './screens/Strategy.jsx'
import TradeDesk from './screens/TradeDesk.jsx'

const NAV = [
  { title: 'PORTFOLIO', items: [['portfolio', 'Dashboard'], ['holdings', 'Live portfolio'], ['scorecard', 'Scorecard'], ['trade', 'Trade desk']] },
  { title: 'RESEARCH', items: [['research', 'Research hub'], ['debate', 'Debate room']] },
  {
    title: 'AGENTS',
    items: [['deploy', 'Deploy run'], ['batch', 'Batch run'], ['run', 'Live run'], ['history', 'Run history']],
  },
  { title: 'BUILD', items: [['strategy', 'Strategy'], ['settings', 'Settings']] },
]

const TITLES = {
  portfolio: ['Portfolio', 'positions the agents trade against'],
  holdings: ['Live portfolio', 'every account · API + statements'],
  scorecard: ['Scorecard', 'Wealthfront trades vs agent ratings'],
  trade: ['Trade desk', 'order entry · Public.com'],
  research: ['Research hub', 'analyst intelligence'],
  debate: ['Debate room', 'bull vs bear · research manager'],
  deploy: ['Deploy run', 'bundle configuration'],
  batch: ['Batch run', 'every holding · one after another'],
  run: ['Live run', 'LangGraph execution'],
  history: ['Run history', 'decision log + reflections'],
  strategy: ['Strategy', 'logic + backtest'],
  settings: ['Settings', 'providers · vendors · paths'],
}

export default function App() {
  const [screen, setScreen] = useState('run')
  const [boot, setBoot] = useState(null)
  const [ticker, setTicker] = useState('AAPL')
  const [tradeDate, setTradeDate] = useState('')
  const [bootError, setBootError] = useState(null)
  const runCtl = useRun()

  useEffect(() => {
    api
      .bootstrap()
      .then((data) => {
        setBoot(data)
        setTradeDate(data.trade_date)
        if (data.active_run) {
          runCtl.attach(data.active_run.run_id)
          setTicker(data.active_run.request.ticker)
          // Land on Live run only while something is executing; a finished run
          // is restored but should not hijack the landing screen.
          if (data.active_run.status !== 'running') setScreen('portfolio')
        } else {
          setScreen('portfolio')
        }
      })
      .catch((err) => setBootError(err.detail || err.message))
    // Bootstrap runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (bootError) {
    return (
      <div style={{ padding: 40, fontFamily: MONO, fontSize: 13, color: C.red }}>
        Console backend unreachable — {bootError}
        <div style={{ color: C.t5, marginTop: 10 }}>
          Start it with: uvicorn ui.server.app:app --port 8551
        </div>
      </div>
    )
  }

  if (!boot) {
    return (
      <div style={{ padding: 40, fontFamily: MONO, fontSize: 12, color: C.t6 }}>
        connecting…
      </div>
    )
  }

  const shared = {
    boot,
    ticker,
    setTicker,
    tradeDate,
    setTradeDate,
    goto: setScreen,
    ...runCtl,
  }

  const screens = {
    portfolio: <Portfolio {...shared} />,
    holdings: <Holdings {...shared} />,
    scorecard: <Scorecard {...shared} />,
    trade: <TradeDesk {...shared} />,
    research: <ResearchHub {...shared} />,
    debate: <DebateRoom {...shared} />,
    deploy: <DeployRun {...shared} />,
    batch: <BatchRun {...shared} />,
    run: <LiveRun {...shared} />,
    history: <RunHistory {...shared} />,
    strategy: <Strategy {...shared} />,
    settings: <Settings {...shared} />,
  }

  const running = runCtl.run.status === 'running'
  const [title, sub] = TITLES[screen]

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: C.bg }}>
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        running={running}
        defaults={boot.defaults}
        version={boot.version}
        openRun={(runId) =>
          runCtl
            .attach(runId)
            .then(() => setScreen('run'))
            // Runs live in server memory; after a restart only the history remains.
            .catch(() => setScreen('history'))
        }
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header
          title={title}
          sub={screen === 'research' ? `${ticker} · ${sub}` : sub}
          ticker={ticker}
          tradeDate={tradeDate}
          onNewRun={() => setScreen('deploy')}
        />
        {screens[screen]}
      </main>
    </div>
  )
}

function Sidebar({ screen, setScreen, running, defaults, version, openRun }) {
  return (
    <aside
      style={{
        width: 214,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: C.sidebar,
        borderRight: `1px solid ${C.border}`,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '18px 18px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: C.text }}>
          PitPal
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.06em', color: C.t6, marginTop: 3 }}>
          CONSOLE · v{version}
        </div>
      </div>

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {NAV.map((group) => (
          <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ ...label9, padding: '0 10px 6px' }}>{group.title}</div>
            {group.items.map(([id, itemLabel]) => {
              const active = screen === id
              const badge = id === 'run' && running ? 'live' : ''
              return (
                <button
                  key={id}
                  className="nav-item"
                  onClick={() => setScreen(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 10px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: active ? C.panelHi : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 9999,
                      flex: 'none',
                      background: active ? C.green : C.t9,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                      color: active ? C.text : C.t3,
                    }}
                  >
                    {itemLabel}
                  </span>
                  {badge && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 9.5,
                        color: C.green,
                        animation: 'tapulse 1.4s infinite',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          flex: 'none',
          padding: '14px 16px',
          borderTop: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        <AlertBell openRun={openRun} goto={setScreen} />
        <div style={{ ...label9, marginTop: 6 }}>ACTIVE PROVIDER</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: C.green, flex: 'none' }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.t2 }}>{defaults.llm_provider}</span>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            fontFamily: MONO,
            fontSize: 10,
            color: C.t6,
            wordBreak: 'break-all',
          }}
        >
          <div>deep&nbsp;&nbsp;{defaults.deep_think_llm}</div>
          <div>quick&nbsp;{defaults.quick_think_llm}</div>
        </div>
      </div>
    </aside>
  )
}

function Header({ title, sub, ticker, tradeDate, onNewRun }) {
  const pill = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 11px',
    borderRadius: 4,
    background: C.panel,
    border: `1px solid ${C.border2}`,
  }
  return (
    <header
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 22px',
        height: 54,
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.t6 }}>{sub}</div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={pill}>
          <span style={{ fontSize: 11, color: C.t5 }}>Ticker</span>
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.text }}>
            {ticker}
          </span>
        </div>
        <div style={pill}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.t2 }}>{tradeDate}</span>
        </div>
        <button
          className="btn-green"
          onClick={onNewRun}
          style={{
            padding: '8px 15px',
            borderRadius: 4,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            background: C.green,
            color: C.greenFg,
          }}
        >
          New run
        </button>
      </div>
    </header>
  )
}
