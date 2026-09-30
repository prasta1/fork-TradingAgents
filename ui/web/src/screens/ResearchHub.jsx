import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtNum, fmtPct } from '../api.js'
import { Btn, Field, L9, LoadError, Panel, inputStyle } from '../components/ui.jsx'
import { C, MONO, label95, ratingStyle } from '../theme.js'

// Analyst node -> the card it fills on this screen.
const INSIGHTS = [
  ['Fundamentals', 'Fundamentals Analyst'],
  ['Sentiment', 'Sentiment Analyst'],
  ['Technical', 'Market Analyst'],
  ['News / macro', 'News Analyst'],
]

export default function ResearchHub({ ticker, setTicker, run, goto }) {
  const [data, setData] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [input, setInput] = useState(ticker)
  const [loading, setLoading] = useState(true)
  const [quoteError, setQuoteError] = useState(null)
  const [watchError, setWatchError] = useState(null)

  const loadQuote = () => {
    setLoading(true)
    setQuoteError(null)
    api
      .quote(ticker)
      .then(setData)
      .catch((err) => {
        setData(null)
        setQuoteError(err)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setInput(ticker)
    loadQuote()
    // loadQuote reads the current ticker; re-run only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  // Watchlist reads and edits all report failure instead of looking empty or
  // silently doing nothing.
  const loadWatchlist = () => {
    setWatchError(null)
    return api.watchlist().then(setWatchlist).catch(setWatchError)
  }
  const changeWatch = async (call) => {
    try {
      await call()
      await loadWatchlist()
    } catch (err) {
      setWatchError(err)
    }
  }
  useEffect(() => {
    loadWatchlist()
  }, [])

  const quote = data?.quote
  const spark = data?.spark
  const decision = run?.decision || {}
  const hasDecision = run?.request?.ticker === ticker && decision.rating

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {quoteError && <LoadError what={`${ticker} market data`} error={quoteError} onRetry={loadQuote} />}
          <Panel>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: C.text,
                  }}
                >
                  {ticker}
                </span>
                <span style={{ fontSize: 15, color: C.t2 }}>{quote?.name || (loading ? '…' : '')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}>
                {quote?.exchange && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      padding: '3px 8px',
                      borderRadius: 3,
                      background: C.panelHi,
                      color: C.t2,
                    }}
                  >
                    {quote.exchange}
                  </span>
                )}
                {quote?.market_state && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 9999,
                        background: quote.market_state === 'REGULAR' ? C.green : C.t5,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11.5,
                        color: quote.market_state === 'REGULAR' ? C.green : C.t4,
                      }}
                    >
                      {quote.market_state === 'REGULAR' ? 'Market open' : quote.market_state}
                    </span>
                  </span>
                )}
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 32,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: C.text,
                    lineHeight: 1,
                  }}
                >
                  {quote?.price ? fmtMoney(quote.price) : '—'}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: (quote?.change ?? 0) >= 0 ? C.green : C.red,
                    marginTop: 6,
                  }}
                >
                  {quote?.change !== null && quote?.change !== undefined
                    ? `${quote.change >= 0 ? '+' : ''}${fmtNum(quote.change)} (${fmtPct(quote.change_pct)})`
                    : '—'}
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6,1fr)',
                gap: 14,
                marginTop: 20,
                paddingTop: 18,
                borderTop: `1px solid ${C.border2}`,
              }}
            >
              {(quote?.stats || []).map((s) => (
                <div key={s.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', color: C.t7 }}>
                    {s.k}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: C.text }}>{s.v}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Price action" meta="1M · daily close · yfinance">
            <div
              style={{
                height: 180,
                background: C.inputBg,
                border: `1px solid ${C.border}`,
                borderRadius: 5,
                overflow: 'hidden',
              }}
            >
              {spark?.points ? (
                <svg
                  viewBox="0 0 600 140"
                  preserveAspectRatio="none"
                  style={{ width: '100%', height: '100%', display: 'block' }}
                >
                  <polyline
                    points={spark.points}
                    fill="none"
                    stroke={C.green}
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : (
                <div style={{ padding: 20, fontFamily: MONO, fontSize: 11, color: C.t7 }}>
                  {loading ? 'loading price history…' : 'no price history'}
                </div>
              )}
            </div>
            {spark?.low !== undefined && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: C.t6,
                }}
              >
                <span>low {fmtNum(spark.low)}</span>
                <span>high {fmtNum(spark.high)}</span>
              </div>
            )}
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {INSIGHTS.map(([title, node]) => {
              const report = run?.reports?.[node]
              const fromThisTicker = run?.request?.ticker === ticker
              return (
                <Panel key={title} style={{ minHeight: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>{title}</span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        marginLeft: 'auto',
                        color: report && fromThisTicker ? C.green : C.t7,
                      }}
                    >
                      {report && fromThisTicker ? 'from latest run' : 'no run'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: C.t2, textWrap: 'pretty' }}>
                    {report && fromThisTicker
                      ? `${stripMarkdown(report).slice(0, 260)}…`
                      : `Run the ${node} on ${ticker} to fill this card.`}
                  </p>
                </Panel>
              )
            })}
          </div>
        </div>

        <div style={{ width: 300, flex: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel>
            <Field label="LOOK UP TICKER">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && setTicker(input)}
                  style={inputStyle}
                />
                <Btn onClick={() => setTicker(input)} style={{ padding: '9px 13px' }}>
                  Go
                </Btn>
              </div>
            </Field>
          </Panel>

          {hasDecision ? (
            <div
              style={{
                border: `1px solid ${C.greenBorder}`,
                borderRadius: 8,
                background: C.greenPanel,
                padding: 16,
              }}
            >
              <L9 style={{ color: C.green, marginBottom: 10 }}>LATEST AGENT DECISION</L9>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: ratingStyle(decision.rating).c,
                }}
              >
                {decision.rating}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.55, color: C.t2, marginTop: 8, textWrap: 'pretty' }}>
                {decision.executive_summary?.slice(0, 200) || 'No executive summary parsed.'}
              </div>
              <Btn onClick={() => goto('run')} style={{ width: '100%', marginTop: 13, padding: 9, fontSize: 12 }}>
                Open run
              </Btn>
            </div>
          ) : (
            <Panel>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.t4, textWrap: 'pretty' }}>
                No completed run for {ticker} in this session.
              </div>
              <Btn onClick={() => goto('deploy')} style={{ width: '100%', marginTop: 13, padding: 9, fontSize: 12 }}>
                Analyse {ticker}
              </Btn>
            </Panel>
          )}

          <Panel
            title="Watchlist"
            pad={0}
            right={
              <button
                className="link-hover"
                onClick={() => changeWatch(() => api.addWatch(ticker))}
                style={{ fontSize: 11.5, color: C.link, cursor: 'pointer' }}
              >
                + Add {ticker}
              </button>
            }
          >
            {watchError && (
              <div style={{ padding: 12 }}>
                <LoadError what="the watchlist" error={watchError} onRetry={loadWatchlist} />
              </div>
            )}
            {watchlist.length === 0 && !watchError && (
              <div style={{ padding: 16, fontFamily: MONO, fontSize: 11, color: C.t7 }}>
                watchlist is empty
              </div>
            )}
            {watchlist.map((w) => (
              <div
                key={w.sym}
                className="row-hover"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 16px 0 0',
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <button
                  onClick={() => setTicker(w.sym)}
                  style={{ flex: 1, textAlign: 'left', padding: '11px 16px', cursor: 'pointer' }}
                  aria-label={`Research ${w.sym}`}
                >
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: C.text }}>
                    {w.sym}
                  </span>
                </button>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>
                    {w.last ? fmtNum(w.last) : '—'}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      color: Number(w.change_pct || 0) >= 0 ? C.green : C.red,
                      width: 52,
                      textAlign: 'right',
                    }}
                  >
                    {w.change_pct ? `${Number(w.change_pct).toFixed(2)}%` : '—'}
                  </span>
                  <button
                    onClick={() => changeWatch(() => api.removeWatch(w.sym))}
                    style={{ cursor: 'pointer', color: C.t2, fontSize: 14, lineHeight: 1, padding: 4 }}
                    title="Remove"
                    aria-label={`Remove ${w.sym} from watchlist`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** Strip markdown syntax for the short preview text on insight cards. */
function stripMarkdown(text) {
  return text
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/[|`>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
