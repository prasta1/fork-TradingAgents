import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import ModelPicker from '../components/ModelPicker.jsx'
import { Btn, Field, L9, Notice, Panel, inputStyle, readonlyStyle } from '../components/ui.jsx'
import { C, MONO, label95 } from '../theme.js'

// Mirrors benchmark_map in tradingagents/default_config.py — the alpha
// benchmark is resolved from the ticker's exchange suffix.
const BENCHMARKS = {
  '.NS': '^NSEI',
  '.BO': '^BSESN',
  '.T': '^N225',
  '.HK': '^HSI',
  '.L': '^FTSE',
  '.TO': '^GSPTSE',
  '.AX': '^AXJO',
  '.SS': '000001.SS',
  '.SZ': '399001.SZ',
}

const CRYPTO_SUFFIXES = ['-USD', '-USDT', '-USDC', '-BTC', '-ETH']

function resolveBenchmark(ticker) {
  const upper = (ticker || '').toUpperCase()
  const suffix = Object.keys(BENCHMARKS).find((s) => upper.endsWith(s))
  return suffix ? BENCHMARKS[suffix] : 'SPY'
}

function detectAssetType(ticker) {
  const upper = (ticker || '').toUpperCase()
  return CRYPTO_SUFFIXES.some((s) => upper.endsWith(s)) ? 'crypto' : 'stock'
}

export default function DeployRun({ boot, ticker, setTicker, tradeDate, setTradeDate, start, goto }) {
  const { defaults, analysts: analystOptions } = boot
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState(defaults.llm_provider)
  const [deepModel, setDeepModel] = useState(defaults.deep_think_llm)
  const [quickModel, setQuickModel] = useState(defaults.quick_think_llm)
  const [backendUrl, setBackendUrl] = useState(defaults.backend_url || '')
  const [debateRounds, setDebateRounds] = useState(defaults.max_debate_rounds)
  const [riskRounds, setRiskRounds] = useState(defaults.max_risk_discuss_rounds)
  const [checkpoint, setCheckpoint] = useState(defaults.checkpoint_enabled)
  const [selected, setSelected] = useState({
    market: true,
    social: true,
    news: true,
    fundamentals: true,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const [models, setModels] = useState({ deep: [], quick: [], source: null, error: null })
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    api.settings().then((s) => setProviders(s.providers)).catch(() => setProviders([]))
  }, [])

  const loadModels = useCallback(() => {
    setModelsLoading(true)
    api
      .models(provider, backendUrl)
      .then(setModels)
      .catch((err) =>
        setModels({ deep: [], quick: [], source: null, error: err.detail || err.message })
      )
      .finally(() => setModelsLoading(false))
  }, [provider, backendUrl])

  // Debounced: backendUrl is a text field, so this fires while typing.
  useEffect(() => {
    const id = setTimeout(loadModels, 400)
    return () => clearTimeout(id)
  }, [loadModels])

  const assetType = detectAssetType(ticker)

  // Crypto has no fundamentals data, matching filter_analysts_for_asset_type.
  useEffect(() => {
    if (assetType === 'crypto') {
      setSelected((prev) => ({ ...prev, fundamentals: false }))
    }
  }, [assetType])

  const chosenAnalysts = useMemo(
    () => analystOptions.map((a) => a.key).filter((k) => selected[k]),
    [analystOptions, selected]
  )

  const turns =
    chosenAnalysts.length + 2 * debateRounds + 1 + 1 + 3 * riskRounds + 1

  const configPreview = JSON.stringify(
    {
      ticker: (ticker || '').toUpperCase(),
      trade_date: tradeDate,
      asset_type: assetType,
      llm_provider: provider,
      deep_think_llm: deepModel,
      quick_think_llm: quickModel,
      backend_url: backendUrl || null,
      max_debate_rounds: debateRounds,
      max_risk_discuss_rounds: riskRounds,
      checkpoint_enabled: checkpoint,
      output_language: defaults.output_language,
      data_vendors: defaults.data_vendors,
      selected_analysts: chosenAnalysts,
    },
    null,
    2
  )

  async function launch() {
    setError(null)
    setSubmitting(true)
    try {
      await start({
        ticker: (ticker || '').toUpperCase(),
        trade_date: tradeDate,
        asset_type: assetType,
        analysts: chosenAnalysts,
        llm_provider: provider,
        deep_think_llm: deepModel,
        quick_think_llm: quickModel,
        backend_url: backendUrl || null,
        max_debate_rounds: debateRounds,
        max_risk_discuss_rounds: riskRounds,
        checkpoint_enabled: checkpoint,
      })
      goto('run')
    } catch (err) {
      setError(err.detail || err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const canLaunch = chosenAnalysts.length > 0 && ticker.trim() && tradeDate && !submitting

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 40px' }}>
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', maxWidth: 1280 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel
            title="Instrument"
            bodyStyle={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}
          >
            <Field label="TICKER" hint={`${assetType} · benchmark auto-resolved`}>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                style={inputStyle}
              />
            </Field>
            <Field label="ANALYSIS DATE" hint="Pins the price + indicator window">
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="BENCHMARK" hint="Auto-resolved from suffix · used for alpha">
              <div style={readonlyStyle}>{resolveBenchmark(ticker)}</div>
            </Field>
          </Panel>

          <Panel
            title="Analyst team"
            right={
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t6 }}>
                {chosenAnalysts.length} of {analystOptions.length} selected
              </span>
            }
            bodyStyle={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
          >
            {analystOptions.map((a) => {
              const on = selected[a.key]
              const disabled = assetType === 'crypto' && a.key === 'fundamentals'
              return (
                <button
                  key={a.key}
                  disabled={disabled}
                  onClick={() => setSelected((p) => ({ ...p, [a.key]: !p[a.key] }))}
                  title={disabled ? 'No fundamentals data for crypto instruments' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 11,
                    padding: '12px 13px',
                    borderRadius: 6,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    opacity: disabled ? 0.45 : 1,
                    border: `1px solid ${on ? C.greenBorder : C.border2}`,
                    background: on ? C.greenPanel : C.panelDeep,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      flex: 'none',
                      marginTop: 1,
                      border: `1px solid ${on ? C.green : C.border3}`,
                      background: on ? C.green : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: C.greenFg,
                      fontWeight: 700,
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: on ? C.text : C.t3,
                      }}
                    >
                      {a.label}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11,
                        color: C.t5,
                        marginTop: 3,
                        lineHeight: 1.45,
                      }}
                    >
                      {a.desc}
                    </span>
                  </span>
                </button>
              )
            })}
          </Panel>

          <Panel
            title="Intelligence engine"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 9999,
                    background: providerOk(providers, provider) ? C.green : C.amber,
                  }}
                />
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.t4 }}>
                  {providerOk(providers, provider) ? 'key detected' : 'no key required / not set'}
                </span>
              </div>
            }
            bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {providers.map((p) => {
                const on = provider === p.provider
                return (
                  <button
                    key={p.provider}
                    onClick={() => setProvider(p.provider)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                      padding: 13,
                      borderRadius: 6,
                      cursor: 'pointer',
                      textAlign: 'left',
                      border: `1px solid ${on ? C.selBorder : C.border2}`,
                      background: on ? C.panelHi : C.panelDeep,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 9999,
                          border: `1px solid ${on ? C.green : C.border3}`,
                          background: on ? C.green : 'transparent',
                          flex: 'none',
                        }}
                      />
                      <span
                        style={{ fontSize: 12.5, fontWeight: 600, color: on ? C.text : C.t3 }}
                      >
                        {p.k}
                      </span>
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: p.ok ? C.t5 : C.t7,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.env}
                    </span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ModelPicker
                label="DEEP THINK LLM"
                hint="Research Manager · Portfolio Manager"
                value={deepModel}
                onChange={setDeepModel}
                options={models.deep}
              />
              <ModelPicker
                label="QUICK THINK LLM"
                hint="Analysts · researchers · trader"
                value={quickModel}
                onChange={setQuickModel}
                options={models.quick}
              />
            </div>

            <ModelSourceLine
              models={models}
              loading={modelsLoading}
              onRefresh={loadModels}
            />

            <Field label="BACKEND URL" hint="Leave empty to use the provider default">
              <input
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="https://host:port/v1"
                style={inputStyle}
              />
            </Field>
          </Panel>

          <Panel title="Debate depth & persistence" bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <RoundControl
              label="Max debate rounds"
              hint="Bull ↔ bear back-and-forth"
              value={debateRounds}
              onChange={setDebateRounds}
              derived={`${2 * debateRounds} turns`}
            />
            <RoundControl
              label="Max risk discuss rounds"
              hint="Aggressive ↔ conservative ↔ neutral"
              value={riskRounds}
              onChange={setRiskRounds}
              derived={`${3 * riskRounds} turns`}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                paddingTop: 14,
                borderTop: `1px solid ${C.border}`,
              }}
            >
              <div style={{ width: 210, flex: 'none' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: C.text }}>
                  Checkpoint resume
                </div>
                <div style={{ fontSize: 10.5, color: C.t5, marginTop: 2 }}>
                  SQLite state after each node
                </div>
              </div>
              <button
                onClick={() => setCheckpoint((v) => !v)}
                style={{
                  width: 42,
                  height: 23,
                  borderRadius: 9999,
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  background: checkpoint ? C.green : C.border2,
                  justifyContent: checkpoint ? 'flex-end' : 'flex-start',
                }}
              >
                <span style={{ width: 19, height: 19, borderRadius: 9999, background: C.text, display: 'block' }} />
              </button>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.t6, wordBreak: 'break-all' }}>
                {checkpoint
                  ? `${defaults.data_cache_dir}/checkpoints/${(ticker || '').toUpperCase()}.db`
                  : 'disabled'}
              </div>
            </div>
          </Panel>
        </div>

        <div
          style={{
            width: 352,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            position: 'sticky',
            top: 0,
          }}
        >
          <div
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
                padding: '12px 15px',
                borderBottom: `1px solid ${C.border2}`,
                background: C.panelHi,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>Run config</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.t6, marginLeft: 'auto' }}>
                DEFAULT_CONFIG
              </span>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 15,
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: 1.7,
                color: '#8fa6c0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 340,
                overflowY: 'auto',
              }}
            >
              {configPreview}
            </pre>
          </div>

          <div
            style={{
              border: `1px solid ${C.border2}`,
              borderRadius: 8,
              background: C.panel,
              padding: 15,
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
            }}
          >
            <L9>ESTIMATE</L9>
            <Estimate k="Agent turns" v={String(turns)} />
            <Estimate k="Analysts" v={String(chosenAnalysts.length)} />
            <Estimate k="Debate / risk turns" v={`${2 * debateRounds} / ${3 * riskRounds}`} />
          </div>

          {error && <Notice tone="warn" title="Could not start">{error}</Notice>}

          <Btn onClick={launch} disabled={!canLaunch} style={{ padding: 13, fontSize: 13.5 }}>
            {submitting ? 'Starting…' : 'Initialize agent run'}
          </Btn>
          <div style={{ fontSize: 11, lineHeight: 1.6, color: C.t6, textWrap: 'pretty' }}>
            Research scaffold. LLM output varies between runs on the same ticker and date; not
            investment advice.
          </div>
        </div>
      </div>
    </div>
  )
}

function providerOk(providers, key) {
  return providers.find((p) => p.provider === key)?.ok ?? false
}

/** Where the model list came from, and a way to re-query it. */
function ModelSourceLine({ models, loading, onRefresh }) {
  const count = models.deep?.length ?? 0
  let text
  if (loading) text = 'querying endpoint…'
  else if (models.error) text = models.error
  else if (models.source === 'live') text = `${count} models · ${models.endpoint}`
  else if (models.source === 'catalog') text = `${count} models · shared catalog`
  else text = 'no model list for this provider — type an id'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        paddingTop: 12,
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          flex: 'none',
          background: models.error ? C.red : models.source === 'live' ? C.green : C.t8,
        }}
      />
      <span
        style={{
          flex: 1,
          fontFamily: MONO,
          fontSize: 10.5,
          color: models.error ? C.red : C.t6,
          wordBreak: 'break-all',
        }}
      >
        {text}
      </span>
      <button
        className="link-hover"
        onClick={onRefresh}
        disabled={loading}
        style={{ fontSize: 11.5, color: C.link, cursor: loading ? 'default' : 'pointer' }}
      >
        Refresh
      </button>
    </div>
  )
}

function Estimate({ k, v }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12.5, color: C.t2 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text }}>{v}</span>
    </div>
  )
}

function RoundControl({ label, hint, value, onChange, derived }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 210, flex: 'none' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: C.text }}>{label}</div>
        <div style={{ fontSize: 10.5, color: C.t5, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: 34,
              height: 30,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 12,
              border: `1px solid ${value === n ? C.green : C.border3}`,
              background: value === n ? C.greenBg : C.inputBg,
              color: value === n ? C.green : C.t3,
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div style={{ ...label95, fontFamily: MONO, fontWeight: 400, color: C.t6 }}>{derived}</div>
    </div>
  )
}
