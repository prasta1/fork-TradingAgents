// Design tokens lifted from the TradingAgents Console design.
// Every screen styles inline from these, matching how the design was authored.

export const C = {
  // surfaces
  bg: '#051424',
  sidebar: '#010f1f',
  panel: '#0d1c2d',
  panelAlt: '#0a1a2b',
  panelDeep: '#081726',
  panelHi: '#122131',
  inputBg: '#010f1f',

  // borders
  border: '#14243a',
  border2: '#1c2b3c',
  border3: '#2f4157',

  // text ramp, lightest to darkest
  text: '#d4e4fa',
  t1: '#b0c3da',
  t2: '#93a4bb',
  t3: '#7d90a8',
  t4: '#6d819a',
  t5: '#5c728c',
  t6: '#4a607c',
  t7: '#3d5470',
  t8: '#2f4157',
  t9: '#243549',

  // accents
  green: '#4edea3',
  greenHover: '#6ffbbe',
  greenFg: '#003824',
  greenBg: '#00311f',
  greenDeep: '#00170e',
  greenBorder: '#2f5a4a',
  greenPanel: '#0e2320',
  bullPanel: '#0b1f1b',
  bullBorder: '#1f3a2e',

  red: '#ffb3ad',
  redBg: '#390003',
  redPanel: '#1e1315',
  redBorder: '#3a2124',

  amber: '#e8c07a',
  amberDim: '#a8813f',

  // selection
  selBorder: '#4a6b86',
  selBg: '#16283b',
  link: '#bec6e0',
}

export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"

// Rating -> colour + chip background, used everywhere a rating is shown.
export function ratingStyle(rating) {
  switch ((rating || '').toLowerCase()) {
    case 'buy':
    case 'overweight':
      return { c: C.green, bg: C.greenBg }
    case 'sell':
    case 'underweight':
      return { c: C.red, bg: C.redBg }
    default:
      return { c: C.link, bg: C.border2 }
  }
}

// Green for gains, red for losses, muted when there is nothing to say.
export function pnlColor(value) {
  if (value === null || value === undefined) return C.t5
  return value >= 0 ? C.green : C.red
}

export const label9 = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '.09em',
  color: C.t7,
}

export const label95 = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.07em',
  color: C.t5,
}
