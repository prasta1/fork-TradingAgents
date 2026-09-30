---
name: PitPal Console
description: Night-desk console for a local multi-agent trading framework and the owner's live brokerage accounts.
colors:
  harbor-night: "#051424"
  sidebar-abyss: "#010f1f"
  panel-navy: "#0d1c2d"
  panel-raised: "#122131"
  panel-deep: "#081726"
  hairline: "#14243a"
  divider: "#1c2b3c"
  input-stroke: "#2f4157"
  frost-text: "#d4e4fa"
  mist-text: "#b0c3da"
  slate-text: "#93a4bb"
  dusk-text: "#7d90a8"
  fog-text: "#6d819a"
  dim-label: "#5c728c"
  signal-mint: "#4edea3"
  signal-mint-hover: "#6ffbbe"
  mint-ink: "#003824"
  mint-well: "#00311f"
  mint-panel: "#0e2320"
  mint-stroke: "#2f5a4a"
  pale-coral: "#ffb3ad"
  coral-ink: "#3a0f0c"
  coral-well: "#390003"
  coral-panel: "#1e1315"
  coral-stroke: "#3a2124"
  ledger-amber: "#e8c07a"
  amber-dim: "#a8813f"
  quiet-link: "#bec6e0"
  selection-stroke: "#4a6b86"
  selection-fill: "#16283b"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  display-figure:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
  prose:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.68
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    letterSpacing: "0.09em"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "9999px"
spacing:
  row: "9px"
  field: "12px"
  stack: "15px"
  panel: "18px"
  section: "20px"
  page: "24px 26px"
components:
  button-primary:
    backgroundColor: "{colors.signal-mint}"
    textColor: "{colors.mint-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-mint-hover}"
  button-ghost:
    textColor: "{colors.quiet-link}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-ghost-hover:
    backgroundColor: "{colors.panel-raised}"
  button-danger:
    textColor: "{colors.pale-coral}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  panel:
    backgroundColor: "{colors.panel-navy}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input:
    backgroundColor: "{colors.sidebar-abyss}"
    textColor: "{colors.frost-text}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
  chip:
    backgroundColor: "{colors.panel-raised}"
    rounded: "{rounded.sm}"
    padding: "6px 11px"
  nav-item:
    textColor: "{colors.dusk-text}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.frost-text}"
---

<!-- REFERENCE SNAPSHOT (2026-09-30): the pre-redesign baseline, recorded before direction A ("Two materials") is explored. Use it to understand and match the incumbent console; do not extend it as the target world. Replace this file when a redesign commits a new world. -->

# Design System: PitPal Console

## Overview

**Creative North Star: "The Night Desk"**

A trader's desk after hours. Deep harbor navy fills the room, one mint signal light marks whatever is live, active or up, and everything else stays quiet. The console is calm and restrained: flat panels separated by hairlines, small type, and numbers set in a monospace so they read like instruments rather than prose.

Density beats comfort. Body text sits at 12.5px, labels at 9px uppercase, and rows are padded tightly so a portfolio, a debate and an order ticket can share one screen. Colour is spent almost entirely on meaning: mint for buy, gain and "live"; coral for sell, loss and danger; amber for stale or illustrative data. There is no decoration, no shadow and no gradient; depth comes from stepping the navy lighter.

The system's known weakness is the same quietness taken too far: most of the text ramp is too faint to read comfortably (see Do's and Don'ts), and the single mint accent carries so many meanings that "the agent recommends" and "your account is up" look identical.

**Key Characteristics:**
- Dark, cool navy surfaces stepped by lightness, never by shadow
- One accent (signal mint) carrying buy, gain, primary action and live state
- IBM Plex Sans for interface, JetBrains Mono for every number, id and timestamp
- 1px hairline borders on every container
- Tiny uppercase bold labels as the section and field headers
- Compact, desk-first layout: fixed sidebar, fixed-width right rails

## Colors

A near-monochrome cool navy world with one mint signal, one coral counter-signal and a muted amber caution.

### Primary
- **Signal Mint**: the only accent. Primary buttons, the active nav dot, "live" badges, Buy/Overweight ratings, positive P/L and the bid price. Pairs with **Mint Ink** for text on mint, **Mint Well** for chip backgrounds and **Mint Panel** / **Mint Stroke** for the agent-proposal card.

### Secondary
- **Pale Coral**: sell, loss, stop price, danger buttons and error notices. Deliberately soft rather than alarm-red so losses read without shouting. Pairs with **Coral Ink** (text on coral), **Coral Well**, **Coral Panel** and **Coral Stroke**.

### Tertiary
- **Ledger Amber**: caution and provenance, meaning stale "as of" prices, the MOCKUP badge and the live-order confirmation border (**Amber Dim**).

### Neutral
- **Harbor Night**: the page background.
- **Sidebar Abyss**: the sidebar and every input well; the darkest surface.
- **Panel Navy**: cards and panels. **Panel Raised** marks hover, active nav and chips; **Panel Deep** sits under nested content.
- **Hairline**, **Divider**, **Input Stroke**: the three border weights, from structural to interactive.
- **Frost Text** down through **Mist**, **Slate**, **Dusk** and **Fog Text**: the readable text ramp. **Dim Label** is the lightest colour still used for labels; darker ramp steps (#4a607c, #3d5470, #2f4157, #243549) exist in code for hints, timestamps and dots.
- **Quiet Link**: ghost buttons, links and the Hold rating.
- **Selection Stroke** / **Selection Fill**: selected option cards on Deploy.

### Named Rules
**The One Signal Rule.** Mint is the only colour that means "go". Nothing decorative is ever mint.

**The Stepped Navy Rule.** Surfaces differ by lightness within one navy hue. A new surface picks an existing step; it never introduces a new hue.

## Typography

**Body Font:** IBM Plex Sans (with system-ui, -apple-system, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, monospace)

**Character:** Plex is a neutral, engineered sans that stays legible at small sizes; JetBrains Mono gives every figure a fixed width so columns of prices and percentages align. About half the text on a screen is mono.

### Hierarchy
- **Display** (700, 34px, line-height 1, -0.02em): the ticker in Research and the rating word in the proposal card (30–34px).
- **Display Figure** (mono 700, 42px): the net-worth total on the dashboard.
- **Title** (600, 14px): panel headers.
- **Prose** (400, 13.5px, line-height 1.68, max 720px): agent reports rendered from markdown.
- **Body** (400, 12.5px, line-height 1.55): interface copy, table cells, notes.
- **Data** (mono 400, 11.5–13px): prices, quantities, ids, timestamps, inputs.
- **Label** (700, 9–9.5px, 0.07–0.09em tracking, uppercase): section headers, field labels, stat captions.

### Named Rules
**The Mono Figures Rule.** Every number a user compares (price, quantity, percentage, date, id) is set in JetBrains Mono. Words are Plex.

## Layout

A desktop-first shell: a fixed **214px sidebar** (brand, grouped navigation, active model), a **54px header** (screen title with a mono subtitle, ticker and date pills, "New run"), and a scrolling content area padded 24px top and 26px sides. Screens compose as a flexible main column plus a **fixed right rail of 300–352px** (order entry, watchlist, decision card). Inside panels, content uses flex rows with 12–20px gaps and CSS grids of 4–6 equal columns for stat rows.

Spacing clusters around 9px (row padding), 12px (field gaps), 15px (form stacks), 18px (panel padding) and 20px (column gaps). There are no responsive breakpoints; the layout assumes a laptop-or-wider window and does not adapt to phones.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth is tonal: Sidebar Abyss sits below Harbor Night, which sits below Panel Navy, which sits below Panel Raised, and every container also carries a 1px border. Interaction lifts an element one step (hover and active nav move to Panel Raised) rather than adding elevation.

### Named Rules
**The No-Shadow Rule.** Depth is a lighter navy and a hairline, never a drop shadow or glow.

## Shapes

Small, consistent, slightly softened corners: 4px for buttons, inputs, pills and nav items; 8px for panels and cards; 3px for inline chips and code; 5–6px for selectable option cards; full pills only for status dots and toggles. Borders are always 1px solid. Nothing is clipped into non-rectangular shapes.

## Components

### Buttons
Calm and restrained: flat, no border on the primary, weight 600.
- **Shape:** gently rounded (4px).
- **Primary:** Signal Mint fill with Mint Ink text, 9px × 16px, 12.5px. Hover brightens to Signal Mint Hover.
- **Ghost:** 1px Input Stroke outline, Quiet Link text, 8px × 14px, weight 500. Hover fills Panel Raised.
- **Danger:** 1px Coral Stroke outline with Pale Coral text; used for cancelling runs and orders.
- **Disabled:** Divider fill with Dim Label text and a not-allowed cursor.

### Chips
- **Style:** Panel Raised fill, 1px Divider border, 4px radius, a 9.5px bold uppercase key followed by a 12px mono value.
- **Rating chips:** the rating colour on its well (Mint on Mint Well, Coral on Coral Well, Quiet Link on Divider for Hold).

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Panel Navy; the agent proposal uses Mint Panel with Mint Stroke.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Divider; the header row is separated by another 1px Divider.
- **Internal Padding:** 18px; header 14px × 18px with a 14px/600 title and an optional mono meta line.

### Inputs / Fields
- **Style:** Sidebar Abyss well, 1px Input Stroke, 4px radius, 9px × 11px, 13px mono text.
- **Label:** a 9.5px bold uppercase label 7px above the input; optional 10.5px hint below.
- **Focus:** none; the browser outline is removed and nothing replaces it (a known gap).

### Navigation
- **Style:** grouped under 9px uppercase group labels (Portfolio, Research, Agents, Build). Each item is a 12.5px row with a 5px status dot.
- **Default:** Dusk Text, weight 500, dot in the darkest ramp step.
- **Hover:** Panel Navy fill.
- **Active:** Panel Raised fill, Frost Text at weight 600, dot turns Signal Mint. A running analysis adds a pulsing mono "live" badge.

### Pipeline Node (signature)
The Live run graph: one column per stage of the agent pipeline, each node a small bordered button whose status dot and elapsed timer move from waiting (dark) to running (pulsing mint) to done. Selecting a node stops auto-follow and shows its report in the prose style.

## Do's and Don'ts

### Do:
- **Do** set every comparable number in JetBrains Mono.
- **Do** keep Signal Mint for meaning (buy, gain, live, primary action) and nothing else.
- **Do** separate containers with 1px borders and a lighter navy step, never a shadow.
- **Do** mark stale or illustrative data in Ledger Amber, as the "as of" prices and the MOCKUP badge already do.

### Don't:
- **Don't** set readable text darker than Fog Text (#6d819a). Measured against the panels, Dim Label is about 3.5:1 and the darker steps fall to 1.5–2.9:1, all below the 4.5:1 needed for body text.
- **Don't** remove input focus outlines without a replacement; the current `outline: none` leaves keyboard users with no focus indicator.
- **Don't** add new font sizes; about 20 already exist between 9px and 42px.
- **Don't** add new corner radii beyond 3, 4, 6 and 8px and the pill.
