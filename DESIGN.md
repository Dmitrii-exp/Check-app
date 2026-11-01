---
version: alpha
name: Check App
description: A Russian equipment-maintenance work journal for managers and technicians
colors:
  primary: "#5b50f5"
  canvas: "#090e19"
  surface: "#131e2d"
  ink: "#f6f8ff"
  muted: "#a8b5c8"
typography:
  sans:
    fontFamily: "Inter, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  control: "8px"
  card: "12px"
omitted:
  - section: spacing
    reason: Existing Tailwind spacing remains canonical; visual refinements use its 4px grid
  - section: components
    reason: Existing HTML and CSS owners are documented below without generating new components
---

# Check App design context

## Overview

North star: the equipment maintenance log used on a workshop shift. Precise,
restrained and readable with long Russian names on a phone. Hybrid register:
`/` explains the product, `/app/` supports work, `/docs/legal/` supports reading.
Keep the existing equipment logo, Inter/system font, violet primary actions,
dark default and independent light theme. Do not add decorative imagery, fake
claims, onboarding changes, decorative charts. The approved mobile navigation is described below.

Direction (unslop, 2026-11-01): product — equipment, maintenance and photo reports;
character — calm, exact, practical; world — service logs and inspection sheets;
moment — the actual maintenance list in the landing preview; signature — a thin
rule organising the preview counts and rows, with semantic task statuses.

## Colors

Runtime remains canonical (Model B): `css/styles.css` -> semantic Tailwind
adapters in `tailwind.config.js` -> existing HTML/template consumers. Dark/light
palette values are retained. Landing CSS lives in index.html because the REG.RU
packaging copies this page verbatim. Its canvas, surface, muted text and primary
values match the runtime; verify these five values together when changing them.
Static legal pages keep the same palette but do not mount application behavior.
Status colors keep their meaning; the equipment count uses primary text instead
of a fourth competing accent. Primary buttons must maintain 4.5:1 text contrast.

## Typography

Interface: existing Inter at 400/500/600 with system Cyrillic fallbacks. Landing
and legal: system sans, no new external font request. Data: tabular numerals;
monospace only in landing preview counts and ordered setup steps. Normal tracking
for small text, up to -0.025em for the large headline. No all-caps success heading.

## Layout

Retain all sections, destinations, role visibility and native form behavior.
Desktop keeps its top navigation. Mobile uses the approved bottom navigation
and More dialog described below; this task does not introduce a sidebar.
App content remains 1024px maximum, with 16px mobile gutters. Landing max is
1200px, with 20px phone gutters. Landing tariff grid is three columns on desktop,
two at 800px and one at 560px: readable content takes priority over fitting all
plans into one phone row. Short viewports scroll naturally, including auth.

## Elevation & Depth

Flat surfaces with quiet borders. No colored gradients, rotated preview,
colored glow, large static-content shadows, hover movement or marketing blur.
Modal backdrop and semantic focus rings remain. Reduced motion disables
animations/transitions; working progress indicators are otherwise retained.

## Shapes

Shared runtime tokens --check-radius-control (8px) and --check-radius-card (12px)
own control/card geometry. The app's existing utility classes adapt to these
values in its shared stylesheet. Native critical dialogs keep their established
16px shape and behavior. Preserve all hidden/disabled state selectors.

## Components

Forms/auth: .auth-*; team: .team-*; dialog: .check-danger-dialog; navigation:
existing .nav-btn and handlers; theme: existing js/theme.js; scrolling: global
styles.css standards properties plus WebKit fallback and forced-colors path.
Native selects and date controls remain platform-owned; no new picker library.
The calendar template changes only its decorative emoji label. All functions,
queries, event handlers, business copy and request logic remain identical.

## Do's and Don'ts

Keep working logic untouched. Preserve logo, legal terms, SEO metadata, prices,
limits, section order, role checks, Auth, payment and photo flows. Do not convert
semantic warning/success/danger colors into decorative brand accents. Do not
claim a full WCAG audit or live production transaction test from mocked checks.


## Product and audience
Russian-language equipment-maintenance application for company owners, department
leads and employees. The existing cabinet is the reference for this scoped change.

## Visual intent
Preserve the compact dark workspace, Inter/system typography, rounded cards and
clear Russian action labels. Destructive company deletion is visually separated
from account security, updates and subscription actions. The 2026-11-01 visual refinement is authorized; working behavior remains unchanged.

## Runtime ownership
`css/styles.css` owns shared `--check-*` colors, typography, focus and responsive
rules; `tailwind.config.js` owns the existing primary palette. Reuse the cabinet's
surface, border, spacing and text treatments. The deletion variant adds rose
danger styling in `css/styles.css` without changing the existing primary palette.

## Confirmation variant
The company-deletion dialog uses the native HTML dialog element, styled by the
application. The browser supplies modal focus containment and background isolation;
the application owns content, typed validation, busy/error state and recovery.
Initial focus goes to Cancel. Escape/cancel is blocked only while a request runs.
The visible company name is inserted as text. Buttons are at least 48px tall.

## Scope
Existing unrelated modal and native confirmation behavior is not migrated by this
change. The deletion feature follows `UX-CONTRACT.md` and server authorization.

## Team management (2026-10-20)
Email invitations and role editing preserve the existing cabinet palette and
compact surfaces. Shared team controls live in css/styles.css and reuse --check-*
tokens. The team list includes all network participants, with explicit role and
department labels. At 390px cards wrap without horizontal scrolling. Native
select popups remain platform-owned for mobile keyboard/accessibility behavior.
The role confirmation is an app-styled native dialog with Cancel initially focused.

## Authentication layout (1.2.7)
The auth screen uses one centered brand stack: existing equipment logo, Check App,
small version label, then the product tagline. css/styles.css owns auth geometry
through .auth-* selectors; the primary palette remains unchanged. The content
column is 420px maximum with 20px mobile gutters, 52px fields/primary buttons,
44px tabs/secondary targets and consistent 16–18px field gaps. Mobile layout is
top-aligned and scrolls naturally when the keyboard reduces the viewport.
Both compiled Tailwind and product CSS URLs are versioned. The build fills the
version beneath the brand from package.json for website/APK consistency.

## Themes (1.2.8)
Runtime CSS variables in css/styles.css remain the canonical palette (Model B).
Tailwind semantic colors adapt RGB tokens with alpha support; components use
canvas/surface/raised/header/line/control/ink/soft/muted/subtle and status roles.
Dark is the compatibility default. Light uses canvas #f4f6fb, surface #ffffff,
raised #eef2f8, text #172438 and muted #56657b, retaining solid violet actions.
Status foregrounds darken in light mode for contrast; image/SVG asset colors and
solid-action white labels are not inverted. Native inputs/selects inherit the
root color-scheme. js/theme.js applies the saved choice before first paint and
mounts the same two-button control on login and cabinet. Preference is device-local
and survives sign-out; switching themes does not change account/company state.

## Approved mobile workspace (2026-11-01, second iteration)

The user selected the mobile-concept/check-app-mobile-v2 preview after rejecting
small cosmetic changes. The actual implementation uses existing dark/light
palette tokens, the existing logo and Inter/system Cyrillic typography. The new
structure supersedes the earlier keep-top-navigation rule only below 768px.

- Header: brand/company and a labelled initials button opening the existing cabinet.
  Full name, role and email remain available in More; logout remains available.
- Network manager: one visible native department selector. Its options, frozen
  state, value and handler are unchanged. The second dashboard selector remains
  for desktop compatibility and is visually hidden on phones.
- Staff navigation: Главная / Календарь / Задачи / Ещё. Employees retain their
  existing accessible workflows: Сегодня / Разовые / Расходники / Ещё. They do not
  gain equipment, reports, team or department controls.
- More: application-styled native dialog; browser owns focus trap/inertness,
  Escape and restoration. The UI module derives links from role-filtered existing
  navigation, names the active page, closes on navigation and retains create
  department for network managers and administration for eligible users.
- Dashboard: one summary with the existing four count IDs, existing task data,
  a shared maintenance task card and shortcuts to existing equipment/history.
  Today uses the same task card. Completion always opens the existing dialog;
  the UI module never writes task results or sends database requests.
- Existing list, form, dialog and role implementations remain canonical. New
  icon/SVG output, navigation and task action delegation live in js/interface.js.
- Bottom navigation is above content but below existing modals; main reserves
  112px plus the bottom safe-area inset. Native dialogs use the top layer. Long
  forms keep document scrolling; small-screen modal contents have bounded scroll.
- Visual contract: control 8px, existing shared card 12px, maintenance summary
  and task cards 14px; neutral surfaces, tabular figures and semantic status tones.
- Verification: scripts/check-mobile-interface.mjs exercises real page switches,
  current-page state, all More destinations, role filtering, focus/Escape,
  completion delegation, logout, empty state and both themes at four widths.
