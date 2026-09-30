import { marked } from 'marked'

// Every failed call carries the server's `detail` so screens can show why
// (missing credential, no active run, broker rejection) instead of "error".
export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  let body = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.detail ?? body ?? null)
  }
  return body
}

const get = (path) => request(path)
const post = (path, body) =>
  request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
const del = (path) => request(path, { method: 'DELETE' })

export const api = {
  bootstrap: () => get('/bootstrap'),
  settings: () => get('/settings'),

  startRun: (config) => post('/runs', config),
  listRuns: () => get('/runs'),
  getRun: (id) => get(`/runs/${id}`),
  cancelRun: (id) => post(`/runs/${id}/cancel`),

  history: () => get('/history'),

  wealthfrontScorecard: () => get('/wealthfront/scorecard'),

  scanModels: () => get('/models/scan'),

  models: (provider, backendUrl) =>
    get(
      `/models?provider=${encodeURIComponent(provider || '')}&backend_url=${encodeURIComponent(
        backendUrl || ''
      )}`
    ),

  portfolio: () => get('/portfolio'),
  holdings: () => get('/holdings'),
  holdingActivity: (symbol) => get(`/holdings/activity?symbol=${encodeURIComponent(symbol)}`),
  positionHeadlines: (symbols) =>
    get(`/portfolio/headlines?symbols=${encodeURIComponent(symbols.join(','))}`),
  macro: () => get('/macro'),

  quote: (ticker) => get(`/quote/${encodeURIComponent(ticker)}`),

  watchlist: () => get('/watchlist'),
  addWatch: (symbol) => post('/watchlist', { symbol }),
  removeWatch: (symbol) => del(`/watchlist/${encodeURIComponent(symbol)}`),

  tradeQuotes: (symbols) => post('/trade/quotes', { symbols }),
  preflight: (order) => post('/trade/preflight', order),
  // `token` comes from preflight — E*TRADE will not place without it.
  placeOrder: (order, token) => post('/trade/order', { order, token }),
  orderStatus: (id) => get(`/trade/order/${id}`),
  cancelOrder: (id) => del(`/trade/order/${id}`),

  brokers: () => get('/brokers'),
  setBroker: (name) => post('/brokers/active', { name }),
  etradeAuthorize: () => post('/brokers/etrade/authorize'),
  etradeVerify: (verifier) => post('/brokers/etrade/verify', { verifier }),
  etradeDisconnect: () => post('/brokers/etrade/disconnect'),
}

/**
 * Subscribe to a run's event stream.
 * Returns a close function. The stream replays from the beginning on connect,
 * so a late subscriber still sees the whole run.
 */
export function streamRun(runId, onEvent) {
  const source = new EventSource(`/api/runs/${runId}/stream`)
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data)
      if (event.type === 'stream.end') {
        source.close()
        return
      }
      onEvent(event)
    } catch {
      /* ignore malformed frames */
    }
  }
  source.onerror = () => source.close()
  return () => source.close()
}

marked.setOptions({ breaks: true, gfm: true })

/**
 * Render agent markdown to HTML.
 * Raw HTML in the source is escaped first so model output is always displayed
 * as text rather than injected into the page.
 */
export function renderMarkdown(text) {
  if (!text) return ''
  const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return marked.parse(escaped)
}

// -- formatting helpers shared across screens ----------------------------

export const fmtMoney = (v, digits = 2) =>
  v === null || v === undefined
    ? '—'
    : `$${Number(v).toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`

export const fmtNum = (v, digits = 2) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })

export const fmtPct = (v, digits = 2) =>
  v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(digits)}%`

export const fmtSigned = (v) =>
  v === null || v === undefined
    ? '—'
    : `${v >= 0 ? '+' : '-'}$${Math.abs(Number(v)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

export const fmtSecs = (s) => {
  if (s === null || s === undefined) return '—'
  const total = Math.round(s)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}
