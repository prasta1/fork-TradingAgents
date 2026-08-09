import { useState } from 'react'
import { C, MONO, label95 } from '../theme.js'
import { inputStyle } from './ui.jsx'

const CUSTOM = '__custom__'

/**
 * Model selector backed by whatever the server could discover.
 *
 * Resident models are grouped first: on a llama-swap node a loaded model
 * answers immediately while an unloaded one has to be swapped in, which is a
 * 30-60s difference at the start of a run.
 *
 * Free text is always reachable — neither the live endpoint nor the catalog is
 * guaranteed to list everything.
 */
export default function ModelPicker({ label, hint, value, onChange, options, disabled }) {
  const known = options.some((o) => o.value === value)
  // Explicit user choice wins; otherwise show the list as soon as there is one
  // that contains the current value. Options arrive asynchronously, so this has
  // to stay derived — latching it on first render would freeze the picker into
  // whatever state it had before the fetch resolved.
  const [mode, setMode] = useState('auto')
  const showList = mode === 'list' || (mode === 'auto' && options.length > 0 && known)

  const loaded = options.filter((o) => o.state === 'loaded')
  const rest = options.filter((o) => o.state !== 'loaded')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={label95}>{label}</label>

      {!showList ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="model id"
            style={inputStyle}
          />
          {options.length > 0 && (
            <button
              onClick={() => setMode('list')}
              title="Back to the discovered list"
              style={{
                padding: '0 11px',
                borderRadius: 4,
                border: `1px solid ${C.border3}`,
                color: C.t3,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              List
            </button>
          )}
        </div>
      ) : (
        <select
          value={known ? value : ''}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setMode('custom')
              return
            }
            setMode('auto')
            onChange(e.target.value)
          }}
          style={{ ...inputStyle, cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          {!known && <option value="">select a model…</option>}
          {loaded.length > 0 && (
            <optgroup label="Loaded — starts immediately">
              {loaded.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {rest.length > 0 && (
            <optgroup label={loaded.length ? 'Available — swaps in on first call' : 'Available'}>
              {rest.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value={CUSTOM}>Custom model id…</option>
        </select>
      )}

      {hint && <span style={{ fontSize: 10.5, color: C.t6 }}>{hint}</span>}

      {showList && known && <ModelState state={options.find((o) => o.value === value)?.state} />}
    </div>
  )
}

function ModelState({ state }) {
  if (!state) return null
  const loaded = state === 'loaded'
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: MONO,
        fontSize: 10,
        color: loaded ? C.green : C.t6,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 9999,
          background: loaded ? C.green : C.t8,
        }}
      />
      {loaded ? 'resident' : 'not loaded — first call swaps it in'}
    </span>
  )
}
