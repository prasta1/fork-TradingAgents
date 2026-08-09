import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtMoney, fmtNum } from '../api.js'
import { Btn, Field, L9, Notice, Panel, inputStyle } from '../components/ui.jsx'
import { C, MONO, label9, label95 } from '../theme.js'

const ORDER_TYPES = ['MARKET', 'LIMIT', 'STOP']
const TIF = ['DAY', 'GTC']

/**
 * Order entry against the live Public.com account.
 *
 * Two-step by construction: the ticket can only reach `Place order` after a
 * successful preflight, and placing asks for one more explicit confirmation.
 * An agent decision pre-fills the ticket — it never submits anything.
 */
export default function TradeDesk({ run, ticker, boot }) {
  const decision = run?.decision || {}
  const [symbol, setSymbol] = useState(ticker)
  const [side, setSide] = useState('BUY')
  const [orderType, setOrderType] = useState('LIMIT')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [timeInForce, setTimeInForce] = useState('DAY')

  const [quote, setQuote] = useState(null)
  const [buyingPower, setBuyingPower] = useState(null)
  const [preflight, setPreflight] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [placed, setPlaced] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef(null)

  // Any edit invalidates a prior review — you cannot place a stale ticket.
  const invalidate = useCallback(() => {
    setPreflight(null)
    setConfirming(false)
    setError(null)
  }, [])

  useEffect(() => {
    setSymbol(ticker)
  }, [ticker])

  const loadQuote = useCallback(async (sym) => {
    if (!sym) return
    try {
      const quotes = await api.tradeQuotes([sym.toUpperCase()])
      setQuote(quotes[sym.toUpperCase()] || null)
    } catch (err) {
      setError(err)
      setQuote(null)
    }
  }, [])

  useEffect(() => {
    loadQuote(symbol)
    api
      .portfolio()
      .then((p) => setBuyingPower(p.buying_power))
      .catch(() => setBuyingPower(null))
  }, [symbol, loadQuote])

  // Seed the limit price from the agent's entry, or from the live quote.
  useEffect(() => {
    if (limitPrice) return
    if (decision.price_target && run?.request?.ticker === symbol) return
    if (quote?.last) setLimitPrice(String(quote.last))
    // Only seeds an empty field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote])

  useEffect(() => () => clearInterval(pollRef.current), [])

  if (!boot.broker_connected) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Notice title="Public.com not connected">
          Add a secret key to your .env to enable order entry. Generate one at
          public.com/settings/security/api.
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>
            PUBLIC_API_SECRET=your_secret_key
          </div>
        </Notice>
      </div>
    )
  }

  const order = {
    symbol: (symbol || '').toUpperCase(),
    side,
    quantity: String(quantity),
    order_type: orderType,
    limit_price: orderType === 'LIMIT' ? String(limitPrice) : null,
    stop_price: orderType === 'STOP' ? String(stopPrice) : null,
    time_in_force: timeInForce,
  }

  const ticketValid =
    order.symbol &&
    Number(quantity) > 0 &&
    (orderType !== 'LIMIT' || Number(limitPrice) > 0) &&
    (orderType !== 'STOP' || Number(stopPrice) > 0)

  async function review() {
    setBusy(true)
    setError(null)
    try {
      setPreflight(await api.preflight(order))
    } catch (err) {
      setError(err)
      setPreflight(null)
    } finally {
      setBusy(false)
    }
  }

  async function place() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.placeOrder(order)
      setPlaced(result)
      setConfirming(false)
      setPreflight(null)
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.orderStatus(result.orderId)
          setStatus(s)
          if (['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(s.status)) {
            clearInterval(pollRef.current)
          }
        } catch {
          clearInterval(pollRef.current)
        }
      }, 2000)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder() {
    if (!placed) return
    try {
      await api.cancelOrder(placed.orderId)
      setStatus((s) => ({ ...(s || {}), status: 'CANCELLED' }))
      clearInterval(pollRef.current)
    } catch (err) {
      setError(err)
    }
  }

  const hasProposal = decision.rating && run?.request?.ticker

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 1180 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {hasProposal ? (
            <div
              style={{
                border: `1px solid ${C.greenBorder}`,
                borderRadius: 8,
                background: C.greenPanel,
                padding: 18,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{ ...label9, color: C.green }}>AGENT PROPOSAL</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.t5, marginLeft: 'auto' }}>
                  Portfolio Manager · {run.request.ticker} · run_{run.run_id}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', color: C.green, lineHeight: 1 }}>
                  {decision.rating}
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <Proposed k="TARGET" v={decision.price_target ? fmtMoney(decision.price_target) : '—'} />
                  <Proposed k="STOP" v={decision.stop ? fmtMoney(decision.stop) : '—'} color={C.red} />
                  <Proposed k="SIZE" v={decision.size || '—'} />
                  <Proposed k="HORIZON" v={decision.horizon || '—'} />
                </div>
                <Btn
                  variant="ghost"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    setSymbol(run.request.ticker)
                    setSide(['Sell', 'Underweight'].includes(decision.rating) ? 'SELL' : 'BUY')
                    if (decision.price_target) setLimitPrice(String(decision.price_target))
                    invalidate()
                  }}
                >
                  Load into ticket
                </Btn>
              </div>
              <div style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.55, color: C.t4, textWrap: 'pretty' }}>
                Loading a proposal only fills the ticket. Nothing is sent to Public.com until you
                review and confirm below.
              </div>
            </div>
          ) : (
            <Notice title="No agent proposal loaded">
              Complete a run to have the Portfolio Manager's decision pre-fill this ticket. You can
              still trade manually.
            </Notice>
          )}

          <Panel
            title="Top of book"
            meta={`${(symbol || '').toUpperCase()} · Public.com market data`}
            right={
              <button
                className="link-hover"
                onClick={() => loadQuote(symbol)}
                style={{ fontSize: 11.5, color: C.link, cursor: 'pointer' }}
              >
                Refresh
              </button>
            }
          >
            {quote ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                <BookCell k="BID" v={fmtNum(quote.bid)} sub={`${quote.bidSize ?? '—'} size`} color={C.green} />
                <BookCell k="ASK" v={fmtNum(quote.ask)} sub={`${quote.askSize ?? '—'} size`} color={C.red} />
                <BookCell k="LAST" v={fmtNum(quote.last)} sub={`vol ${Number(quote.volume || 0).toLocaleString()}`} />
                <BookCell
                  k="1D CHANGE"
                  v={quote.oneDayChange?.percentChange ? `${Number(quote.oneDayChange.percentChange).toFixed(2)}%` : '—'}
                  sub={quote.previousClose ? `prev ${fmtNum(quote.previousClose)}` : ''}
                  color={Number(quote.oneDayChange?.change || 0) >= 0 ? C.green : C.red}
                />
              </div>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.t7 }}>
                no quote for this symbol
              </span>
            )}
            <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.55, color: C.t6, textWrap: 'pretty' }}>
              Public's market data API returns top-of-book only — best bid and best ask, not a
              full depth ladder.
            </div>
          </Panel>

          {placed && <OrderTicketStatus placed={placed} status={status} onCancel={cancelOrder} />}
        </div>

        <Panel title="Order entry" pad={0} style={{ width: 340, flex: 'none' }}>
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
                padding: 3,
                background: C.inputBg,
                borderRadius: 5,
              }}
            >
              {['BUY', 'SELL'].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSide(s)
                    invalidate()
                  }}
                  style={{
                    padding: 9,
                    borderRadius: 3,
                    textAlign: 'center',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: side === s ? 600 : 500,
                    background: side === s ? (s === 'BUY' ? C.green : C.red) : 'transparent',
                    color: side === s ? (s === 'BUY' ? C.greenFg : '#3a0f0c') : C.t3,
                  }}
                >
                  {s === 'BUY' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>

            <Field label="SYMBOL">
              <input
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase())
                  invalidate()
                }}
                style={inputStyle}
              />
            </Field>

            <Field label="ORDER TYPE">
              <select
                value={orderType}
                onChange={(e) => {
                  setOrderType(e.target.value)
                  invalidate()
                }}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {ORDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="QUANTITY">
                <input
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value)
                    invalidate()
                  }}
                  placeholder="0"
                  inputMode="decimal"
                  style={inputStyle}
                />
              </Field>
              {orderType === 'LIMIT' && (
                <Field label="LIMIT PRICE">
                  <input
                    value={limitPrice}
                    onChange={(e) => {
                      setLimitPrice(e.target.value)
                      invalidate()
                    }}
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </Field>
              )}
              {orderType === 'STOP' && (
                <Field label="STOP PRICE">
                  <input
                    value={stopPrice}
                    onChange={(e) => {
                      setStopPrice(e.target.value)
                      invalidate()
                    }}
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </Field>
              )}
              {orderType === 'MARKET' && (
                <Field label="TIME IN FORCE">
                  <select
                    value={timeInForce}
                    onChange={(e) => {
                      setTimeInForce(e.target.value)
                      invalidate()
                    }}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    {TIF.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '13px 0',
                borderTop: `1px solid ${C.border2}`,
                borderBottom: `1px solid ${C.border2}`,
              }}
            >
              {preflight ? (
                <>
                  <Row k="Order value" v={fmtMoney(preflight.orderValue)} />
                  <Row k="Commission" v={fmtMoney(preflight.estimatedCommission)} />
                  <Row
                    k="Regulatory fees"
                    v={fmtMoney(
                      Number(preflight.regulatoryFees?.secFee || 0) +
                        Number(preflight.regulatoryFees?.tafFee || 0)
                    )}
                  />
                  <Row k="Est. quantity" v={preflight.estimatedQuantity ?? '—'} />
                  <Row k="Total cost" v={fmtMoney(preflight.estimatedCost)} bold />
                </>
              ) : (
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.t7, lineHeight: 1.6 }}>
                  Review the order to get live cost estimates from Public.com.
                </span>
              )}
            </div>

            <Row k="Buying power" v={fmtMoney(buyingPower)} muted />

            {error && (
              <div
                style={{
                  border: `1px solid ${C.redBorder}`,
                  background: C.redPanel,
                  borderRadius: 4,
                  padding: 11,
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: C.red,
                  wordBreak: 'break-word',
                }}
              >
                {error.detail || error.message}
              </div>
            )}

            {!confirming ? (
              <Btn
                onClick={preflight ? () => setConfirming(true) : review}
                disabled={!ticketValid || busy}
                style={{ padding: 12, fontSize: 13 }}
              >
                {busy ? 'Working…' : preflight ? 'Place order' : 'Review order'}
              </Btn>
            ) : (
              <div
                style={{
                  border: `1px solid ${C.amberDim}`,
                  borderRadius: 5,
                  padding: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 11,
                }}
              >
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.text, textWrap: 'pretty' }}>
                  Submit a real {side.toLowerCase()} order for{' '}
                  <strong>
                    {quantity} {order.symbol}
                  </strong>{' '}
                  {orderType === 'LIMIT' ? `at ${fmtMoney(limitPrice)}` : `at ${orderType.toLowerCase()}`}?
                  This places money at risk in your live Public.com account.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn onClick={place} disabled={busy} style={{ flex: 1, padding: 10, fontSize: 12.5 }}>
                    {busy ? 'Submitting…' : 'Confirm order'}
                  </Btn>
                  <Btn variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Proposed({ k, v, color = C.text }) {
  return (
    <div>
      <div style={{ ...label95, fontSize: 9, letterSpacing: '.07em' }}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: 14, color, marginTop: 3 }}>{v}</div>
    </div>
  )
}

function BookCell({ k, v, sub, color = C.text }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...label95, fontSize: 9 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 500, color }}>{v}</span>
      {sub && <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t6 }}>{sub}</span>}
    </div>
  )
}

function Row({ k, v, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: muted ? 11.5 : 12.5, fontWeight: bold ? 600 : 400, color: muted ? C.t5 : C.t2 }}>
        {k}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: muted ? 11.5 : bold ? 13.5 : 12.5,
          fontWeight: bold ? 500 : 400,
          color: muted ? C.t2 : C.text,
        }}
      >
        {v}
      </span>
    </div>
  )
}

function OrderTicketStatus({ placed, status, onCancel }) {
  const state = status?.status || 'SUBMITTED'
  const done = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(state)
  const color = state === 'FILLED' ? C.green : state === 'REJECTED' ? C.red : C.amber
  return (
    <Panel title="Submitted order" meta={placed.orderId}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: color,
              animation: done ? 'none' : 'tapulse 1.1s infinite',
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 13, color }}>{state}</span>
        </div>
        {status && (
          <>
            <Proposed k="SIDE" v={status.side || '—'} />
            <Proposed k="QUANTITY" v={status.quantity || '—'} />
            <Proposed k="FILLED" v={status.filledQuantity ?? '0'} />
            <Proposed k="AVG PRICE" v={status.averagePrice ? fmtMoney(status.averagePrice) : '—'} />
          </>
        )}
        {!done && (
          <Btn variant="danger" onClick={onCancel} style={{ marginLeft: 'auto' }}>
            Cancel order
          </Btn>
        )}
      </div>
    </Panel>
  )
}
