import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { C, MONO, label9 } from '../theme.js'

const SEEN_KEY = 'alerts.lastSeen'
const LEVEL_COLOR = { error: C.red, warn: C.amber, info: C.t4 }

/**
 * Sidebar bell: unread count, and a panel of run, batch, backend and broker alerts.
 * Opening the panel marks everything read; the marker lives in this browser.
 */
export default function AlertBell({ openRun, goto }) {
  const [alerts, setAlerts] = useState([])
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [lastSeen, setLastSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY)) || 0)

  useEffect(() => {
    let alive = true
    const load = () => api.alerts().then((a) => alive && setAlerts(a)).catch(() => {})
    load()
    const id = setInterval(load, 10000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const unread = alerts.filter((a) => a.id > lastSeen)
  const worst = unread.some((a) => a.level === 'error') ? C.red : unread.some((a) => a.level === 'warn') ? C.amber : C.link

  function toggle() {
    if (!open && alerts.length) {
      const newest = alerts[0].id
      localStorage.setItem(SEEN_KEY, String(newest))
      setLastSeen(newest)
    }
    setOpen(!open)
  }

  function follow(a) {
    if (a.action?.run_id) openRun(a.action.run_id)
    else if (a.action?.screen) goto(a.action.screen)
    setOpen(false)
  }

  return (
    <>
      <button
        onClick={toggle}
        title="Alerts"
        aria-label={`Alerts, ${unread.length} unread`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={unread.length ? worst : C.t5} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span style={label9}>ALERTS</span>
        {unread.length > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 9999, background: worst, color: C.bg }}>
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        // Fixed, not absolute: the sidebar clips its overflow.
        <div
          style={{
            position: 'fixed',
            left: 222,
            bottom: 14,
            width: 380,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            background: C.panel,
            border: `1px solid ${C.border2}`,
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,.45)',
            zIndex: 50,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: `1px solid ${C.border2}` }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Alerts</span>
            <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.t5, cursor: 'pointer', fontSize: 14 }}>
              ×
            </button>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {alerts.length === 0 && <div style={{ padding: 18, fontFamily: MONO, fontSize: 11, color: C.t6 }}>nothing yet</div>}
            {alerts.map((a) => (
              <div key={a.id} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 9999, flex: 'none', background: LEVEL_COLOR[a.level] || C.t5, alignSelf: 'center' }} />
                  <span
                    onClick={() => a.detail && setExpanded(expanded === a.id ? null : a.id)}
                    style={{ flex: 1, fontSize: 12, color: C.t2, cursor: a.detail ? 'pointer' : 'default' }}
                  >
                    {a.title}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t6, flex: 'none' }}>{ago(a.t)}</span>
                </div>
                {expanded === a.id && (
                  <div style={{ margin: '6px 0 0 14px', fontFamily: MONO, fontSize: 10.5, color: C.t4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {a.detail}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, margin: '4px 0 0 14px' }}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t7 }}>{a.source}</span>
                  {a.detail && expanded !== a.id && (
                    <button onClick={() => setExpanded(a.id)} style={linkBtn}>details</button>
                  )}
                  {a.action && (
                    <button onClick={() => follow(a)} style={linkBtn}>{a.action.run_id ? 'view run →' : 'open →'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ago(t) {
  const s = Date.now() / 1000 - t
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(t * 1000).toLocaleDateString()
}

const linkBtn = { background: 'none', border: 'none', padding: 0, color: C.link, fontFamily: MONO, fontSize: 9.5, cursor: 'pointer' }
