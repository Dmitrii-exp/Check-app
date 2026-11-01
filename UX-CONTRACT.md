# Scoped UI contract: company deletion

User decision: a network owner may permanently delete their own company after
typing exactly `УДАЛИТЬ` and pressing `Удалить компанию`. This includes their own
account and employee accounts, all company database records and company photos.

| Capability | Owner | Contract |
| --- | --- | --- |
| Permission | Supabase delete-company handler and server-only RPCs | Verify current Auth user and stored manager profile; never trust browser roles or arbitrary account IDs |
| Form | company-deletion.js and delete-company-form | Literal typed confirmation, no native validation bubbles, associated inline feedback, preserve input on failure |
| Modal | Native dialog styled by css/styles.css | Named dialog, inert background, focus containment, initial Cancel focus and focus restoration |
| CRUD | delete-company Edge Function | Freeze access, remove actual files using Storage API, remove company data, then Auth users with owner last |
| Recovery | private deletion job and status RPC | Retry the same operation; a reauthenticated owner can resume an interrupted deletion |
| Feedback | delete-company-status | Persistent live status; no optimistic success or fabricated percentage |
| Success | cleared local session and login screen | Report completion only after the server removed accounts; reload clears cached company data |

The dialog names the company and consequences before the irreversible action.
The confirmation button stays disabled until the word matches and while busy.
No undo is offered for a hard deletion. No real company is used for testing.

No table selection, select popup, date input or search behavior is changed.

## Email invitations and roles

| Capability | Owner | Contract |
| --- | --- | --- |
| Invite preparation | team.js + company-invitations Edge | Network manager enters email and department; explicit prepare then send; no joining token returned to manager |
| Delivery | Edge + Resend | Link goes only to the invited email, bound to company/department, one use and seven days; replacement invalidates previous link |
| Recipient form | team.js | Show fixed email/company/department; new user enters name/password/repeat; existing user proves current password; no registration OTP |
| Role assignment | set_company_member_role RPC | Stored network-manager role required; default invitation is always employee; prevent demotion of last manager |
| Role dialog | Native dialog + team.js | Native modal focus containment; initial Cancel; Escape blocked only during save; preserve values and inline error on failure |
| Role/department selects | Browser platform | Native keyboard and mobile popup behavior intentionally retained; application owns options, labels and validation |
| Billing privacy | RLS + hydrateCurrentUser | Staff never fetch subscription rows; only operational limits are returned for work |
| Equipment/actions | RLS + guarded controls | Network manager across network; department lead only own department; employee cannot mutate |
| Consumables | RLS + consumables.js | Employee may create a request/photo as one record, cannot edit existing records; task execution remains available |

Invitation and role feedback stays next to the action. No optimistic acceptance or
role change. Failure preserves form values; busy states prevent duplicate submits.
Invitation tokens stay in memory after removing the URL fragment; never store
passwords or invitation links in localStorage. Legacy shared-code joining is revoked.

Team and recipient forms use novalidate and inline Russian validation. Required, email and password constraints are checked without native bubbles; invalid fields reference live feedback and focus moves to the first invalid field.

## Authentication geometry and version
Auth forms share .auth-* controls in css/styles.css. Forms submit through the
existing handlers with novalidate; input values/autofill/paste remain supported.
Password visibility toggles are keyboard-accessible with changing label/state.
Primary/busy button dimensions are stable. Mobile inputs are 16px to avoid iOS
focus zoom. No fixed-height container traps focused fields behind the keyboard.
The static auth-version label is populated from package.json by build-mobile.mjs.

## Interface theme
Exactly two explicit choices: Тёмная / Светлая. Dark remains the initial default.
The shared button group uses aria-pressed, keyboard focus and a live status; both
controls stay synchronized. LocalStorage persistence failure preserves the current
choice in memory and announces that saving failed. Cross-tab storage events update
the displayed choice. js/theme.js reads only a validated light/dark string before
CSS paint, never user credentials. The preference is independent of Auth storage.
All users can change their own device theme before or after login.

## Dashboard department selector (1.2.9)
The network manager sees every existing company department in a native select next
to Главная. Native popup geometry is platform-owned. Both dashboard/top selectors
share renderDeptSelect/onDeptChange and update the same currentDeptId; metrics and
tasks follow that selection. Frozen departments stay visible and disabled under
existing tariff policy. Staff retain their assigned department and cannot switch.
Long names fit within the mobile viewport; no department yields a disabled control.


## Approved mobile navigation and maintenance cards

Source: explicit user approval of the second mobile preview on 2026-11-01.
The stored role rules in enterApp/showPage and the existing data/permission
contracts above remain authoritative; presentation does not grant capabilities.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | renderDeptSelect/onDeptChange | Existing role/tariff contract | Native popup; one visible selector on phones | check-themes.mjs |
| Date | Existing native date inputs and calendar-core.js | Current stored dates and calendar task rules | Platform-owned date popup, unchanged | Existing calendar checks |
| Form | Existing form handlers and dialogs | Existing validation and submit contracts | No new data-entry workflow | Auth/team/deletion regression scripts |
| Scrollbar | css/styles.css | DESIGN.md runtime tokens | Global baseline, compact geometry exception | Both-theme/narrow viewport checks |
| CRUD | Existing js/app.js/team.js/consumables.js | Existing service and permission contracts | Same mutations, new navigation triggers | Existing mocked regressions |

The More menu is a native dialog. Initial focus is Close. Tab stays inside,
Escape closes and returns focus to the opener. Navigation closes the dialog and
focuses the new page heading, then resets document scroll. Switching to desktop
closes an open menu. Logout closes the menu and invokes the same logout handler.

For managers/leads, bottom Tasks means Today; one-time tasks remain in More.
For employees, Home means Today, with One-time and Consumables as separate bottom
items. Other routes are derived from enterApp-filtered buttons; More never
unhides the original navigation or rewrites roles. Create department remains
network-manager-only; super administration retains its original eligibility.

Maintenance cards show the same title, equipment, description and done/pending
state. A completion button only delegates a still-visible unfinished task to
openCompleteModal; the previous required-worker/photo/status flow is unchanged.
Opening the dialog must not write a result. Calendar remains informational.

## Engine-hour maintenance

Business source: explicit user requirement, 2026-11-01: a reading of 3560 and
interval 2000 produces the next TO at 4000, with 440 remaining. Existing date
schedules retain their day frequency. Each new action selects days or engine hours.

| Capability | Canonical owner | Contract |
| --- | --- | --- |
| Select/Listbox | Existing native selects | OS popup accepted; equipment stays in active department |
| Form | engine-hours.js + hours-form | Total meter reading, decimal comma accepted, inline validation, preserve errors/input, no duplicate save |
| Modal | Native dialog, shared CSS tokens | Named dialog, initial reading focus, Escape/cancel disabled while pending, restore source or current page heading |
| CRUD | record_equipment_hours RPC | Stored profile scope and subscription checks; monotonic reading; compare expected value; audit actor/time |
| Scheduling | ensure_due_maintenance_tasks | Aligned thresholds from zero; no TO at zero; at most one pending hour task per action |
| Completion | Existing photo report + database triggers | Snapshot current reading; next threshold is the first aligned multiple after actual service, at least one interval beyond task threshold |
| Feedback | Existing toast + inline status | Success only after RPC; refresh failure says reading saved and requests reload |
| Conflict | RPC SQLSTATE 40001 | Never silently overwrite another reading; reload current data and preserve proposed input |

No speculative calendar dates are shown for hour schedules. Existing date tasks,
roles, billing, Auth and photo validation remain authoritative. Audit history
is tenant/department scoped and follows company/equipment cascade deletion.

## Department Excel export

Business source: user request 2026-11-01, download employee completion counts and
completed/uncompleted tasks for one selected department.

| Capability | Canonical owner | Contract |
| --- | --- | --- |
| Select/Listbox | Report export native select | Manager chooses any visible department; lead only own department; selection is for the file |
| Form/status | report-export.js + report-export-status | Preserve choice on error, explicit busy state, block duplicate clicks, announce actual save handoff |
| Data | Existing Supabase RLS | Read-only fresh company/department queries, keyset pagination, no partial file on API failure or account change |
| Workbook | report-export.js | Three sheets: employee summary, completed, unfinished; include TO and one-time tasks; typed dates and counts, filters/frozen headers |
| Attribution | Existing result and assignment fields | Actual worker name from report; sender separate; pending by assigned user or explicit blocked worker name; otherwise unassigned group |
| Dates | Existing UTC task dates | Export all history; unfinished includes today/overdue, excludes future planned tasks; no claim of historical snapshot reconstruction |
| Save | Browser Blob / native cache + Share | Local workbook; no upload to server; Android user chooses save destination via system menu |

Manual names without a unique account-name match remain explicitly labelled, not
asserted to be verified account identities. Completion report wins over a transient
pending task status. Duplicate completion records for one task count once.
