# Login timeout fix — 1.2.3

Manual sign-in and automatic session restoration now have a 30-second deadline covering authentication, profile, company, equipment, and privilege queries. Their finalizers release loading state even when the SDK promise never settles. Superseding manual sign-in cancels the previous automatic restore; cancelled attempts check their signal before publishing loaded records and entering the app.

Supabase HTTP requests use a bounded fetch: Auth/Data API requests abort after 20 seconds; uploads/functions retain 60 seconds to allow photo uploads and resumable company deletion. Caller cancellation remains connected. Failed requests do not delete local data or log the user out.

Verification: `scripts/test-login-timeout.mjs` exercises the real login code and DOM in Chromium with stalled password/profile/company/equipment/RPC responses, late replies, retry success, automatic restore, fetch abort and upstream cancellation. Company deletion browser regression and production bundle build also run. These simulations do not establish connectivity from the user's specific Android network or verify their password.
