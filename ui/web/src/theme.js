// Design tokens.
// Every screen styles inline from these, matching how the design was authored.

// Catppuccin Mocha (https://github.com/catppuccin/catppuccin). Keys keep their
// old names so every screen picks up the palette; see DESIGN.md for the roles.
// Mauve belongs only to agent forecasts; green/red only to money and side.
export const C = {
  // surfaces
  bg: '#181825', // mantle
  sidebar: '#11111b', // crust
  panel: '#1e1e2e', // base
  panelAlt: '#1e1e2e',
  panelDeep: '#181825',
  panelHi: '#313244', // surface0
  inputBg: '#11111b',

  // borders
  border: '#313244',
  border2: '#313244',
  border3: '#6c7086', // overlay0: >=3:1 against inputs, as a control edge needs

  // text ramp, lightest to darkest. t1-t7 all pass 4.4:1 or better on base;
  // t8/t9 are for dots and rules only, never text.
  text: '#cdd6f4',
  t1: '#bac2de',
  t2: '#a6adc8',
  t3: '#9399b2',
  t4: '#9399b2',
  t5: '#9399b2',
  t6: '#7f849c',
  t7: '#7f849c',
  t8: '#6c7086',
  t9: '#585b70',

  // text on any filled accent (buttons, selected segments)
  onFill: '#11111b',

  // money: gain / buy
  green: '#a6e3a1',
  greenHover: '#c0ecbc',
  greenFg: '#11111b',
  greenBg: '#2a3a31',
  greenDeep: '#1c2a24',
  greenBorder: '#4a6a55',
  greenPanel: '#222d2b',
  bullPanel: '#212b2a',
  bullBorder: '#3b5446',

  // money: loss / sell
  red: '#f38ba8',
  redHover: '#f6a8bd',
  redBg: '#3b2635',
  redPanel: '#29202c',
  redBorder: '#5a3445',

  // caution, and later agent-acted advisories
  amber: '#f9e2af', // yellow
  amberDim: '#fab387', // peach
  amberBg: '#2e2a2c',

  // agent forecasts only
  mauve: '#cba6f7',
  mauveBg: '#2b2540',
  mauveBand: '#332c47',

  // selection, focus, links
  blue: '#89b4fa',
  selBorder: '#89b4fa',
  selBg: '#29304a',
  link: '#89b4fa',
}

// System faces: SF on the Mac this runs on, and no font download (local-first).
export const SANS = "ui-sans-serif, -apple-system, 'SF Pro Text', system-ui, sans-serif"
export const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace"

// A rating is an agent's opinion, never money, so every rating is mauve
// regardless of direction; the word itself says Buy or Sell (DESIGN.md:
// "No Money Ink On Opinions"). Kept as a function so call sites don't change.
export function ratingStyle() {
  return { c: C.mauve, bg: C.mauveBg }
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
  color: C.t5,
}

export const label95 = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.07em',
  color: C.t5,
}
