# Company deletion

Network owners see **Удалить компанию** in their cabinet. The confirmation names
the company, explains permanent deletion including the owner's and employees'
accounts, and requires the exact word `УДАЛИТЬ`. Other roles do not see the action.
Server authorization is independent of button visibility and browser state.

The `delete-company` function validates the current Auth user and starts a
server-only deletion job for their own company. The database immediately freezes
company access and new writes, invitation joins, payments and uploads. Employee
refresh sessions are revoked; the owner retains their session to finish cleanup.

Cleanup removes all company-prefixed objects from all Storage buckets using the
Storage API, including unreferenced uploads. Only after files are removed does
the database delete company data. Auth users are deleted next, with the owner
last. Removing the owner also removes the transient job and its member-ID
snapshot. A failed request can be retried; signing back in restores a pending
owner confirmation. No browser-supplied user list is accepted.

The operation refuses inconsistent cross-company references or member-owned files
outside the company, before starting deletion. Other companies are preserved.
Files previously downloaded to other devices and external payment-provider
records are outside Check App's data store. A CDN may briefly serve an already
cached image while deletion invalidation propagates.

Validation completed with generated fixtures only:

- SQL rollback suite: owner authorization, exact confirmation, isolation, access
  freeze, files-before-data, owner-last, retry and job removal.
- Live Auth + Storage + function test: employee and foreign owner rejected;
  real worker photo report saved; real photos in both buckets removed; company,
  employee and owner removed; a second company's records and photo preserved.
  Both isolated test companies were then cleaned up. Original profile count: 4;
  final profile count: 4; remaining fixture accounts, companies and jobs: 0.
- Browser suite: owner-only visibility, typed confirmation, keyboard focus,
  390px viewport, busy state, error/retry and successful local logout/reload.
- Production web build and payment HTTP regression suite.

Commands:

```sh
node supabase/tests/company-deletion-http.test.mjs
node scripts/test-company-deletion-ui.mjs
npm run build:mobile
```

The browser test needs Playwright and Chromium. An alternate installed executable
can be supplied through `CHROMIUM_EXECUTABLE`. SQL integration fixtures live in
`supabase/tests/company-deletion-transaction.sql` and end in `ROLLBACK`.

The premium static UI audit was also run. Its eight findings concern existing
date/select controls, update-button binding and forms/textareas outside the new
deletion flow; those unrelated interfaces were not rewritten.
