import { useEffect, useState } from 'react'
import { api } from '../api.js'
import BrokerPanel from '../components/BrokerPanel.jsx'
import { Panel } from '../components/ui.jsx'
import { C, MONO } from '../theme.js'

export default function Settings() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api.settings().then(setData).catch(() => setData(null))
  }, [])

  if (!data) {
    return (
      <div style={{ flex: 1, padding: '24px 26px', fontFamily: MONO, fontSize: 12, color: C.t6 }}>
        loading settings…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
        <BrokerPanel
          brokers={data.brokers}
          active={data.active_broker}
          onChange={(result) =>
            setData((prev) => ({ ...prev, brokers: result.brokers, active_broker: result.active }))
          }
        />

        <Panel
          title="LLM providers"
          pad={0}
          right={
            <span style={{ fontSize: 11.5, color: C.t5 }}>
              Auto-detected from environment. Key values are never read by this console.
            </span>
          }
        >
          {data.providers.map((p) => (
            <CredentialRow key={p.provider} left={p.k} env={p.env} status={p.status} ok={p.ok} />
          ))}
        </Panel>

        <Panel
          title="Data & brokerage credentials"
          pad={0}
          right={
            <span style={{ fontSize: 11.5, color: C.t5 }}>
              Public.com powers the dashboard and trade desk
            </span>
          }
        >
          {data.data_credentials.map((p) => (
            <CredentialRow key={p.env} left={p.k} env={p.env} status={p.status} ok={p.ok} />
          ))}
        </Panel>

        <Panel
          title="Data vendors"
          pad={0}
          right={
            <span style={{ fontSize: 11.5, color: C.t5 }}>
              Requests are never routed to a vendor you did not choose
            </span>
          }
        >
          {data.vendors.map((v) => (
            <div
              key={v.k}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '11px 18px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span style={{ flex: 1, fontFamily: MONO, fontSize: 12.5, color: C.t2 }}>{v.k}</span>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>{v.v}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Paths" pad={0}>
          {data.paths.map((p) => (
            <div
              key={p.k}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '11px 18px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span
                style={{ width: 170, flex: 'none', fontFamily: MONO, fontSize: 12.5, color: C.t2 }}
              >
                {p.k}
              </span>
              <span
                style={{ fontFamily: MONO, fontSize: 12.5, color: C.text, wordBreak: 'break-all' }}
              >
                {p.v}
              </span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}

function CredentialRow({ left, env, status, ok }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 18px',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ width: 160, flex: 'none', fontSize: 13, color: C.text }}>{left}</span>
      <span style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: C.t5 }}>{env}</span>
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: ok ? C.green : C.t5 }}>{status}</span>
    </div>
  )
}
