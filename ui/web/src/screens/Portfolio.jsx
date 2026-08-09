import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtNum, fmtPct, fmtSigned } from '../api.js'
import { L9, Notice, Panel } from '../components/ui.jsx'
import { C, MONO, label95, pnlColor, ratingStyle } from '../theme.js'

const ALLOCATION_COLORS = [C.link, C.green, C.red, C.t5, C.amber]

export default function Portfolio({ goto, setTicker }) {
  const [data, setData] = useState(null)
  const [macro, setMacro] = useState(null)
  const [headlines, setHeadlines] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    api.portfolio().then(setData).catch((err) => setError(err))
    api.macro().then(setMacro).catch(() => setMacro(null))
  }, [])

  // Headlines are one round-trip per holding, so they load after the table.
  useEffect(() => {
    const symbols = (data?.positions || []).map((p) => p.sym)
    if (symbols.length) {
      api.positionHeadlines(symbols).then(setHeadlines).catch(() => setHeadlines([]))
    }
  }, [data])

  if (error) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Notice tone={error.status === 503 ? 'dim' : 'warn'} title="Brokerage not connected">
          {error.detail || error.message}
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>
            PUBLIC_API_SECRET=your_secret_key
          </div>
          <div style={{ marginTop: 10 }}>
            Positions, net worth and allocation on this screen come from your live Public.com
            account. Everything else in the console works without it.
          </div>
        </Notice>
      </div>
    )
  }

  if (!data) {
    return <Loading />
  }

  const changeColor = pnlColor(data.daily_change)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      {/* net worth */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <L9 style={{ marginBottom: 8 }}>TOTAL NET WORTH</L9>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: C.text,
              lineHeight: 1,
            }}
          >
            {fmtMoney(data.nav)}
          </div>
        </div>
        {data.daily_change_pct !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 11px',
              borderRadius: 4,
              background: data.daily_change >= 0 ? C.greenBg : C.redBg,
              marginBottom: 5,
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: changeColor }}>
              {fmtPct(data.daily_change_pct)}
            </span>
          </div>
        )}
        <div style={{ marginBottom: 6, fontFamily: MONO, fontSize: 12, color: C.t4 }}>
          {fmtSigned(data.daily_change)} · today · {data.positions.length} positions ·{' '}
          {fmtMoney(data.buying_power)} buying power
        </div>
      </div>

      {/* macro */}
      <Panel
        title="Macro"
        meta={macro?.window || 'loading…'}
        pad={0}
        style={{ marginBottom: 20 }}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {(macro?.prediction_markets || []).map((m) => (
              <div key={m.k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 11, color: C.t4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.k}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: 500,
                    color: m.pct >= 60 ? C.green : m.pct >= 35 ? C.amber : C.t2,
                  }}
                >
                  {m.v}
                </span>
              </div>
            ))}
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t8 }}>polymarket</span>
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)' }}>
          {(macro?.news || []).map((n, i) => (
            <a
              key={i}
              href={n.link || undefined}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '13px 16px',
                borderRight: i < 4 ? `1px solid ${C.border}` : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...label95, fontSize: 9, letterSpacing: '.08em' }}>{n.tag}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t8, marginLeft: 'auto' }}>
                  {n.age}
                </span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.t1, textWrap: 'pretty' }}>
                {n.head}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.t7, marginTop: 'auto' }}>
                {n.src}
              </div>
            </a>
          ))}
          {!macro && (
            <div style={{ padding: '13px 16px', fontFamily: MONO, fontSize: 11, color: C.t7 }}>
              loading macro…
            </div>
          )}
        </div>
      </Panel>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel title="Current positions" meta="rating column = latest agent run" pad={0}>
            <PositionsTable
              positions={data.positions}
              onPick={(sym) => {
                setTicker(sym)
                goto('research')
              }}
            />
          </Panel>

          <Panel title="Position headlines" meta="1 per holding · live" pad={0}>
            {headlines.map((h) => (
              <div
                key={h.sym}
                className="row-hover"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '11px 18px',
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span
                  style={{
                    width: 76,
                    flex: 'none',
                    fontFamily: MONO,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: C.text,
                  }}
                >
                  {h.sym}
                </span>
                <a
                  href={h.link || undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5, color: C.t1, textWrap: 'pretty' }}
                >
                  {h.head}
                </a>
                {h.flag && (
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.amberDim, whiteSpace: 'nowrap' }}>
                    {h.flag}
                  </span>
                )}
                <span
                  style={{
                    width: 140,
                    flex: 'none',
                    textAlign: 'right',
                    fontFamily: MONO,
                    fontSize: 10.5,
                    color: C.t7,
                  }}
                >
                  {h.src} · {h.age}
                </span>
              </div>
            ))}
            <div style={{ padding: '11px 18px', fontSize: 11.5, lineHeight: 1.55, color: C.t6, textWrap: 'pretty' }}>
              Headlines are live. Ratings are pinned to the analysis date of the run that produced
              them — a flagged story broke after its rating and has not been read by any agent.
            </div>
          </Panel>
        </div>

        <div style={{ width: 326, flex: 'none', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Asset allocation">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {data.allocation.length === 0 && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.t7 }}>
                  no allocation breakdown returned
                </span>
              )}
              {data.allocation.map((a, i) => {
                const color = ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]
                return (
                  <div key={a.k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, flex: 'none', background: color }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: C.t1 }}>{a.k}</span>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>
                        {fmtMoney(a.v, 0)}
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          color: C.t5,
                          width: 40,
                          textAlign: 'right',
                        }}
                      >
                        {a.pct !== null ? `${a.pct.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 9999, background: C.panelHi, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: 9999,
                          background: color,
                          width: `${Math.min(a.pct || 0, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel
            title="Recent decisions"
            pad={0}
            right={
              <button
                className="link-hover"
                onClick={() => goto('history')}
                style={{ fontSize: 11.5, color: C.link, cursor: 'pointer' }}
              >
                All runs
              </button>
            }
          >
            {data.recent_decisions.length === 0 && (
              <div style={{ padding: 18, fontFamily: MONO, fontSize: 11, color: C.t7 }}>
                no runs recorded yet
              </div>
            )}
            {data.recent_decisions.map((d, i) => {
              const rs = ratingStyle(d.rating)
              return (
                <div
                  key={`${d.sym}-${i}`}
                  style={{
                    padding: '12px 18px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: C.text }}>
                      {d.sym}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: rs.c }}>{d.rating}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: C.t7, marginLeft: 'auto' }}>
                      {d.when}
                    </span>
                  </div>
                  {d.note && (
                    <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.t4, textWrap: 'pretty' }}>
                      {d.note}
                    </div>
                  )}
                </div>
              )
            })}
          </Panel>
        </div>
      </div>
    </div>
  )
}

const COLS = '1.6fr .8fr .8fr .8fr 1.1fr 1.1fr'

function PositionsTable({ positions, onPick }) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: COLS,
          padding: '9px 18px',
          background: C.panelHi,
          borderBottom: `1px solid ${C.border2}`,
        }}
      >
        {['ASSET', 'QTY', 'COST', 'PRICE', 'GAIN / LOSS', 'AGENT RATING'].map((h, i) => (
          <span key={h} style={{ ...label95, textAlign: i === 0 ? 'left' : 'right' }}>
            {h}
          </span>
        ))}
      </div>
      {positions.length === 0 && (
        <div style={{ padding: 18, fontFamily: MONO, fontSize: 11, color: C.t7 }}>
          no open positions in this account
        </div>
      )}
      {positions.map((p) => {
        const rs = ratingStyle(p.rating)
        const plColor = pnlColor(p.pl)
        return (
          <div
            key={p.sym}
            className="row-hover"
            onClick={() => onPick(p.sym)}
            style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              alignItems: 'center',
              padding: '11px 18px',
              borderBottom: `1px solid ${C.border}`,
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: C.text }}>
                {p.sym}
              </span>
              <span style={{ fontSize: 11, color: C.t5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.t1, textAlign: 'right' }}>
              {fmtNum(p.qty, p.qty && p.qty % 1 !== 0 ? 4 : 0)}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.t4, textAlign: 'right' }}>
              {fmtNum(p.cost)}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text, textAlign: 'right' }}>
              {fmtNum(p.price)}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'right' }}>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: plColor }}>
                {fmtSigned(p.pl)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: plColor, opacity: 0.7 }}>
                {fmtPct(p.pl_pct)}
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
              {p.rating ? (
                <>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      padding: '4px 9px',
                      borderRadius: 3,
                      background: rs.bg,
                      color: rs.c,
                    }}
                  >
                    {p.rating}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t5 }}>{p.rated_on}</span>
                </>
              ) : (
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t7 }}>never rated</span>
              )}
            </span>
          </div>
        )
      })}
    </>
  )
}

function Loading() {
  return (
    <div style={{ flex: 1, padding: '24px 26px', fontFamily: MONO, fontSize: 12, color: C.t6 }}>
      loading portfolio…
    </div>
  )
}
