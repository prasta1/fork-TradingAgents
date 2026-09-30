import { useEffect, useMemo, useState } from 'react'
import { api, fmtMoney, fmtNum, fmtSecs, renderMarkdown } from '../api.js'
import { Btn, Notice, Panel } from '../components/ui.jsx'
import { C, MONO, label95, ratingStyle } from '../theme.js'
import { detectAssetType, lastLaunch } from './DeployRun.jsx'

const SELECTION_KEY = 'batch.selection'
const STALE_DAYS = 90
const PICK_COLS = '28px 1.4fr .8fr 1fr 1fr'
const VERDICT_COLS = '1fr .7fr 1.3fr .8fr .8fr 1fr 2.6fr'

// Run every selected holding through the agent pipeline, one after another,
// then show the verdict: an attention-ordered table plus an LLM memo.
export default function BatchRun({ boot, tradeDate, goto, attach }) {
  const [batch, setBatch] = useState(undefined) // undefined = loading, null = none yet
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    let timer
    const poll = () =>
      api
        .latestBatch()
        .then((b) => {
          if (!alive) return
          setBatch(b)
          // A ticker takes minutes, so a few seconds of lag is invisible.
          if (b?.status === 'running') timer = setTimeout(poll, 3000)
        })
        .catch((err) => alive && setError(err.detail || err.message))
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [batch?.batch_id, batch?.status])

  if (error) return <Page><Notice tone="warn" title="Batch unavailable">{error}</Notice></Page>
  if (batch === undefined) return <Page><Mono c={C.t6}>loading…</Mono></Page>

  if (!batch || picking) {
    return (
      <Picker
        boot={boot}
        tradeDate={tradeDate}
        goto={goto}
        onStarted={(b) => {
          setPicking(false)
          setBatch(b)
        }}
      />
    )
  }

  const openRun = async (runId) => {
    await attach(runId)
    goto('run')
  }
  return batch.status === 'running' ? (
    <Progress batch={batch} openRun={openRun} />
  ) : (
    <Verdict batch={batch} openRun={openRun} onNew={() => setPicking(true)} />
  )
}

function Picker({ boot, tradeDate, goto, onStarted }) {
  const [holdings, setHoldings] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const settings = { ...boot.defaults, ...lastLaunch() }

  useEffect(() => {
    api
      .holdings()
      .then((data) => {
        // One row per symbol: the same ticker can sit in several accounts.
        const bySym = new Map()
        for (const h of data.holdings) {
          const row = bySym.get(h.sym) || { sym: h.sym, name: h.name, value: 0, rating: h.rating, rated_on: h.rated_on }
          row.value += h.value || 0
          bySym.set(h.sym, row)
        }
        const total = data.totals.value || 1
        const rows = [...bySym.values()]
          .map((r) => ({ ...r, weight: r.value / total }))
          .sort((a, b) => b.value - a.value)
        setHoldings(rows)
        let saved = null
        try {
          saved = JSON.parse(localStorage.getItem(SELECTION_KEY))
        } catch {
          /* unreadable selection: fall back to everything */
        }
        setSelected(new Set(saved ? rows.map((r) => r.sym).filter((s) => saved.includes(s)) : rows.map((r) => r.sym)))
      })
      .catch((err) => setError(err.detail || err.message))
  }, [])

  const cutoff = useMemo(
    () => new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10),
    []
  )
  // Never analysed counts as stale.
  const isStale = (r) => !r.rated_on || r.rated_on < cutoff

  if (error) return <Page><Notice tone="warn" title="Holdings unavailable">{error}</Notice></Page>
  if (!holdings) return <Page><Mono c={C.t6}>loading holdings…</Mono></Page>

  const toggle = (sym) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })
  const chosen = holdings.filter((r) => selected.has(r.sym))
  const staleCount = holdings.filter(isStale).length

  async function launch() {
    setError(null)
    setSubmitting(true)
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(chosen.map((r) => r.sym)))
      const b = await api.startBatch(
        chosen.map((r) => ({ sym: r.sym, weight: r.weight, asset_type: detectAssetType(r.sym) })),
        {
          trade_date: tradeDate,
          analysts: boot.analysts.map((a) => a.key),
          llm_provider: settings.llm_provider,
          deep_think_llm: settings.deep_think_llm,
          quick_think_llm: settings.quick_think_llm,
          backend_url: settings.backend_url || null,
          max_debate_rounds: settings.max_debate_rounds,
          max_risk_discuss_rounds: settings.max_risk_discuss_rounds,
          checkpoint_enabled: settings.checkpoint_enabled,
        }
      )
      onStarted(b)
    } catch (err) {
      setError(err.detail || err.message)
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={() => setSelected(new Set(holdings.map((r) => r.sym)))}>All</Btn>
        <Btn variant="ghost" onClick={() => setSelected(new Set(holdings.filter(isStale).map((r) => r.sym)))}>
          Stale ({STALE_DAYS}d+) · {staleCount}
        </Btn>
        <Btn variant="ghost" onClick={() => setSelected(new Set())}>None</Btn>
        <Mono c={C.t5} style={{ marginLeft: 8 }}>
          {chosen.length} of {holdings.length} selected · {fmtNum(chosen.reduce((s, r) => s + r.weight, 0) * 100, 1)}% of portfolio
        </Mono>
        <Btn onClick={launch} disabled={!chosen.length || submitting} style={{ marginLeft: 'auto' }}>
          {submitting ? 'Starting…' : `Run ${chosen.length} tickers`}
        </Btn>
      </div>

      <div style={{ marginBottom: 14, fontFamily: MONO, fontSize: 11, color: C.t5 }}>
        {settings.llm_provider} · deep {settings.deep_think_llm} · quick {settings.quick_think_llm} · all analysts ·
        debate {settings.max_debate_rounds} · risk {settings.max_risk_discuss_rounds} · {tradeDate}{' '}
        <button onClick={() => goto('deploy')} style={linkBtn}>change on Deploy run →</button>
      </div>

      <Panel title="Holdings" meta="one row per ticker · weight summed across accounts" pad={0}>
        <Header cols={PICK_COLS} labels={['', 'TICKER', 'WEIGHT', 'LAST RATING', 'RATED ON']} />
        {holdings.map((r) => (
          <label
            key={r.sym}
            className="row-hover"
            style={{ display: 'grid', gridTemplateColumns: PICK_COLS, alignItems: 'center', gap: 8, padding: '8px 18px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
          >
            <input type="checkbox" checked={selected.has(r.sym)} onChange={() => toggle(r.sym)} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Mono size={13}>{r.sym}</Mono>
              <span style={{ fontSize: 10.5, color: C.t6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            </span>
            <Mono c={C.t2}>{fmtNum(r.weight * 100, 1)}%</Mono>
            <span><Rating r={r.rating} /></span>
            <Mono size={11} c={isStale(r) ? C.amber : C.t5}>{r.rated_on || 'never'}</Mono>
          </label>
        ))}
      </Panel>
    </Page>
  )
}

function Progress({ batch, openRun }) {
  const [cancelling, setCancelling] = useState(false)
  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <Mono size={20} style={{ fontWeight: 700 }}>{batch.done} / {batch.total}</Mono>
        <Mono c={C.t5}>
          {fmtSecs(batch.elapsed)} elapsed{batch.eta ? ` · ~${fmtSecs(batch.eta)} left` : ''}
        </Mono>
        <Btn
          variant="ghost"
          disabled={cancelling}
          onClick={() => {
            setCancelling(true)
            api.cancelBatch().catch(() => setCancelling(false))
          }}
          style={{ marginLeft: 'auto' }}
        >
          {cancelling ? 'Cancelling after current node…' : 'Cancel batch'}
        </Btn>
      </div>
      <Panel title="Queue" meta={`analysis date ${batch.trade_date}`} pad={0}>
        {batch.items.map((i) => (
          <div key={i.sym} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', alignItems: 'center', gap: 8, padding: '9px 18px', borderBottom: `1px solid ${C.border}` }}>
            <Mono size={13}>{i.sym}</Mono>
            <Status s={i.status} />
            <Mono size={11} c={C.t5}>{i.elapsed ? fmtSecs(i.elapsed) : ''}</Mono>
            <Rating r={i.signal} empty="" />
            <RunLink item={i} openRun={openRun} />
          </div>
        ))}
      </Panel>
    </Page>
  )
}

function Verdict({ batch, openRun, onNew }) {
  const complete = batch.items.filter((i) => i.status === 'complete').length
  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <Mono c={C.t4}>
          {batch.status === 'cancelled' ? 'Cancelled' : 'Finished'} · {complete} of {batch.total} rated · {fmtSecs(batch.elapsed)} · {batch.trade_date}
        </Mono>
        <Btn onClick={onNew} style={{ marginLeft: 'auto' }}>New batch</Btn>
      </div>

      {batch.memo_error && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn" title="Portfolio memo unavailable">{batch.memo_error}</Notice>
        </div>
      )}
      {batch.memo && (
        <Panel title="Portfolio memo" meta="deep-think model · reads every decision against its weight" style={{ marginBottom: 18 }}>
          <div className="md" style={{ fontSize: 13, lineHeight: 1.6, color: C.t2 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(batch.memo) }} />
        </Panel>
      )}

      <Panel title="Positions" meta="downgrades and bearish calls on big positions first" pad={0}>
        <Header cols={VERDICT_COLS} labels={['TICKER', 'WEIGHT', 'RATING', 'TARGET', 'STOP', 'HORIZON', 'SUMMARY']} />
        {batch.items.map((i) => {
          const d = i.decision || {}
          return (
            <div key={i.sym} style={{ display: 'grid', gridTemplateColumns: VERDICT_COLS, alignItems: 'center', gap: 8, padding: '9px 18px', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Mono size={13}>{i.sym}</Mono>
                <RunLink item={i} openRun={openRun} />
              </span>
              <Mono c={C.t2}>{fmtNum(i.weight * 100, 1)}%</Mono>
              {i.status === 'complete' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Rating r={i.prev_rating} empty="—" />
                  <Mono c={C.t6}>→</Mono>
                  <Rating r={i.signal} />
                </span>
              ) : (
                <span title={i.error || ''}><Status s={i.status} /></span>
              )}
              <Mono c={C.t2}>{d.price_target ? fmtMoney(d.price_target) : '—'}</Mono>
              <Mono c={C.t2}>{d.stop ? fmtMoney(d.stop) : '—'}</Mono>
              <Mono size={11} c={C.t4}>{d.horizon || '—'}</Mono>
              <span style={{ fontSize: 11.5, color: C.t4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {i.status === 'complete' ? d.executive_summary || '—' : i.error || ''}
              </span>
            </div>
          )
        })}
      </Panel>

      {batch.verdict_path && (
        <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10.5, color: C.t7 }}>saved to {batch.verdict_path}</div>
      )}
    </Page>
  )
}

function RunLink({ item, openRun }) {
  if (!item.run_id) return <span />
  return (
    <button onClick={() => openRun(item.run_id)} style={{ ...linkBtn, textAlign: 'left', padding: 0 }}>
      view run →
    </button>
  )
}

const STATUS_COLOR = { running: C.green, complete: C.t4, error: C.red, cancelled: C.amber, skipped: C.t7, queued: C.t6 }
const Status = ({ s }) => (
  <Mono size={11} c={STATUS_COLOR[s] || C.t5} style={s === 'running' ? { animation: 'tapulse 1.4s infinite' } : undefined}>
    {s}
  </Mono>
)

function Rating({ r, empty = 'never rated' }) {
  if (!r) return <Mono size={10.5} c={C.t7}>{empty}</Mono>
  const rs = ratingStyle(r)
  return <span style={{ fontFamily: MONO, fontSize: 11, padding: '3px 8px', borderRadius: 3, background: rs.bg, color: rs.c }}>{r}</span>
}

function Header({ cols, labels }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '9px 18px', background: C.panelHi, borderBottom: `1px solid ${C.border2}` }}>
      {labels.map((l, i) => (
        <span key={i} style={label95}>{l}</span>
      ))}
    </div>
  )
}

const linkBtn = { background: 'none', border: 'none', color: C.link, fontFamily: MONO, fontSize: 10.5, cursor: 'pointer' }
const Page = ({ children }) => <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>{children}</div>
const Mono = ({ children, size = 12, c = C.text, style }) => (
  <span style={{ fontFamily: MONO, fontSize: size, color: c, ...style }}>{children}</span>
)

