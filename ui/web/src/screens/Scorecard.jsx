import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtNum } from '../api.js'
import { Empty, L95, L9, Notice, Panel } from '../components/ui.jsx'
import { C, MONO, label95, ratingStyle } from '../theme.js'

// What each agreement outcome looks like.
const AGREE_STYLE = {
  agree: { label: 'AI AGREES', c: C.green, bg: C.greenBg },
  disagree: { label: 'AI DISAGREES', c: C.red, bg: C.redBg },
  neutral: { label: 'NEUTRAL', c: C.amber, bg: '#241a0a' },
  unrated: { label: 'NO AI RUN', c: C.t5, bg: C.panelDeep },
}

const COLS = '1fr .9fr 1.1fr 1fr 1fr 1.4fr'

export default function Scorecard({ goto, setTicker }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .wealthfrontScorecard()
      .then(setData)
      .catch((err) => setError(err.detail || err.message))
  }, [])

  if (error) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Notice tone="warn" title="Scorecard unavailable">
          {error}
        </Notice>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ flex: 1, padding: '24px 26px', fontFamily: MONO, fontSize: 12, color: C.t6 }}>
        loading scorecard…
      </div>
    )
  }

  // If the server couldn't find the QFX export, show a friendly empty state.
  if (data.error) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Notice title="No Wealthfront export loaded">{data.error}</Notice>
        <div style={{ marginTop: 20 }}>
          <Empty>
            {'How this works:\n' +
              '1. In Wealthfront: Documents → Export to Quicken®\n' +
              '2. Save the QFX file to ~/Downloads/2025.QFX\n' +
              '3. Reload this screen — trades appear with the agent rating in effect on each trade date'}
          </Empty>
        </div>
      </div>
    )
  }

  const s = data.summary
  const agreePct = s.agree_pct !== null && s.agree_pct !== undefined ? `${s.agree_pct}%` : '—'

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      {/* headline stats */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="DISCRETIONARY TRADES" value={fmtNum(s.total_trades, 0)} />
        <Stat label="WITH AI RATING" value={fmtNum(s.counted, 0)} />
        <Stat label="AGREEMENT" value={agreePct} color={C.green} />
        <Stat label="AGREE" value={fmtNum(s.agree, 0)} color={C.green} />
        <Stat label="DISAGREE" value={fmtNum(s.disagree, 0)} color={C.red} />
        <Stat label="NO RATING YET" value={fmtNum(s.no_rating, 0)} color={C.t5} />
      </div>

      <Panel
        title="Wealthfront vs agents"
        meta={`${data.trades.length} buys/sells · joined to the rating in effect on trade date`}
        pad={0}
        right={
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {['agree', 'disagree', 'neutral', 'unrated'].map((k) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: AGREE_STYLE[k].c }} />
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t6 }}>{AGREE_STYLE[k].label}</span>
              </span>
            ))}
          </div>
        }
      >
        {data.trades.length === 0 && (
          <div style={{ padding: 18, fontFamily: MONO, fontSize: 11, color: C.t7 }}>
            no discretionary trades in this export
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            padding: '9px 18px',
            background: C.panelHi,
            borderBottom: `1px solid ${C.border2}`,
          }}
        >
          {['DATE', 'TRADE', 'SIZE', 'WF PRICE', 'AI RATING', 'VERDICT'].map((h, i) => (
            <span key={h} style={{ ...label95, textAlign: i === 0 ? 'left' : 'right' }}>
              {h}
            </span>
          ))}
        </div>
        {data.trades.map((t, i) => (
          <TradeRow key={`${t.fitid}-${i}`} t={t} onPick={() => {
            setTicker(t.symbol)
            goto('research')
          }} />
        ))}
      </Panel>

      <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10.5, color: C.t7, lineHeight: 1.6 }}>
        {'Verdict = does the agent rating in effect at the trade date agree with the direction Wealthfront took.\n' +
          'Tax-loss harvest sells and direct-indexing swaps are marked against the same ratings — a disagree on those is the tax-alpha vs fundamental-alpha tradeoff.'}
      </div>
    </div>
  )
}

function Stat({ label, value, color = C.text }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border2}`,
        borderRadius: 8,
        background: C.panel,
        padding: '12px 18px',
        minWidth: 140,
      }}
    >
      <L9 style={{ marginBottom: 6 }}>{label}</L9>
      <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function TradeRow({ t, onPick }) {
  const ag = AGREE_STYLE[t.agreement] || AGREE_STYLE.unrated
  const rs = t.ai_rating ? ratingStyle(t.ai_rating) : { c: C.t6, bg: C.panelDeep }
  const buy = t.action === 'BUY'

  return (
    <div
      className="row-hover"
      onClick={onPick}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        alignItems: 'center',
        padding: '10px 18px',
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.t4 }}>{t.date}</span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: C.text }}>{t.symbol}</span>
        <span style={{ fontSize: 10.5, color: C.t6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.name}
        </span>
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'right' }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            fontWeight: 600,
            color: buy ? C.green : C.red,
          }}
        >
          {t.action}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t5 }}>{fmtNum(t.units, 4)} sh</span>
      </span>

      <span style={{ fontFamily: MONO, fontSize: 12, color: C.t2, textAlign: 'right' }}>
        {t.unit_price !== null && t.unit_price !== undefined ? fmtMoney(t.unit_price) : '—'}
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {t.ai_rating ? (
          <>
            <span style={{ fontFamily: MONO, fontSize: 11, padding: '4px 9px', borderRadius: 3, background: rs.bg, color: rs.c }}>
              {t.ai_rating}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t6 }}>{t.ai_date}</span>
          </>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t7 }}>no run</span>
        )}
      </span>

      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '.05em',
            padding: '5px 10px',
            borderRadius: 3,
            background: ag.bg,
            color: ag.c,
            whiteSpace: 'nowrap',
          }}
        >
          {ag.label}
        </span>
      </span>
    </div>
  )
}
