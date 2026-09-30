import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtNum, fmtPct, fmtSigned } from '../api.js'
import { L9, Notice, Panel } from '../components/ui.jsx'
import { C, MONO, label95, pnlColor, ratingStyle } from '../theme.js'

const COLS = '1.3fr 1fr .8fr .8fr .8fr 1fr 1fr .9fr'
const ACT_COLS = '.9fr 1fr 1.1fr .8fr .8fr .9fr 2fr'

// Every account the console can see: connected brokers (live) and statement
// exports (share counts as of the export, prices live). Click a holding for
// its full activity across every account.
export default function Holdings({ goto, setTicker }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [account, setAccount] = useState('all')
  const [open, setOpen] = useState(null) // `${account}:${sym}` of the expanded row

  useEffect(() => {
    api
      .holdings()
      .then(setData)
      .catch((err) => setError(err.detail || err.message))
  }, [])

  if (error) {
    return (
      <Page>
        <Notice tone="warn" title="Live portfolio unavailable">
          {error}
        </Notice>
      </Page>
    )
  }
  if (!data) {
    return <Page><Mono c={C.t6}>loading accounts · pricing holdings…</Mono></Page>
  }

  const rows = data.holdings.filter((h) => account === 'all' || h.account === account)
  const t = data.totals
  const missingBasis = data.holdings.filter((h) => h.cost === null && h.account.startsWith('stmt:')).length

  return (
    <Page>
      <div style={{ display: 'flex', gap: 18, marginBottom: 20, flexWrap: 'wrap' }}>
        <Stat label="TOTAL VALUE" value={fmtMoney(t.value)} />
        <Stat
          label={`UNREALIZED P/L · ${t.pl_positions} OF ${t.positions} WITH BASIS`}
          value={fmtSigned(t.pl)}
          color={pnlColor(t.pl)}
        />
        <Stat label="ACCOUNTS" value={fmtNum(data.accounts.length, 0)} />
        <Stat label="POSITIONS" value={fmtNum(t.positions, 0)} />
      </div>

      {data.errors.map((e) => (
        <div key={e} style={{ marginBottom: 12 }}>
          <Notice tone="warn" title="Statement skipped">{e}</Notice>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <AccountChip active={account === 'all'} onClick={() => setAccount('all')} label="All accounts" value={t.value} />
        {data.accounts.map((a) => (
          <AccountChip
            key={a.key}
            active={account === a.key}
            onClick={() => setAccount(a.key)}
            label={a.label}
            value={a.value}
            sub={a.error ? a.error : a.source === 'api' ? 'API · live' : `statement · as of ${a.as_of}`}
            warn={!!a.error}
          />
        ))}
      </div>

      <Panel title="Holdings" meta={`${rows.length} positions · click a row for activity`} pad={0}>
        <Header cols={COLS} labels={['ASSET', 'ACCOUNT', 'QTY', 'AVG COST', 'PRICE', 'VALUE', 'GAIN / LOSS', 'RATING']} />
        {rows.length === 0 && <Mono c={C.t7} style={{ display: 'block', padding: 18 }}>no positions</Mono>}
        {rows.map((h) => {
          const key = `${h.account}:${h.sym}`
          return (
            <div key={key}>
              <HoldingRow h={h} onClick={() => setOpen(open === key ? null : key)} />
              {open === key && (
                <Activity
                  symbol={h.sym}
                  onResearch={() => {
                    setTicker(h.sym)
                    goto('research')
                  }}
                />
              )}
            </div>
          )
        })}
      </Panel>

      <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10.5, color: C.t7, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
        {`Statement accounts read every QFX/OFX export in ${data.statements_dir}. Drop a newer export there to refresh share counts.\n` +
          (missingBasis
            ? `${missingBasis} statement holdings show no cost basis: they were bought before the earliest export. Add earlier years' exports to fill them in.`
            : '')}
      </div>
    </Page>
  )
}

function HoldingRow({ h, onClick }) {
  const pl = pnlColor(h.pl)
  const rs = ratingStyle(h.rating)
  return (
    <button
      type="button"
      className="row-hover"
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left', display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', padding: '10px 18px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <Mono size={13} c={C.text}>{h.sym}</Mono>
        <span style={{ fontSize: 10.5, color: C.t6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
      </span>
      <Mono size={11} c={C.t5}>{h.account_label}</Mono>
      <Num>{fmtNum(h.qty, h.qty % 1 !== 0 ? 4 : 0)}</Num>
      <Num c={C.t4}>{fmtNum(h.cost)}</Num>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        <Mono size={12.5} c={C.text}>{fmtNum(h.price)}</Mono>
        {h.price_as_of !== 'live' && <Mono size={9.5} c={C.amber}>as of {h.price_as_of}</Mono>}
      </span>
      <Num c={C.text}>{fmtMoney(h.value)}</Num>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        <Mono size={12.5} c={pl}>{fmtSigned(h.pl)}</Mono>
        <Mono size={10.5} c={pl}>{fmtPct(h.pl_pct)}</Mono>
      </span>
      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {h.rating ? (
          <span style={{ fontFamily: MONO, fontSize: 11, padding: '4px 9px', borderRadius: 3, background: rs.bg, color: rs.c }} title={`rated ${h.rated_on}`}>
            {h.rating}
          </span>
        ) : (
          <Mono size={10.5} c={C.t7}>never rated</Mono>
        )}
      </span>
    </button>
  )
}

function Activity({ symbol, onResearch }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .holdingActivity(symbol)
      .then(setData)
      .catch((err) => setError(err.detail || err.message))
  }, [symbol])

  return (
    <div style={{ background: C.panelDeep, borderBottom: `1px solid ${C.border2}`, padding: '12px 18px 14px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <L9>{symbol} · ALL ACTIVITY, EVERY ACCOUNT</L9>
        <button onClick={onResearch} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.link, fontFamily: MONO, fontSize: 10.5, cursor: 'pointer' }}>
          open in research hub →
        </button>
      </div>
      {error && <Mono c={C.red}>{error}</Mono>}
      {!data && !error && <Mono c={C.t6}>loading activity…</Mono>}
      {data?.errors.map((e) => (
        <Mono key={e} c={C.amber} style={{ display: 'block', marginBottom: 6 }}>{e}</Mono>
      ))}
      {data && data.rows.length === 0 && <Mono c={C.t7}>no recorded activity</Mono>}
      {data && data.rows.length > 0 && (
        <>
          <Header cols={ACT_COLS} labels={['DATE', 'ACCOUNT', 'ACTION', 'QTY', 'PRICE', 'AMOUNT', 'NOTE']} pad="6px 0" bg="transparent" />
          {data.rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: ACT_COLS, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
              <Mono size={11} c={C.t4}>{r.date}</Mono>
              <Mono size={11} c={C.t5}>{r.account_label}</Mono>
              <Mono size={11} c={r.action === 'BUY' ? C.green : r.action === 'SELL' ? C.red : C.t2} style={{ textAlign: 'right' }}>{r.action}</Mono>
              <Num size={11}>{r.qty ? fmtNum(r.qty, r.qty % 1 !== 0 ? 4 : 0) : '—'}</Num>
              <Num size={11}>{fmtNum(r.price)}</Num>
              <Num size={11} c={pnlColor(r.amount)}>{fmtSigned(r.amount)}</Num>
              <span style={{ fontSize: 10.5, color: C.t6, paddingLeft: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function AccountChip({ active, onClick, label, value, sub, warn }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `1px solid ${active ? C.blue : C.border2}`,
        background: active ? C.panelHi : C.panel,
        borderRadius: 8,
        padding: '9px 14px',
        cursor: 'pointer',
        minWidth: 150,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{label}</div>
      <Mono size={13} c={C.t2}>{fmtMoney(value)}</Mono>
      {sub && <Mono size={9.5} c={warn ? C.amber : C.t6} style={{ display: 'block', marginTop: 2, maxWidth: 260 }}>{sub}</Mono>}
    </button>
  )
}

function Header({ cols, labels, pad = '9px 18px', bg = C.panelHi }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, padding: pad, background: bg, borderBottom: `1px solid ${C.border2}` }}>
      {labels.map((l, i) => (
        <span key={l} style={{ ...label95, textAlign: i < 2 ? 'left' : 'right', paddingLeft: l === 'NOTE' ? 14 : 0 }}>{l}</span>
      ))}
    </div>
  )
}

function Stat({ label, value, color = C.text }) {
  return (
    <div style={{ border: `1px solid ${C.border2}`, borderRadius: 8, background: C.panel, padding: '12px 18px', minWidth: 160 }}>
      <L9 style={{ marginBottom: 6 }}>{label}</L9>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

const Page = ({ children }) => <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>{children}</div>
const Mono = ({ children, size = 12, c = C.text, style }) => (
  <span style={{ fontFamily: MONO, fontSize: size, color: c, ...style }}>{children}</span>
)
const Num = ({ children, size = 12.5, c = C.t1 }) => (
  <Mono size={size} c={c} style={{ textAlign: 'right' }}>{children}</Mono>
)
