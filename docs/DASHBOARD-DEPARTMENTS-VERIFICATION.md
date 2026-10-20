# Dashboard department selection — 1.2.9

The network manager can choose any active company department next to Главная.
Frozen departments remain visible/disabled, based on the existing work-limit RPC.
The same render/change functions synchronize top-bar and dashboard selects.
No database, authorization, subscription, or payment changes are included.

Verified via scripts/check-themes.mjs in Chromium at 390px: two departments with
different equipment and tasks; both directions of switching; keyboard selection;
long name without overflow; frozen option and fallback; empty company; department
lead cannot change scope; existing light/dark page and dialog matrix still passes.
A legacy OTP Enter handler referenced an undefined variable; its existing behavior
is now guarded so normal keyboard selection does not throw. No auth flow changed.
Production build and scripts/audit-js.mjs pass. Strict premium UI audit retains
eight pre-existing findings (native popup ownership, dynamic update button,
two legacy forms and three textareas); this scope does not add new findings.
Tests use mocked company data and do not mutate real accounts.
Native select popup remains platform-owned; real iOS/Android hardware not tested.
