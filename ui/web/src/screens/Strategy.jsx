import { MockupBadge, Panel } from '../components/ui.jsx'
import { C, MONO, label9, label95 } from '../theme.js'

// Sample content from the design. There is no strategy runner or backtest
// engine in this repo, so nothing on this screen is computed — it exists to
// hold the shape of the feature until one is built.
const CODE = [
  ['1', 'def on_data(slice):', '#c792ea'],
  ['2', '', C.t2],
  ['3', '  # entry — agent-gated', C.t5],
  ['4', '  if RSI(14) < 30 and volume > avg_volume(20):', C.t1],
  ['5', '    plan = agents.propagate(ticker, date)', C.t1],
  ['6', '    if plan.rating in ("Buy", "Overweight"):', C.t1],
  ['7', '      execute_order(action="BUY", type="MARKET")', C.green],
  ['8', '', C.t2],
  ['9', '  # exit', C.t5],
  ['10', '  elif RSI(14) > 70:', C.t1],
  ['11', '    close_position()', C.red],
]

const BACKTEST = [
  ['Total return', '+24.8%', C.green],
  ['Sharpe ratio', '1.84', C.text],
  ['Max drawdown', '-12.4%', C.red],
  ['Win rate', '58.2%', C.text],
  ['Trades', '147', C.text],
  ['Alpha vs SPY', '+9.1%', C.green],
]

const HISTOGRAM = [
  ['18%', '#5a2f33'],
  ['32%', '#7a3a3f'],
  ['54%', '#a04a4a'],
  ['71%', '#2f6b52'],
  ['100%', C.green],
  ['64%', '#3d8f6b'],
  ['38%', '#2f6b52'],
  ['21%', '#26523f'],
]

const RISK_PARAMS = [
  ['Max position size', '5', '%'],
  ['Stop loss', '2.5', '%'],
  ['Take profit', '7.5', '%'],
  ['Max concurrent', '6', ''],
]

export default function Strategy() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <MockupBadge>
        Design only. This repo has no strategy runner or backtest engine, so every number below is
        sample data from the design — nothing here reads or writes real state.
      </MockupBadge>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: C.text }}>
          Momentum Alpha v4
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 11px',
            borderRadius: 4,
            background: C.panel,
            border: `1px solid ${C.border2}`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: C.t5 }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.t2 }}>not deployed</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 1240 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Logic builder" meta="python · agent-gated entry" pad={0}>
            <div style={{ padding: '16px 0', background: C.inputBg }}>
              {CODE.map(([n, text, color]) => (
                <div
                  key={n}
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '1px 18px',
                    fontFamily: MONO,
                    fontSize: 12.5,
                    lineHeight: 1.75,
                  }}
                >
                  <span style={{ width: 18, flex: 'none', textAlign: 'right', color: C.t9 }}>{n}</span>
                  <span style={{ whiteSpace: 'pre', color }}>{text}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Latest backtest" meta="sample data">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
              {BACKTEST.map(([k, v, c]) => (
                <div
                  key={k}
                  style={{
                    border: `1px solid ${C.border2}`,
                    borderRadius: 6,
                    background: C.panelHi,
                    padding: 13,
                  }}
                >
                  <div style={{ ...label95, fontSize: 9.5, letterSpacing: '.06em' }}>{k}</div>
                  <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 500, color: c, marginTop: 6 }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ ...label9, marginBottom: 11 }}>WIN / LOSS DISTRIBUTION · 147 TRADES</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
              {HISTOGRAM.map(([h, c], i) => (
                <div key={i} style={{ flex: 1, borderRadius: '2px 2px 0 0', background: c, height: h }} />
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Risk management" pad={0} style={{ width: 300, flex: 'none' }}>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {RISK_PARAMS.map(([k, v, u]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={label95}>{k}</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 11px',
                    borderRadius: 4,
                    background: C.inputBg,
                    border: `1px solid ${C.border3}`,
                  }}
                >
                  <span style={{ flex: 1, fontFamily: MONO, fontSize: 13, color: C.text }}>{v}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.t7 }}>{u}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
