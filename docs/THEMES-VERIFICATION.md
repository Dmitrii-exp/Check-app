# Interface themes — 1.2.8

Two explicit themes: dark (initial compatibility default) and light. The shared
control is available before login and in every user's cabinet. The validated
device-local preference applies before styles paint, persists across reload and
sign-out, and synchronizes across tabs. If storage is unavailable, switching
still works in the current page and announces that saving failed.

css/styles.css is the canonical RGB/semantic token owner. tailwind.config.js adapts
those tokens with opacity support. Existing application/JS-rendered surfaces,
text, borders, statuses, forms, calendar, dialogs and onboarding use semantic
roles. Solid brand buttons keep white labels; images and logo colors are unchanged.
Changed script/CSS URLs are versioned, including the calendar's dynamic loader.

Verification:

- npm run build:mobile; node scripts/audit-js.mjs; git diff --check.
- scripts/check-themes.mjs uses actual HTML/JS/CSS and mocked company data: dark/
  light page matrix (calendar, dashboard, today, equipment, actions, consumables,
  team, history, reports, cabinet), equipment/role dialogs, persistence/reload,
  synchronized controls, sign-out, cross-tab update and blocked-storage failure.
- The same browser check measures eight representative foreground/background
  combinations in both themes against a 4.5:1 text contrast threshold.
- check-auth-layout.mjs: 320/390/1440px and shortened viewport, stable controls,
  no overflow, password toggle and tabs.
- Existing team, password recovery and company deletion browser tests pass.
- Premium static audit retains the existing unrelated form/textarea/update-button
  and native-control ownership findings; theme controls add no such findings.

No production company records or payment configuration are changed. Native
Android installation and real iOS device testing are not performed here.
