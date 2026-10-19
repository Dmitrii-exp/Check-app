import { Webhook } from "npm:standardwebhooks@1.1.1";
import { Resend } from "npm:resend@6.34.1";

const resend = new Resend(
  Deno.env.get("RESEND_API_KEY") as string
);

const hookSecret = (
  Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string
).replace("v1,whsec_", "");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  try {
    const wh = new Webhook(hookSecret);

    const {
      user,
      email_data,
    } = wh.verify(payload, headers) as {
      user: {
        email: string;
      };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
        site_url: string;
        token_new: string;
        token_hash_new: string;
      };
    };

    const isRecovery = email_data.email_action_type === "recovery";
    let recoveryUrl = "";
    if (isRecovery) {
      if (!email_data.token_hash) throw new Error("Missing recovery token hash");
      // The website exchanges this one-time hash with Auth. Keeping it in the
      // fragment avoids server access logs and the misconfigured redirect allow list.
      const url = new URL("https://app-check.ru/app/");
      url.hash = new URLSearchParams({token_hash: email_data.token_hash, type: "recovery"}).toString();
      recoveryUrl = url.toString();
    }
    const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const { error } = await resend.emails.send({
      from: "Check App <noreply@sale-trener.ru>",
      to: [user.email],
      subject: isRecovery ? "Восстановление пароля — Check App" : "Подтверждение регистрации — Check App",
      text: isRecovery
        ? `Чтобы создать новый пароль Check App, откройте ссылку: ${recoveryUrl}\nВведите новый пароль и повторите его для подтверждения. Если вы не запрашивали восстановление, проигнорируйте это письмо.`
        : `Ваш код подтверждения: ${email_data.token}`,
      html: isRecovery ? `<!DOCTYPE html>
        <html lang="ru"><body style="margin:0;padding:32px 16px;background:#f5f5f7;font-family:Arial,sans-serif;color:#172033;">
          <div style="max-width:560px;margin:auto;background:#fff;padding:32px;border-radius:16px;">
            <h1>Check App</h1><h2>Восстановление пароля</h2>
            <p>Нажмите кнопку ниже, чтобы создать новый пароль. На странице введите новый пароль и повторите его для подтверждения.</p>
            <p style="margin:28px 0;"><a href="${escapeHtml(recoveryUrl)}" style="display:inline-block;background:#6350ed;color:#fff;text-decoration:none;padding:16px 24px;border-radius:12px;">Создать новый пароль</a></p>
            <p>Если кнопка не открывается, скопируйте эту ссылку в браузер:</p>
            <p style="word-break:break-all;"><a href="${escapeHtml(recoveryUrl)}">${escapeHtml(recoveryUrl)}</a></p>
            <p style="color:#777;font-size:13px;">Ссылка одноразовая. Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
          </div>
        </body></html>` : `
        <!DOCTYPE html>
        <html lang="ru">
        <body style="margin:0;padding:40px;background:#f5f5f7;font-family:Arial,sans-serif;">
          <div style="max-width:560px;margin:auto;background:#fff;padding:40px;border-radius:16px;">
            <h1>Check App</h1>

            <h2>Подтвердите email</h2>

            <p>
              Спасибо за регистрацию.
              Введите этот код подтверждения в приложении:
            </p>

            <div style="
              margin:25px 0;
              padding:20px;
              text-align:center;
              background:#f3f0ff;
              border-radius:12px;
              font-size:32px;
              font-weight:bold;
              letter-spacing:8px;
            ">
              ${email_data.token}
            </div>

            <p style="color:#777;font-size:13px;">
              Если вы не регистрировались в Check App,
              просто проигнорируйте это письмо.
            </p>

            <p style="color:#999;font-size:12px;">
              Check App
            </p>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({}),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error("Auth email hook request failed");

    return new Response(
      JSON.stringify({
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});
