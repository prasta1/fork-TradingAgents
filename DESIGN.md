---
name: PitPal Console
description: Forecast & Observation console for a local multi-agent trading framework and the owner's live brokerage accounts, in Catppuccin Mocha.
colors:
  crust: "#11111b"
  mantle: "#181825"
  base: "#1e1e2e"
  surface0: "#313244"
  surface1: "#45475a"
  surface2: "#585b70"
  overlay0: "#6c7086"
  overlay1: "#7f849c"
  overlay2: "#9399b2"
  subtext0: "#a6adc8"
  subtext1: "#bac2de"
  text: "#cdd6f4"
  mauve: "#cba6f7"
  mauve-wash: "#2b2540"
  blue: "#89b4fa"
  lavender: "#b4befe"
  green: "#a6e3a1"
  green-wash: "#2a3a31"
  red: "#f38ba8"
  red-wash: "#29202c"
  red-stroke: "#5a3445"
  yellow: "#f9e2af"
  peach: "#fab387"
typography:
  title:
    fontFamily: "ui-sans-serif, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
  heading:
    fontFamily: "ui-sans-serif, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 650
  body:
    fontFamily: "ui-sans-serif, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    fontFeature: "tnum"
  figure:
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "15px"
    fontWeight: 600
  stamp:
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
  label:
    fontFamily: "ui-sans-serif, -apple-system, SF Pro Text, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    letterSpacing: "0.09em"
rounded:
  sm: "4px"
  md: "5px"
  lg: "8px"
  pill: "9999px"
spacing:
  row: "7px"
  stack: "13px"
  panel: "16px"
  column: "18px"
  page: "22px 24px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.crust}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-buy:
    backgroundColor: "{colors.green}"
    textColor: "{colors.crust}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  button-sell:
    backgroundColor: "{colors.red}"
    textColor: "{colors.crust}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  button-ghost:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-forecast:
    textColor: "{colors.mauve}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  segment-selected:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.crust}"
    rounded: "{rounded.md}"
    height: "32px"
  input:
    backgroundColor: "{colors.crust}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
  observation-panel:
    backgroundColor: "{colors.base}"
    rounded: "{rounded.lg}"
    padding: "16px"
  forecast-panel:
    backgroundColor: "{colors.base}"
    textColor: "{colors.mauve}"
    rounded: "{rounded.lg}"
    padding: "16px"
  nav-item-active:
    backgroundColor: "{colors.surface0}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: PitPal Console

## Overview

**Creative North Star: "Forecast & Observation"**

Agents issue forecasts; brokers report observations. Every surface keeps the two apart the way a weather service keeps a forecast discussion apart from the recorded readings: a forecast is dashed, stamped with when it was issued and how long it is valid, and drawn in one colour that belongs to nothing else; an observation is solid, stamped with when it was observed, and drawn in plain ink. The owner trades real money here, so an agent's opinion must never be mistakable for a fact about an account.

The world is Catppuccin Mocha (pinned by the owner): a soft, low-glare dark palette built for long sessions at a desk. The console stays dense and quiet. Colour is spent on meaning, and each accent owns exactly one meaning.

Forecast logic is still being defined. Until it is, forecast surfaces show only what a run produced (rating, target, stop, horizon, size) and label themselves "work in progress"; no confidence band, probability or skill score is drawn.

**Key Characteristics:**
- Catppuccin Mocha surfaces: Mantle page, Base panels, Crust wells
- Mauve and dashed strokes mean "agent forecast", and nothing else
- Solid ink and solid borders mean "observed by the market or broker"
- Green and red mean money and order side only
- Blue means selected, focused, or a primary action that isn't money
- System faces (SF Pro, SF Mono); no web-font download

## Colors

Catppuccin Mocha, used by role rather than by mood.

### Primary
- **Mauve**: agent forecasts and agent work only. The forecast panel's dashed frame, headline and issued stamp; target and stop wherever they appear; every agent rating on every screen (`ratingStyle`); Live run's node progress and the "live" badge; the "Ref only" note on the ticket. **Mauve Wash** fills the forecast window on a chart.

### Secondary
- **Blue**: interaction and status. Selected segments, option cards and toggles (Deploy run's analysts, providers, rounds), the active account chip, the focus ring, primary buttons that don't commit money ("New run", "Initialize agent run"), links, connection dots and the active-nav dot. **Lavender** is link hover.

### Tertiary
- **Green**: gain and Buy. The Buy segment and "Confirm buy" button, positive change figures.
- **Red**: loss and Sell. The Sell segment and "Confirm sell" button, negative figures, errors and the live-money warning line (**Red Wash**, **Red Stroke** for error boxes).
- **Yellow** (with **Peach**): reserved for agent-acted advisories, when automation exists; today it marks stale or unavailable observations.

### Neutral
- **Crust**: input wells, the sidebar, and text on any filled accent.
- **Mantle**: the page.
- **Base**: panels.
- **Surface0 / Surface1**: hairlines, hover, selected nav row.
- **Overlay0**: control borders (3.4:1 on Base, enough for a control edge).
- **Text, Subtext1, Subtext0, Overlay2, Overlay1**: the text ramp, all at or above 4.4:1 on Base. **Surface2** is for dots and rules only, never text.

### Named Rules
**The One Meaning Rule.** Each accent owns one meaning: mauve forecast, blue interaction, green/red money, yellow agent-acted. An accent never appears on something outside its meaning.

**The No Money Ink On Opinions Rule.** An agent's rating, target or stop is drawn in mauve even when it says "Buy" or sits below the price. Green and red wait until money is involved.

## Typography

**Body Font:** SF Pro via `ui-sans-serif` (with -apple-system, system-ui)
**Data Font:** SF Mono via `ui-monospace` (with Menlo)

**Character:** The platform's own faces, chosen because the console runs on one Mac and must not depend on a network font. Tabular numerals are on globally so prices align in columns.

### Hierarchy
- **Title** (650, 15px): forecast headline.
- **Heading** (650, 13–14px): panel and ticket headings.
- **Body** (400, 12.5px, 1.55): interface copy and notes.
- **Figure** (mono 600, 15px): bid, ask, last.
- **Data** (mono 400, 12.5px): prices, quantities, ids, inputs.
- **Stamp** (mono 400, 11.5px): "Issued HH:MM by run_…", "Observed HH:MM", chart annotations.
- **Label** (700, 9–9.5px, 0.07–0.09em, uppercase): legacy section labels on screens not yet redrawn.

### Named Rules
**The Stamp Rule.** Every forecast carries an issued time and validity; every observation carries an observed time. A number without a stamp is a number whose age the owner has to guess.

## Layout

Fixed 214px sidebar, 54px header, content padded 22px × 24px. The Trade desk is two flexible columns: the chart column (grows, min ~540px) and the ticket (380px) docked at the chart's "now" edge. Below a 1200px viewport the ticket takes the full row under the chart. Charts are responsive SVG at a 760 × 320 viewBox; the forecast window's width is scaled to the run's horizon (30 observed sessions ≈ 42 days; clamped to 50–80% of the plot).

## Elevation & Depth

Flat. No shadows. Depth is Catppuccin's own layering: Crust wells sit in Base panels on a Mantle page. Register, not height, separates things: a dashed mauve frame is a forecast, a solid Overlay0 frame is an observation or a control.

### Named Rules
**The Dashed-Is-Forecast Rule.** Dashed or dotted strokes are reserved for agent forecasts. Observed data and controls are always solid.

## Shapes

4px corners on buttons and inputs, 5px on segmented groups, 8px on panels, full pills for status dots. Borders are 1px.

## Components

### Buttons
- **Primary:** Blue fill, Crust text, 4px, 9 × 16px, 600. Hover lightens to #a8c7fb.
- **Buy / Sell commit:** Green or Red fill, Crust text; used only for confirming an order.
- **Ghost:** 1px Overlay0 outline, Text label; "Review order" and "Edit". Dims to 45% when disabled.
- **Forecast:** 1px dashed Mauve outline, Mauve label; "Load into ticket", which fills symbol and side only.
- **Danger:** Red outline, Red label; cancelling runs and orders.

### Segmented control
A 1px Overlay0 group, 32px tall (38px for Buy/Sell), one pressed segment. Pressed is Blue with Crust text; the Buy/Sell group fills Green or Red instead. Buttons carry `aria-pressed`.

### Inputs / Fields
Crust well, 1px Overlay0, 4px, SF Mono 13px. Focus shows the global 2px Blue ring. An invalid price turns the border Red and shows an inline alert.

### Forecast panel (signature)
Dashed Mauve frame on Base. Headline "{TICKER} forecast · {rating} · target · stop" in Mauve, stamp line below, then the price chart: solid observed closes to a vertical "now" rule, a Mauve Wash window to its right holding the target (dashed) and stop (dotted) as Mauve reference lines, "valid to {date}" at its edge, and "forecast view · work in progress" until forecast logic lands.

### Observation panel
Solid Overlay0 frame on Base: the ticket, top of book ("Observed HH:MM"), the observed-only chart, and the submitted order "reported by {broker}".

### Navigation
Grouped sidebar rows with a 5px dot. Active row: Surface0 fill, Text, Blue dot. A running analysis shows a pulsing Mauve "live" badge.

## Do's and Don'ts

### Do:
- **Do** draw anything an agent produced in Mauve with a dashed or dotted stroke, stamped with its issued time.
- **Do** draw anything the market or broker reported solid, stamped "Observed HH:MM".
- **Do** use Blue for selection, focus and non-money primary actions.
- **Do** put Crust text on every filled accent.
- **Do** say "unavailable" when an observation fails; never show it as empty.

### Don't:
- **Don't** colour an agent rating, target or stop green or red.
- **Don't** extend forecast lines back over observed prices; they start at "now".
- **Don't** draw confidence bands, probabilities or skill scores until the forecast logic is defined.
- **Don't** use green on a control that doesn't commit a buy.
- **Don't** use Surface2 or darker for text.
- **Don't** add a light theme or paper textures.
