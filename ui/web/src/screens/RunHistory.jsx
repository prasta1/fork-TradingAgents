import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Empty, Panel } from '../components/ui.jsx'
import { C, MONO, label95, pnlColor, ratingStyle } from '../theme.js'

const COLS = '.9fr .7fr 1fr .7fr .8fr .8fr'

export default function RunHistory() {
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    api.history().then(setEntries).catch(() => setEntries([]))
  }, [])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ maxWidth: 1120 }}>
        <p
          style={{
            margin: '0 0 20px',
            fontSize: 13,
            lineHeight: 1.6,
            color: C.t4,
            maxWidth: 660,
            textWrap: 'pretty',
          }}
        >
          Every completed run appends to{' '}
          <span style={{ fontFamily: MONO, color: C.t2 }}>trading_memory.md</span>. On the next run
          for the same ticker the realised return and a written reflection are resolved and injected
          into the Portfolio Manager prompt.
        </p>

        {entries === null && (
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.t6 }}>loading history…</div>
        )}

        {entries?.length === 0 && (
          <Empty>{'No runs recorded yet.\nCompleted runs appear here with their reflections.'}</Empty>
        )}

        {entries?.length > 0 && (
          <Panel pad={0}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: COLS,
                padding: '9px 18px',
                background: C.panelHi,
                borderBottom: `1px solid ${C.border2}`,
              }}
            >
              {['DATE', 'TICKER', 'RATING', 'HELD', 'RETURN', 'ALPHA'].map((h, i) => (
                <span key={h} style={{ ...label95, textAlign: i > 3 ? 'right' : 'left' }}>
                  {h}
                </span>
              ))}
            </div>
            {entries.map((e, i) => {
              const rs = ratingStyle(e.rating)
              return (
                <div key={`${e.date}-${e.ticker}-${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: COLS,
                      alignItems: 'center',
                      padding: '12px 18px',
                    }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.t1 }}>{e.date}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: C.text }}>
                      {e.ticker}
                    </span>
                    <span>
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
                        {e.rating}
                      </span>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>
                      {e.holding && e.holding !== 'n/a' ? e.holding : '—'}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 12.5,
                        textAlign: 'right',
                        color: e.pending ? C.t5 : pnlColor(e.raw_return_value),
                      }}
                    >
                      {e.pending ? 'pending' : e.raw_return || '—'}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 12.5,
                        textAlign: 'right',
                        color: e.pending ? C.t5 : pnlColor(e.alpha_value),
                      }}
                    >
                      {e.pending ? '—' : e.alpha || '—'}
                    </span>
                  </div>
                  {(e.reflection || e.pending) && (
                    <div style={{ padding: '0 18px 13px' }}>
                      <div
                        style={{
                          borderLeft: `2px solid ${C.border2}`,
                          paddingLeft: 12,
                          fontSize: 12.5,
                          lineHeight: 1.6,
                          color: '#7d90a8',
                          textWrap: 'pretty',
                        }}
                      >
                        {e.reflection ||
                          'Open — the realised return and reflection resolve on the next run for this ticker.'}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </Panel>
        )}
      </div>
    </div>
  )
}
