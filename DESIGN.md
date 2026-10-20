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
