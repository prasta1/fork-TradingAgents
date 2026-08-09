import { useState } from 'react'
import { api } from '../api.js'
import { C, MONO, label95 } from '../theme.js'
import { Btn, Field, Panel, inputStyle } from './ui.jsx'

/**
 * Brokerage connection management.
 *
 * Public.com connects unattended from a secret in .env. E*TRADE cannot: its
 * OAuth 1.0a flow is out-of-band, so the user opens an E*TRADE page, logs in
 * there, and pastes back the verification code it displays. Their credentials
 * never touch this app.
 */
export default function BrokerPanel({ brokers, active, onChange }) {
  const [authUrl, setAuthUrl] = useState(null)
  const [verifier, setVerifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function run(fn) {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      if (result?.brokers) onChange(result)
      return result
    } catch (err) {
      setError(err.detail || err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function startEtrade() {
    const result = await run(api.etradeAuthorize)
    if (result?.authorize_url) setAuthUrl(result.authorize_url)
  }

  async function verifyEtrade() {
    const result = await run(() => api.etradeVerify(verifier))
    if (result) {
      setAuthUrl(null)
      setVerifier('')
    }
  }

  return (
    <Panel
      title="Brokerage"
      pad={0}
      right={
        <span style={{ fontSize: 11.5, color: C.t5 }}>
          Dashboard and Trade desk read the active account
        </span>
      }
    >
      {brokers.map((b) => (
        <div
          key={b.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '13px 18px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 9999,
              flex: 'none',
              background: b.connected ? C.green : b.configured ? C.amber : C.t8,
            }}
          />
          <span style={{ width: 130, flex: 'none', fontSize: 13, color: C.text }}>{b.label}</span>
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>
            {b.connected
              ? 'connected'
              : b.needs_authorization
                ? 'key present · not authorized'
                : 'no credentials in environment'}
          </span>

          {b.name === 'etrade' && b.configured && (
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() =>
                b.connected ? run(api.etradeDisconnect) : startEtrade()
              }
            >
              {b.connected ? 'Disconnect' : 'Connect'}
            </Btn>
          )}

          {b.active ? (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                padding: '4px 10px',
                borderRadius: 3,
                background: C.greenBg,
                color: C.green,
              }}
            >
              active
            </span>
          ) : (
            <Btn
              variant="ghost"
              disabled={busy || !b.connected}
              onClick={() => run(() => api.setBroker(b.name))}
              title={b.connected ? undefined : 'Connect this brokerage first'}
            >
              Use
            </Btn>
          )}
        </div>
      ))}

      {authUrl && (
        <div
          style={{
            padding: 18,
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 13,
            background: C.panelHi,
          }}
        >
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.t1, textWrap: 'pretty' }}>
            <strong style={{ color: C.text }}>Step 1</strong> — open this link, sign in to
            E*TRADE and accept. E*TRADE will show a verification code.
          </div>
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: MONO,
              fontSize: 11.5,
              color: C.green,
              wordBreak: 'break-all',
              padding: '9px 11px',
              borderRadius: 4,
              border: `1px solid ${C.greenBorder}`,
              background: C.greenPanel,
            }}
          >
            {authUrl}
          </a>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.t1 }}>
            <strong style={{ color: C.text }}>Step 2</strong> — paste the code here.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Field label="VERIFICATION CODE">
                <input
                  value={verifier}
                  onChange={(e) => setVerifier(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && verifier && verifyEtrade()}
                  placeholder="ABC12"
                  style={inputStyle}
                />
              </Field>
            </div>
            <Btn onClick={verifyEtrade} disabled={busy || !verifier.trim()}>
              {busy ? 'Verifying…' : 'Complete'}
            </Btn>
            <Btn variant="ghost" onClick={() => setAuthUrl(null)}>
              Cancel
            </Btn>
          </div>
          <div style={{ ...label95, fontWeight: 400, color: C.t6, lineHeight: 1.5 }}>
            E*TRADE tokens expire at midnight US/Eastern, so this is a daily step.
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 18px',
            fontSize: 12,
            lineHeight: 1.55,
            color: C.red,
            borderBottom: `1px solid ${C.border}`,
            wordBreak: 'break-word',
          }}
        >
          {error}
        </div>
      )}
    </Panel>
  )
}
