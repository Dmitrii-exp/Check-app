# Password recovery email

The Auth `send-auth-email` hook previously rendered a registration OTP for every event, ignoring `email_action_type`. Version 12 branches on `recovery`, sends a reset-specific subject and a button, and omits the OTP from both HTML and plain text. Registration OTP behavior is retained.

The button opens `https://app-check.ru/app/#token_hash=...&type=recovery`. The website removes the sensitive fragment and calls Auth `verifyOtp` with `type: recovery` before displaying the two password fields. This avoids the project's old Auth redirect configuration, which a live invalid-token check showed falling back to `http://localhost:3000`. Invalid or expired links leave the password form closed. All clients, including old Android releases, use this updated web form. Saving calls Auth `updateUser` and signs out. No administrator sets a user password.

The hook still verifies the Standard Webhooks signature before sending. Tokens are not logged. Tests never send email or modify real accounts:

- `supabase/tests/auth-email-hook.test.mjs`: actual Standard Webhooks signing/verification, recovery link and subject, no OTP, fixed redirect, unchanged registration, forged signature denial. Test tooling requires standardwebhooks 1.1.1 and typescript 5.9.3 (set CHECK_APP_TEST_TOOLING to their node_modules directory).
- `scripts/test-password-reset-ui.mjs`: Chromium, recovery event opens two fields, mismatch denial, matching password update and return to login with Auth stub.
