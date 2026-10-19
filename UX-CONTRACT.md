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
