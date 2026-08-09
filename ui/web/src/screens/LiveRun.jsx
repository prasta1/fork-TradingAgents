import { useEffect, useMemo, useState } from 'react'
import { fmtMoney, fmtSecs, renderMarkdown } from '../api.js'
import { Btn, Chip, Empty, L9 } from '../components/ui.jsx'
import { C, MONO, label9, ratingStyle } from '../theme.js'

const STATUS = {
  idle: ['IDLE', C.t7, C.border2, C.panel, 'none'],
  queued: ['QUEUED', C.amber, C.amberDim, C.panel, 'tapulse 1.4s infinite'],
  running: ['RUNNING', C.green, C.greenBg, C.greenDeep, 'tapulse 1.1s infinite'],
  complete: ['COMPLETE', C.green, C.greenBg, C.greenDeep, 'none'],
  cancelled: ['CANCELLED', C.amber, C.amberDim, C.panel, 'none'],
  error: ['ERROR', C.red, C.redBorder, C.redPanel, 'none'],
}

export default function LiveRun({ run, logs, error, cancel, reset, goto, ticker }) {
  const [selected, setSelected] = useState(null)
  const [tick, setTick] = useState(0)

  const nodes = useMemo(
    () => run.pipeline.flatMap((col) => col.nodes.map((n) => n.id)),
    [run.pipeline]
  )
  const done = nodes.filter((n) => run.node_status[n] === 'complete').length
  const running = run.status === 'running'

  // Follow the run: keep the newest completed node selected until the user
  // clicks one themselves.
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (pinned) return
    const active = nodes.find((n) => run.node_status[n] === 'running')
    const lastDone = [...nodes].reverse().find((n) => run.node_status[n] === 'complete')
    setSelected(lastDone || active || nodes[0] || null)
  }, [run.node_status, nodes, pinned])

  useEffect(() => {
    setPinned(false)
  }, [run.run_id])

  // Local clock so ELAPSED advances between server events. Derived from the
  // run's start timestamp rather than accumulated, so a reload mid-run shows
  // the true elapsed time instead of restarting from zero.
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  const elapsed = running && run.started_at ? Date.now() / 1000 - run.started_at : run.elapsed || 0
  void tick // re-render trigger for the clock above

  if (!run.run_id) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Empty>
          {'No active execution.\nConfigure a run on Deploy run to start the graph.'}
        </Empty>
        <div style={{ marginTop: 18 }}>
          <Btn onClick={() => goto('deploy')}>Configure a run</Btn>
        </div>
      </div>
    )
  }

  const [statusLabel, statusColor, statusBorder, statusBg, statusAnim] =
    STATUS[run.status] || STATUS.idle

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* status bar */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '14px 22px',
          borderBottom: `1px solid ${C.border}`,
          background: C.panelAlt,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '6px 12px',
            borderRadius: 4,
            border: `1px solid ${statusBorder}`,
            background: statusBg,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: statusColor,
              animation: statusAnim,
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.04em', color: statusColor }}>
            {statusLabel}
          </span>
        </div>

        <Stat k="NODES" v={`${done} / ${nodes.length}`} />
        <Stat k="ELAPSED" v={fmtSecs(elapsed)} />
        <Stat k="LLM CALLS" v={run.stats?.llm_calls ?? '—'} />
        <Stat k="TOKENS" v={formatTokens(run.stats)} />
        <Stat k="EXECUTION" v={run.run_id} />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={reset} disabled={running}>
            Reset
          </Btn>
          {running ? (
            <Btn variant="danger" onClick={cancel} title="Stops after the current node finishes">
              Cancel
            </Btn>
          ) : (
            <Btn onClick={() => goto('deploy')}>New run</Btn>
          )}
        </div>
      </div>

      {/* pipeline */}
      <div
        style={{
          flex: 'none',
          padding: '18px 22px',
          borderBottom: `1px solid ${C.border}`,
          background: C.panelDeep,
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, minWidth: 'min-content' }}>
          {run.pipeline.map((col, ci) => (
            <div key={col.num} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 14, color: C.t9, paddingBottom: 16 }}>{ci ? '→' : ''}</div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  width: 184,
                  alignSelf: 'stretch',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 14 }}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t7 }}>{col.num}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: C.t4 }}>
                    {col.title}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {col.nodes.map((node) => (
                    <NodeButton
                      key={node.id}
                      node={node}
                      status={run.node_status[node.id]}
                      elapsed={run.node_elapsed[node.id]}
                      selected={selected === node.id}
                      onClick={() => {
                        setSelected(node.id)
                        setPinned(true)
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* report + side rail */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px 40px' }}>
          <ReportPane run={run} node={selected} error={error} />
        </section>

        <aside
          style={{
            width: 346,
            flex: 'none',
            borderLeft: `1px solid ${C.border}`,
            background: C.panelAlt,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ flex: 'none', padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <L9 style={{ marginBottom: 11 }}>PORTFOLIO MANAGER DECISION</L9>
            <DecisionCard
              run={run}
              remaining={nodes.length - done}
              onThesis={() => {
                setSelected('Portfolio Manager')
                setPinned(true)
              }}
              onExecute={() => goto('trade')}
            />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 16px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <L9>GRAPH STREAM</L9>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t8, marginLeft: 'auto' }}>
                sse /runs/{run.run_id}/stream
              </span>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {logs.length === 0 && (
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t7 }}>
                  awaiting first node…
                </span>
              )}
              {logs.map((line, i) => (
                <div
                  key={`${line.t}-${i}`}
                  style={{ display: 'flex', gap: 9, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5 }}
                >
                  <span style={{ color: C.t8, flex: 'none' }}>
                    {String(Math.round(line.t)).padStart(3, '0')}s
                  </span>
                  <span
                    style={{
                      color:
                        line.level === 'error' ? C.red : line.level === 'warn' ? C.amber : C.t4,
                      textWrap: 'pretty',
                    }}
                  >
                    {line.m}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Stat({ k, v }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: C.t7 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>{v}</span>
    </div>
  )
}

function formatTokens(stats) {
  if (!stats?.tokens_in && !stats?.tokens_out) return '—'
  const total = (stats.tokens_in || 0) + (stats.tokens_out || 0)
  return total > 1000 ? `${(total / 1000).toFixed(1)}K` : String(total)
}

function NodeButton({ node, status, elapsed, selected, onClick }) {
  const complete = status === 'complete'
  const active = status === 'running'
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 9px',
        borderRadius: 5,
        cursor: 'pointer',
        textAlign: 'left',
        border: `1px solid ${selected ? C.selBorder : complete ? C.bullBorder : C.border2}`,
        background: selected ? C.selBg : complete ? C.panel : C.panelDeep,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          flex: 'none',
          background: complete || active ? C.green : C.t9,
          animation: active ? 'tapulse 1s infinite' : 'none',
        }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 11.5,
          fontWeight: 500,
          color: complete || active ? C.text : C.t6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {node.label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: complete ? C.t5 : C.t8 }}>
        {complete ? `${Math.round(elapsed || 0)}s` : active ? '···' : ''}
      </span>
    </button>
  )
}

function ReportPane({ run, node, error }) {
  if (error) {
    return (
      <div
        style={{
          border: `1px solid ${C.redBorder}`,
          background: C.redPanel,
          borderRadius: 8,
          padding: 20,
          maxWidth: 720,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.red, marginBottom: 8 }}>
          Run failed
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: C.t2, wordBreak: 'break-word' }}>
          {error}
        </div>
      </div>
    )
  }

  if (!node) return <Empty>Select a node to read its report</Empty>

  const content = run.reports[node]
  const status = run.node_status[node]
  const source = run.node_sources?.[node] || ''

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: C.text }}>
            {node}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.t5, marginTop: 4 }}>{source}</div>
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            padding: '5px 10px',
            borderRadius: 4,
            border: `1px solid ${C.border2}`,
            color: status === 'complete' ? C.green : status === 'running' ? C.amber : C.t7,
          }}
        >
          {status === 'complete' ? 'complete' : status === 'running' ? 'running' : 'pending'}
        </div>
      </div>

      {run.node_elapsed[node] !== undefined && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <Chip k="ELAPSED" v={`${Math.round(run.node_elapsed[node])}s`} />
          {content && <Chip k="LENGTH" v={`${content.split(/\s+/).length} words`} c={C.t2} />}
        </div>
      )}

      {content ? (
        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      ) : (
        <Empty>
          {status === 'running'
            ? 'Node is executing — report appears when it completes'
            : 'Node has not executed yet — no report in state'}
        </Empty>
      )}
    </>
  )
}

function DecisionCard({ run, remaining, onThesis, onExecute }) {
  const decision = run.decision || {}
  const ready = run.status === 'complete' && (decision.rating || run.signal)

  if (!ready) {
    return (
      <Empty pad="24px 16px">
        {run.status === 'error'
          ? 'Run failed before a decision was reached.'
          : `Portfolio Manager has not run.\n${remaining} node${remaining === 1 ? '' : 's'} remaining.`}
      </Empty>
    )
  }

  const rating = decision.rating || run.signal
  const rs = ratingStyle(rating)

  return (
    <div
      style={{
        border: `1px solid ${C.border3}`,
        borderRadius: 8,
        background: C.panelHi,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 15, borderBottom: `1px solid ${C.border2}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: rs.c }}>
            {rating}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...label9, color: C.t5 }}>PRICE TARGET</div>
            <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 500, color: C.text }}>
              {decision.price_target ? fmtMoney(decision.price_target) : '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
          <MiniStat k="HORIZON" v={decision.horizon || '—'} />
          <MiniStat
            k="STOP"
            v={decision.stop ? fmtMoney(decision.stop) : '—'}
            color={decision.stop ? C.red : C.t1}
          />
          <MiniStat k="SIZE" v={decision.size || '—'} />
        </div>
      </div>

      {decision.executive_summary && (
        <div style={{ padding: '13px 15px' }}>
          <div style={{ ...label9, color: C.t5, marginBottom: 6 }}>EXECUTIVE SUMMARY</div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.62, color: C.t1, textWrap: 'pretty' }}>
            {decision.executive_summary}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, padding: '0 15px 15px' }}>
        <Btn onClick={onThesis} style={{ flex: 1, padding: 9, fontSize: 12 }}>
          Full thesis
        </Btn>
        <Btn variant="ghost" onClick={onExecute} style={{ padding: '9px 13px', fontSize: 12 }}>
          Execute
        </Btn>
      </div>
    </div>
  )
}

function MiniStat({ k, v, color = C.t1 }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...label9, color: C.t5 }}>{k}</div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color,
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 92,
        }}
        title={v}
      >
        {v}
      </div>
    </div>
  )
}
