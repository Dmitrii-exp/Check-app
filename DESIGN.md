# Check App design context

## Product and audience
Russian-language equipment-maintenance application for company owners, department
leads and employees. The existing cabinet is the reference for this scoped change.

## Visual intent
Preserve the compact dark workspace, Inter/system typography, rounded cards and
clear Russian action labels. Destructive company deletion is visually separated
from account security, updates and subscription actions. No redesign is authorized.

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
