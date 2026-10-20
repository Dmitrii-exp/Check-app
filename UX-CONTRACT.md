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
