import { renderMarkdown } from '../api.js'
import { Btn, Chip, Empty } from '../components/ui.jsx'
import { C, MONO, label9, ratingStyle } from '../theme.js'

const RISK_AGENTS = [
  ['Aggressive Analyst', C.amber],
  ['Conservative Analyst', C.red],
  ['Neutral Analyst', C.link],
]

/**
 * Reads the two debate states straight out of the run: the bull/bear exchange
 * and the three-way risk discussion, plus each judge's verdict.
 */
export default function DebateRoom({ run, goto }) {
  const debate = run?.investment_debate_state || {}
  const risk = run?.risk_debate_state || {}
  const bull = run?.reports?.['Bull Researcher'] || debate.bull_history
  const bear = run?.reports?.['Bear Researcher'] || debate.bear_history
  const manager = run?.reports?.['Research Manager'] || debate.judge_decision

  if (!run?.run_id) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Empty>{'No run loaded.\nStart a run to watch the debate unfold.'}</Empty>
        <div style={{ marginTop: 18 }}>
          <Btn onClick={() => goto('deploy')}>Configure a run</Btn>
        </div>
      </div>
    )
  }

  const rounds = run.request?.max_debate_rounds ?? 1
  const riskRounds = run.request?.max_risk_discuss_rounds ?? 1

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ maxWidth: 1120 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <Chip k="TICKER" v={run.request?.ticker || '—'} />
          <Chip k="ROUNDS" v={String(rounds)} />
          <Chip k="TURNS" v={String(2 * rounds)} />
          <Chip k="DEBATE COUNT" v={String(debate.count ?? 0)} />
          {manager && (
            <Chip
              k="OUTCOME"
              v={ratingOf(manager)}
              c={ratingStyle(ratingOf(manager)).c}
            />
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <DebateColumn
            title="Bull Researcher"
            color={C.green}
            bg={C.bullPanel}
            border={C.bullBorder}
            content={bull}
          />
          <DebateColumn
            title="Bear Researcher"
            color={C.red}
            bg={C.redPanel}
            border={C.redBorder}
            content={bear}
          />
        </div>

        {manager && (
          <div
            style={{
              border: `1px solid ${C.border3}`,
              borderRadius: 8,
              background: C.panelHi,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 15, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>Research Manager</span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  padding: '3px 9px',
                  borderRadius: 3,
                  background: ratingStyle(ratingOf(manager)).bg,
                  color: ratingStyle(ratingOf(manager)).c,
                }}
              >
                {ratingOf(manager)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.t7, marginLeft: 'auto' }}>
                deep_think_llm · debate verdict
              </span>
            </div>
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(manager) }} />
          </div>
        )}

        <div style={{ ...label9, marginBottom: 11 }}>
          RISK TEAM · {3 * riskRounds} TURNS · COUNT {risk.count ?? 0}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {RISK_AGENTS.map(([name, color]) => {
            const content = run.reports?.[name]
            return (
              <div
                key={name}
                style={{
                  border: `1px solid ${C.border2}`,
                  borderRadius: 8,
                  background: C.panel,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '11px 14px',
                    background: C.panelHi,
                    borderBottom: `1px solid ${C.border2}`,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 9999, background: color }} />
                  <span style={{ fontSize: 11.5, fontWeight: 600, color }}>{name}</span>
                </div>
                <div style={{ padding: 14 }}>
                  {content ? (
                    <div
                      className="md"
                      style={{ fontSize: 12.5 }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                    />
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.t7 }}>
                      has not spoken yet
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DebateColumn({ title, color, bg, border, content }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: 9999, background: color }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color }}>{title}</span>
      </div>
      <div style={{ border: `1px solid ${border}`, borderRadius: 8, background: bg, padding: 15 }}>
        {content ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.t7 }}>
            waiting for this side to argue
          </span>
        )}
      </div>
    </div>
  )
}

/** The debate verdict's rating word, for the outcome chip. */
function ratingOf(text) {
  const match = (text || '').match(/\b(Buy|Overweight|Hold|Underweight|Sell)\b/i)
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : 'Hold'
}
