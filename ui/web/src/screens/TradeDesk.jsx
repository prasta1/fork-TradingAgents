import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtMoney, fmtNum } from '../api.js'
import { Btn, Notice, inputStyle } from '../components/ui.jsx'
import { C, MONO, label95 } from '../theme.js'

const ORDER_TYPES = ['MARKET', 'LIMIT', 'STOP']
const TIF = ['DAY', 'GTC']

/**
 * Order entry against the live brokerage account, laid out as forecast vs
 * observation: the agent's view is drawn dashed in mauve, what the broker and
 * market report is drawn solid. Only symbol and side ever cross from one to
 * the other.
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
  const [quoteAt, setQuoteAt] = useState(null)
  // Daily closes for the observed line; null means the fetch failed, which
  // must look different from "no data".
  const [closes, setCloses] = useState([])
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
      setQuoteAt(new Date())
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

  useEffect(() => {
    if (!symbol) return
    let live = true
    api
      .quote(symbol.toUpperCase())
      .then((r) => live && setCloses(r.spark?.closes || []))
      .catch(() => live && setCloses(null))
    return () => {
      live = false
    }
  }, [symbol])

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


  const hasProposal = Boolean(decision.rating && run?.request?.ticker)
  const proposalHere = hasProposal && run.request.ticker === order.symbol
  const brokerLabel = activeBroker?.label || boot.active_broker

  function loadProposal() {
    setSymbol(run.request.ticker)
    setSide(['Sell', 'Underweight'].includes(decision.rating) ? 'SELL' : 'BUY')
    // The target is where the agent expects to exit, not an entry price —
    // using it as a buy limit fills at market. Leave it blank.
    setLimitPrice('')
    invalidate()
  }

  const edit = (setter) => (e) => {
    setter(e.target.value)
    invalidate()
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', maxWidth: 1320 }}>
        <div style={{ flex: '1 1 540px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {hasProposal ? (
            <ForecastPanel run={run} decision={decision} closes={proposalHere ? closes : null} onLoad={loadProposal} />
          ) : (
            <section
              aria-label="Agent forecast"
              style={{ border: `1px dashed ${C.mauve}`, borderRadius: 8, padding: '14px 16px' }}
            >
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: C.mauve }}>No agent forecast loaded</h2>
              <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55, color: C.t2 }}>
                Finish a run to see the Portfolio Manager's view here, drawn against what the market
                actually did. You can still trade manually.
              </p>
            </section>
          )}
          {!proposalHere && order.symbol && (
            <ObservedPanel symbol={order.symbol} closes={closes} />
          )}
          {placed && <OrderTicketStatus placed={placed} status={status} onCancel={cancelOrder} brokerLabel={brokerLabel} />}
        </div>

        <section
          aria-label="Order ticket"
          className="td-ticket"
          style={{
            border: `1px solid ${C.border3}`,
            borderRadius: 8,
            background: C.panel,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 9999, background: C.text }} />
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 650, color: C.text }}>Order ticket · live</h2>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.t2 }}>{brokerLabel}</span>
          </div>

          <Seg
            label="Side"
            value={side}
            options={[['BUY', 'Buy'], ['SELL', 'Sell']]}
            onChange={(v) => {
              setSide(v)
              invalidate()
            }}
            fill={(v) => (v === 'BUY' ? C.green : C.red)}
            height={38}
          />

          <TicketRow label="Symbol">
            <input
              aria-label="Symbol"
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase())
                invalidate()
              }}
              style={inputStyle}
            />
          </TicketRow>

          <TicketRow label="Order type">
            <Seg
              label="Order type"
              value={orderType}
              options={ORDER_TYPES.map((t) => [t, t[0] + t.slice(1).toLowerCase()])}
              onChange={(v) => {
                setOrderType(v)
                invalidate()
              }}
            />
          </TicketRow>

          <TicketRow label="Quantity">
            <input
              aria-label="Quantity"
              value={quantity}
              onChange={edit(setQuantity)}
              placeholder="0"
              inputMode="decimal"
              style={inputStyle}
            />
          </TicketRow>

          {orderType !== 'MARKET' && (
            <TicketRow label={orderType === 'LIMIT' ? 'Limit price' : 'Stop price'}>
              <input
                aria-label={orderType === 'LIMIT' ? 'Limit price' : 'Stop price'}
                aria-invalid={priceTooPrecise || undefined}
                value={orderType === 'LIMIT' ? limitPrice : stopPrice}
                onChange={edit(orderType === 'LIMIT' ? setLimitPrice : setStopPrice)}
                inputMode="decimal"
                style={{ ...inputStyle, borderColor: priceTooPrecise ? C.red : C.border3 }}
              />
            </TicketRow>
          )}

          {priceTooPrecise && (
            <div role="alert" style={{ fontSize: 12, lineHeight: 1.5, color: C.red, marginTop: -4 }}>
              Use at most two decimal places for the {orderType === 'STOP' ? 'stop' : 'limit'} price (e.g.{' '}
              {Number(activePrice).toFixed(2)}).
            </div>
          )}

          {proposalHere && (decision.price_target || decision.stop) && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11.5,
                color: C.mauve,
                border: `1px dashed ${C.mauve}`,
                borderRadius: 4,
                padding: '4px 8px',
                marginTop: -4,
              }}
            >
              Ref only · tgt {decision.price_target ? fmtMoney(decision.price_target) : '—'} · stop{' '}
              {decision.stop ? fmtMoney(decision.stop) : '—'}
            </div>
          )}

          {/* Sent with every order type, so it is always visible. */}
          <TicketRow label="Time in force">
            <Seg
              label="Time in force"
              value={timeInForce}
              options={TIF.map((t) => [t, t])}
              onChange={(v) => {
                setTimeInForce(v)
                invalidate()
              }}
            />
          </TicketRow>

          <TopOfBook symbol={order.symbol} quote={quote} at={quoteAt} onRefresh={() => loadQuote(symbol)} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {preflight ? (
              <>
                <Row k="Order value" v={fmtMoney(preflight.order_value)} />
                <Row k="Commission" v={fmtMoney(preflight.commission)} />
                <Row k="Regulatory fees" v={fmtMoney(preflight.fees)} />
                <Row k="Est. quantity" v={preflight.estimated_quantity ?? '—'} />
                <Row k="Total cost" v={fmtMoney(preflight.estimated_cost)} bold />
              </>
            ) : (
              <span style={{ fontSize: 12, color: C.t3, lineHeight: 1.5 }}>
                Review the order to get live cost estimates from {brokerLabel}.
              </span>
            )}
            <Row k="Buying power" v={buyingPower == null ? 'unavailable' : fmtMoney(buyingPower)} muted />
          </div>

          {error && (
            <div
              role="alert"
              style={{
                border: `1px solid ${C.redBorder}`,
                background: C.redPanel,
                borderRadius: 4,
                padding: 11,
                fontSize: 12,
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
              variant="ghost"
              onClick={preflight ? () => setConfirming(true) : review}
              disabled={!ticketValid || busy}
              style={{
                padding: 11,
                fontSize: 13.5,
                fontWeight: 650,
                color: C.text,
                opacity: !ticketValid || busy ? 0.45 : 1,
              }}
            >
              {busy ? 'Working…' : preflight ? 'Place order' : 'Review order'}
            </Btn>
          ) : (
            <div
              style={{
                border: `1px solid ${C.border3}`,
                borderRadius: 6,
                padding: 12,
                background: C.panelDeep,
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.55, color: C.text, textWrap: 'pretty' }}>
                <strong>
                  {side === 'SELL' ? 'Sell' : 'Buy'} {quantity} {order.symbol}{' '}
                  {orderType === 'LIMIT'
                    ? `at ${fmtMoney(limitPrice)} limit`
                    : orderType === 'STOP'
                      ? `with a stop at ${fmtMoney(stopPrice)}`
                      : 'at market'}
                  , {timeInForce}.
                </strong>
                {preflight?.estimated_cost != null && (
                  <>
                    {' '}Est. total {fmtMoney(preflight.estimated_cost)}
                    {Number(buyingPower) > 0 &&
                      ` (${((Number(preflight.estimated_cost) / Number(buyingPower)) * 100).toFixed(1)}% of buying power)`}
                    .
                  </>
                )}{' '}
                <span style={{ color: C.red }}>
                  This places money at risk in your live {brokerLabel} account.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" onClick={() => setConfirming(false)} style={{ color: C.text }}>
                  Edit
                </Btn>
                <Btn
                  variant={side === 'SELL' ? 'sell' : 'green'}
                  onClick={place}
                  disabled={busy}
                  style={{ flex: 1, padding: 11, fontSize: 13.5 }}
                >
                  {busy ? 'Submitting…' : `${side === 'SELL' ? 'Confirm sell' : 'Confirm buy'} · ${quantity} ${order.symbol}`}
                </Btn>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** "4 weeks" / "10 days" / "3 months" → days; null when the agent's wording doesn't parse. */
function parseHorizonDays(text) {
  const m = /(\d+(?:\.\d+)?)\s*(day|week|month|year)/i.exec(text || '')
  if (!m) return null
  const per = { day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()]
  return Number(m[1]) * per
}

const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** Segmented control: one pressed button, filled in Blue unless `fill` says otherwise. */
function Seg({ label, value, options, onChange, fill = () => C.blue, height = 32 }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        border: `1px solid ${C.border3}`,
        borderRadius: 5,
        overflow: 'hidden',
      }}
    >
      {options.map(([v, text], i) => {
        const on = v === value
        return (
          <button
            key={v}
            aria-pressed={on}
            onClick={() => onChange(v)}
            style={{
              height,
              fontSize: 13,
              fontWeight: on ? 650 : 500,
              cursor: 'pointer',
              background: on ? fill(v) : 'transparent',
              color: on ? C.onFill : C.t2,
              borderLeft: i ? `1px solid ${C.border3}` : 'none',
            }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

function TicketRow({ label, children }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: C.t2 }}>{label}</span>
      {children}
    </label>
  )
}

function TopOfBook({ symbol, quote, at, onRefresh }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 11 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: C.t2 }}>Top of book · {symbol || '—'}</span>
        <button
          className="link-hover"
          onClick={onRefresh}
          style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11.5, color: C.t1, cursor: 'pointer' }}
          title="Refresh quote"
        >
          {at ? `Observed ${hhmm(at)}` : 'Refresh'}
        </button>
      </div>
      {quote ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            border: `1px solid ${C.border}`,
            borderRadius: 5,
          }}
        >
          <Book k="Bid" v={fmtNum(quote.bid)} sub={quote.bid_size != null ? `×${quote.bid_size}` : ''} />
          <Book k="Ask" v={fmtNum(quote.ask)} sub={quote.ask_size != null ? `×${quote.ask_size}` : ''} divider />
          <Book
            k="Last · 1D"
            v={fmtNum(quote.last)}
            sub={quote.change_pct != null ? `${quote.change_pct >= 0 ? '+' : ''}${Number(quote.change_pct).toFixed(2)}%` : ''}
            subColor={Number(quote.change_pct || 0) >= 0 ? C.green : C.red}
            divider
          />
        </div>
      ) : (
        <span style={{ fontSize: 12, color: C.amber }}>Observation unavailable for this symbol.</span>
      )}
    </div>
  )
}

function Book({ k, v, sub, subColor = C.t3, divider }) {
  return (
    <div style={{ padding: '7px 9px', borderLeft: divider ? `1px solid ${C.border}` : 'none' }}>
      <div style={{ fontSize: 11.5, color: C.t3 }}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: C.text }}>
        {v}
        {sub && <span style={{ fontSize: 11, fontWeight: 400, color: subColor, marginLeft: 4 }}>{sub}</span>}
      </div>
    </div>
  )
}

/**
 * The agent's view of one ticker, drawn in the forecast register (dashed,
 * mauve). Only fields the run actually produced are shown; how a forecast
 * turns into a band or probability is still undecided, so none is drawn.
 */
function ForecastPanel({ run, decision, closes, onLoad }) {
  const issued = run.started_at ? new Date((run.started_at + (run.elapsed || 0)) * 1000) : null
  return (
    <section
      aria-label="Agent forecast"
      style={{ border: `1px dashed ${C.mauve}`, borderRadius: 8, background: C.panel, padding: '14px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: C.mauve }}>
            {run.request.ticker} forecast · <strong style={{ fontWeight: 750 }}>{decision.rating}</strong>
            {decision.price_target && <> · target {fmtMoney(decision.price_target)}</>}
            {decision.stop && <> · stop {fmtMoney(decision.stop)}</>}
          </h2>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.mauve, marginTop: 5, opacity: 0.9 }}>
            Issued {issued ? hhmm(issued) : '—'} by run_{run.run_id}
            {decision.horizon && <> · valid {decision.horizon}</>}
            {decision.size && <> · size {decision.size}</>}
          </div>
        </div>
        <Btn
          variant="ghost"
          onClick={onLoad}
          style={{ color: C.mauve, border: `1px dashed ${C.mauve}` }}
          title="Fills symbol and side only"
        >
          Load into ticket
        </Btn>
      </div>
      <PriceChart closes={closes} decision={decision} issued={issued} />
      <div style={{ fontSize: 12, color: C.t3, marginTop: 8 }}>
        Loading fills symbol and side only; nothing is sent until you review and confirm.
      </div>
    </section>
  )
}

/** Observed prices for a symbol that has no agent forecast. */
function ObservedPanel({ symbol, closes }) {
  return (
    <section
      aria-label={`${symbol} observed`}
      style={{ border: `1px solid ${C.border3}`, borderRadius: 8, background: C.panel, padding: '14px 16px' }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: C.text }}>{symbol} · observed</h2>
      <PriceChart closes={closes} />
    </section>
  )
}

/**
 * Solid observed closes up to a "now" rule; when a decision is given, a
 * forecast window to the right carries its target and stop as dashed
 * reference lines. Plain SVG — no chart dependency.
 */
function PriceChart({ closes, decision, issued }) {
  const W = 760
  const H = 320
  const padT = 22
  const padB = 24
  const axisW = 52
  const plotR = W - axisW
  const forecast = Boolean(decision)
  // Scale the forecast window to the horizon when it reads as "N days/weeks/
  // months": 30 sessions ≈ 42 calendar days of observed history. This is only
  // the run's own horizon on a time axis — no forecast model is implied.
  const horizonDays = forecast ? parseHorizonDays(decision.horizon) : null
  const share = horizonDays ? Math.min(Math.max(42 / (42 + horizonDays), 0.5), 0.8) : 0.66
  // Without a forecast, stop short of the axis to leave a lane for the LAST tag.
  const nowX = forecast ? Math.round(plotR * share) : plotR - 120
  const validTo = horizonDays && issued ? new Date(issued.getTime() + horizonDays * 86400000) : null

  if (closes === null) {
    return <ChartNote tone="warn">Observation unavailable: price history could not be loaded.</ChartNote>
  }
  if (!closes?.length) {
    return <ChartNote>Loading observed prices…</ChartNote>
  }

  const observedAt = hhmm(new Date())
  const refs = forecast ? [decision.price_target, decision.stop].filter((v) => Number(v) > 0).map(Number) : []
  const values = [...closes, ...refs]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  const pad = (hi - lo) * 0.08 || 1
  lo -= pad
  hi += pad
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const x = (i) => (closes.length === 1 ? nowX : (i / (closes.length - 1)) * nowX)
  const line = closes.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ')
  const last = closes[closes.length - 1]
  // Round tick steps (1, 2, 2.5, 5 × 10^n) so the axis reads 210 / 220 / 230.
  const raw = (hi - lo) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw)
  const ticks = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        forecast
          ? `Observed closes ending at ${fmtNum(last)}; forecast target ${decision.price_target ?? 'none'}, stop ${decision.stop ?? 'none'}`
          : `Observed closes ending at ${fmtNum(last)}`
      }
      style={{ width: '100%', height: 'auto', display: 'block', marginTop: 12, fontFamily: MONO }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={plotR} y1={y(t)} y2={y(t)} stroke={C.border} />
          <text x={plotR + 8} y={y(t) + 4} fontSize="11" fill={C.t3}>
            {step < 1 ? t.toFixed(2) : t.toFixed(0)}
          </text>
        </g>
      ))}

      {forecast && (
        <>
          <rect x={nowX} y={0} width={plotR - nowX} height={H - padB} fill={C.mauveBg} />
          <text x={nowX + 8} y={13} fontSize="11" fill={C.mauve}>
            FORECAST · dashed{decision.horizon ? ` · valid ${decision.horizon}` : ''}
          </text>
          {validTo && (
            <text x={plotR} y={H - 6} fontSize="11" fill={C.mauve} textAnchor="end">
              valid to {validTo.toLocaleDateString([], { day: 'numeric', month: 'short' })}
            </text>
          )}
          <text x={plotR - 6} y={H - padB - 8} fontSize="10.5" fill={C.t3} textAnchor="end">
            forecast view · work in progress
          </text>
          {decision.price_target > 0 && (
            <RefLine x1={nowX} x2={plotR} y={y(decision.price_target)} dash="6 4" label={`TARGET ${fmtNum(decision.price_target)}`} />
          )}
          {decision.stop > 0 && (
            <RefLine x1={nowX} x2={plotR} y={y(decision.stop)} dash="2 3" label={`STOP ${fmtNum(decision.stop)}`} />
          )}
        </>
      )}

      <text x={nowX - 8} y={13} fontSize="11" fill={C.t1} textAnchor="end">
        OBSERVED · {closes.length} sessions · solid{observedAt ? ` · ${observedAt}` : ''}
      </text>
      <polyline points={line} fill="none" stroke={C.text} strokeWidth="1.8" strokeLinejoin="round" />
      <line x1={nowX} x2={nowX} y1={0} y2={H - padB} stroke={C.t1} strokeWidth="1.2" />
      <circle cx={nowX} cy={y(last)} r="3.5" fill={C.text} />
      {/* The tag sits just past the now rule, so it never covers observed prices. */}
      <g transform={`translate(${nowX + 8}, ${Math.max(Math.min(y(last) - 10, H - padB - 24), 20)})`}>
        <rect width="108" height="20" rx="3" fill={C.text} />
        <text x="54" y="14" fontSize="12" fontWeight="600" fill={C.onFill} textAnchor="middle">
          LAST {fmtNum(last)}
        </text>
      </g>
      <text x={nowX} y={H - 6} fontSize="11" fill={C.t3} textAnchor="middle">
        now
      </text>
    </svg>
  )
}

/** A forecast reference level: always mauve (it is the agent's number, not money); target and stop differ by dash and label. */
function RefLine({ x1, x2, y, dash, label }) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={C.mauve} strokeDasharray={dash} strokeWidth="1.4" />
      <text x={x2 - 6} y={y - 5} fontSize="11" fontWeight="600" fill={C.mauve} textAnchor="end">
        {label}
      </text>
    </g>
  )
}

function ChartNote({ children, tone }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '28px 16px',
        border: `1px dashed ${C.border3}`,
        borderRadius: 6,
        fontSize: 12.5,
        color: tone === 'warn' ? C.amber : C.t3,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}

function Row({ k, v, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: muted ? 12 : 12.5, fontWeight: bold ? 650 : 400, color: muted ? C.t3 : C.t1 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: bold ? 13.5 : 12.5, fontWeight: bold ? 600 : 400, color: C.text }}>{v}</span>
    </div>
  )
}

/** The submitted order, in the observation register: solid, stamped, broker-reported. */
function OrderTicketStatus({ placed, status, onCancel, brokerLabel }) {
  const state = status?.status || 'SUBMITTED'
  const done = ['FILLED', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(state)
  const color = state === 'FILLED' || state === 'EXECUTED' ? C.green : state === 'REJECTED' ? C.red : C.amber
  return (
    <section
      aria-label="Submitted order"
      style={{ border: `1px solid ${C.border3}`, borderRadius: 8, background: C.panel, padding: '14px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: C.text }}>Order · reported by {brokerLabel}</h2>
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.t3 }}>{placed.order_id}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }} role="status">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              background: color,
              animation: done ? 'none' : 'tapulse 1.1s infinite',
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 13, color }}>{state}</span>
        </div>
        {status && (
          <>
            <Stat k="Side" v={status.side || '—'} />
            <Stat k="Quantity" v={status.quantity || '—'} />
            <Stat k="Filled" v={status.filled_quantity ?? '0'} />
            <Stat k="Avg price" v={status.average_price ? fmtMoney(status.average_price) : '—'} />
          </>
        )}
        {!done && (
          <Btn variant="danger" onClick={onCancel} style={{ marginLeft: 'auto' }}>
            Cancel order
          </Btn>
        )}
      </div>
    </section>
  )
}

function Stat({ k, v }) {
  return (
    <div>
      <div style={{ ...label95, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: 14, color: C.text, marginTop: 3 }}>{v}</div>
    </div>
  )
}
