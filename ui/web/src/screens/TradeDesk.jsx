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

  // Seed an empty limit from the live quote — except for the agent's proposed
  // symbol, where the limit stays blank so you set the entry deliberately.
  useEffect(() => {
    if (limitPrice) return
    if (decision.price_target && run?.request?.ticker === symbol) return
    // Quotes can carry sub-cent precision (e.g. 185.1252); brokers only take cents.
    if (quote?.last) setLimitPrice(Number(quote.last).toFixed(2))
    // Only seeds an empty field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const activeBroker = (boot.brokers || []).find((b) => b.name === boot.active_broker)

  if (!boot.broker_connected) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px' }}>
        <Notice title="No brokerage connected">
          Order entry needs a connected brokerage. Public.com connects from a secret in your
          .env; E*TRADE needs a consumer key plus a one-time authorization each day, both from
          Settings.
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>
            PUBLIC_API_SECRET=your_secret_key
            <br />
            ETRADE_CONSUMER_KEY=… / ETRADE_CONSUMER_SECRET=…
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

  // Brokers reject prices finer than a cent. Flag it here rather than silently
  // rounding a price the user typed.
  const activePrice = orderType === 'LIMIT' ? limitPrice : orderType === 'STOP' ? stopPrice : ''
  const priceTooPrecise = /\.\d{3,}$/.test(String(activePrice).trim())

  const ticketValid =
    order.symbol &&
    Number(quantity) > 0 &&
    !priceTooPrecise &&
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
      // The preflight token proves this exact ticket was reviewed.
      const result = await api.placeOrder(order, preflight?.token)
      setPlaced(result)
      setConfirming(false)
      setPreflight(null)
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.orderStatus(result.order_id)
          setStatus(s)
          if (
            ['FILLED', 'EXECUTED', 'CANCELLED', 'CANCEL_REQUESTED', 'REJECTED', 'EXPIRED'].includes(
              s.status
            )
          ) {
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
      await api.cancelOrder(placed.order_id)
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
                    // The target is where the agent expects to exit, not an entry
                    // price — using it as a buy limit fills at market. Leave it blank.
                    setLimitPrice('')
                    invalidate()
                  }}
                >
                  Load into ticket
                </Btn>
              </div>
              <div style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.55, color: C.t4, textWrap: 'pretty' }}>
                Loading a proposal fills the symbol and side only — you set quantity and price.
                Nothing is sent to {activeBroker?.label || boot.active_broker} until you review
                and confirm below.
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
                <BookCell k="BID" v={fmtNum(quote.bid)} sub={`${quote.bid_size ?? '—'} size`} color={C.green} />
                <BookCell k="ASK" v={fmtNum(quote.ask)} sub={`${quote.ask_size ?? '—'} size`} color={C.red} />
                <BookCell k="LAST" v={fmtNum(quote.last)} sub={`vol ${Number(quote.volume || 0).toLocaleString()}`} />
                <BookCell
                  k="1D CHANGE"
                  v={quote.change_pct !== null && quote.change_pct !== undefined ? `${Number(quote.change_pct).toFixed(2)}%` : '—'}
                  sub={quote.previous_close ? `prev ${fmtNum(quote.previous_close)}` : ''}
                  color={Number(quote.change_pct || 0) >= 0 ? C.green : C.red}
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

        <Panel
          title="Order entry"
          pad={0}
          style={{ width: 340, flex: 'none' }}
          right={
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                padding: '4px 9px',
                borderRadius: 3,
                background: C.greenBg,
                color: C.green,
              }}
            >
              {activeBroker?.label || boot.active_broker}
            </span>
          }
        >
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
              {/* Sent with every order type, so it is always visible. */}
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
            </div>

            {priceTooPrecise && (
              <div style={{ fontSize: 11.5, lineHeight: 1.55, color: C.red, marginTop: -6 }}>
                Use at most two decimal places for the {orderType === 'STOP' ? 'stop' : 'limit'} price
                (e.g. {Number(activePrice).toFixed(2)}).
              </div>
            )}

            {hasProposal && run.request.ticker === order.symbol && (decision.price_target || decision.stop) && (
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.t4, lineHeight: 1.55, marginTop: -6 }}>
                Agent reference · target{' '}
                <span style={{ color: C.text }}>{decision.price_target ? fmtMoney(decision.price_target) : '—'}</span>
                {' '}· stop{' '}
                <span style={{ color: C.red }}>{decision.stop ? fmtMoney(decision.stop) : '—'}</span>
              </div>
            )}

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
                  <Row k="Order value" v={fmtMoney(preflight.order_value)} />
                  <Row k="Commission" v={fmtMoney(preflight.commission)} />
                  <Row k="Regulatory fees" v={fmtMoney(preflight.fees)} />
                  <Row k="Est. quantity" v={preflight.estimated_quantity ?? '—'} />
                  <Row k="Total cost" v={fmtMoney(preflight.estimated_cost)} bold />
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
                  {orderType === 'LIMIT'
                    ? `at ${fmtMoney(limitPrice)}`
                    : orderType === 'STOP'
                      ? `with a stop at ${fmtMoney(stopPrice)}`
                      : 'at market'}
                  , {timeInForce}?
                  {preflight?.estimated_cost != null && (
                    <>
                      {' '}Est. total <strong>{fmtMoney(preflight.estimated_cost)}</strong>
                      {Number(buyingPower) > 0 &&
                        ` (${((Number(preflight.estimated_cost) / Number(buyingPower)) * 100).toFixed(1)}% of buying power)`}
                      .
                    </>
                  )}{' '}
                  This places money at risk in your live{' '}
                  <strong>{activeBroker?.label || boot.active_broker}</strong> account.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn
                    variant={side === 'SELL' ? 'sell' : 'green'}
                    onClick={place}
                    disabled={busy}
                    style={{ flex: 1, padding: 10, fontSize: 12.5 }}
                  >
                    {busy ? 'Submitting…' : side === 'SELL' ? 'Confirm sell' : 'Confirm buy'}
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
  const done = ['FILLED', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(state)
  const color =
    state === 'FILLED' || state === 'EXECUTED'
      ? C.green
      : state === 'REJECTED'
        ? C.red
        : C.amber
  return (
    <Panel title="Submitted order" meta={placed.order_id}>
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
            <Proposed k="FILLED" v={status.filled_quantity ?? '0'} />
            <Proposed k="AVG PRICE" v={status.average_price ? fmtMoney(status.average_price) : '—'} />
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
