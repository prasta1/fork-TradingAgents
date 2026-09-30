import { C, MONO, label9, label95 } from '../theme.js'

/** Bordered card with an optional header row. */
export function Panel({ title, meta, right, children, pad = 18, bodyStyle, style }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border2}`,
        borderRadius: 8,
        background: C.panel,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || meta || right) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: `1px solid ${C.border2}`,
          }}
        >
          {title && <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>}
          {meta && (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.t6 }}>{meta}</div>
          )}
          {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
        </div>
      )}
      <div style={{ padding: pad, ...bodyStyle }}>{children}</div>
    </div>
  )
}

export const L9 = ({ children, style }) => <div style={{ ...label9, ...style }}>{children}</div>
export const L95 = ({ children, style }) => (
  <span style={{ ...label95, ...style }}>{children}</span>
)

export const Mono = ({ children, size = 12, color = C.text, style }) => (
  <span style={{ fontFamily: MONO, fontSize: size, color, ...style }}>{children}</span>
)

/** Key/value pill, as used above analyst reports. */
export function Chip({ k, v, c = C.text }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 11px',
        borderRadius: 4,
        background: C.panelHi,
        border: `1px solid ${C.border2}`,
      }}
    >
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', color: C.t5 }}>
        {k}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: c }}>{v}</span>
    </div>
  )
}

const BTN_BASE = {
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

export function Btn({ variant = 'green', onClick, disabled, children, style, title }) {
  const variants = {
    green: {
      background: disabled ? C.border2 : C.green,
      color: disabled ? C.t5 : C.greenFg,
      padding: '9px 16px',
      fontSize: 12.5,
    },
    ghost: {
      border: `1px solid ${C.border3}`,
      color: C.link,
      padding: '8px 14px',
      fontSize: 12,
      fontWeight: 500,
    },
    // Filled red for committing a sell, so it never reads as the green buy action.
    sell: {
      background: disabled ? C.border2 : C.red,
      color: disabled ? C.t5 : '#3a0f0c',
      padding: '9px 16px',
      fontSize: 12.5,
    },
    danger: {
      border: `1px solid ${C.redBorder}`,
      color: C.red,
      padding: '8px 14px',
      fontSize: 12,
      fontWeight: 500,
    },
  }
  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={disabled || !['green', 'sell'].includes(variant) ? 'btn-ghost' : `btn-${variant}`}
      style={{
        ...BTN_BASE,
        ...variants[variant],
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

/** Dashed placeholder for "nothing here yet" states. */
export function Empty({ children, pad = 46 }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.border2}`,
        borderRadius: 8,
        padding: pad,
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.t7, lineHeight: 1.8, whiteSpace: 'pre-line' }}>
        {children}
      </div>
    </div>
  )
}

/** Labelled form field with an optional hint below. */
export function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={label95}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: C.t6 }}>{hint}</span>}
    </div>
  )
}

export const inputStyle = {
  padding: '9px 11px',
  borderRadius: 4,
  background: C.inputBg,
  border: `1px solid ${C.border3}`,
  color: C.text,
  fontFamily: MONO,
  fontSize: 13,
  width: '100%',
}

export const readonlyStyle = {
  ...inputStyle,
  border: `1px solid ${C.border2}`,
  color: C.t2,
}

/** Full-screen error/notice band used when a screen cannot load. */
export function Notice({ tone = 'dim', title, children }) {
  const tones = {
    dim: { border: C.border2, bg: C.panel, color: C.t4 },
    warn: { border: C.redBorder, bg: C.redPanel, color: C.red },
  }
  const t = tones[tone]
  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        background: t.bg,
        borderRadius: 8,
        padding: 20,
        maxWidth: 680,
      }}
    >
      {title && (
        <div style={{ fontSize: 13.5, fontWeight: 600, color: t.color, marginBottom: 8 }}>
          {title}
        </div>
      )}
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.t4, textWrap: 'pretty' }}>
        {children}
      </div>
    </div>
  )
}

/** Badge marking a screen that is design-only, with nothing wired behind it. */
export function MockupBadge({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        borderRadius: 4,
        border: `1px solid ${C.amberDim}`,
        background: 'rgba(168,129,63,0.09)',
        marginBottom: 18,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '.08em',
          color: C.amber,
        }}
      >
        MOCKUP
      </span>
      <span style={{ fontSize: 12, color: C.t4, lineHeight: 1.5, textWrap: 'pretty' }}>
        {children}
      </span>
    </div>
  )
}
