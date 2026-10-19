import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод недоступен" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Сервис временно недоступен" }, 503);
  const bearer = req.headers.get("authorization") || "";
  if (!bearer.startsWith("Bearer ")) return json({ error: "Войдите в аккаунт" }, 401);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  let started = false;
  try {
    // Verify the user on Auth; no role or company claim from the browser is trusted.
    const { data: auth, error: authError } = await admin.auth.getUser(bearer.slice(7));
    if (authError || !auth?.user) return json({ error: "Сессия истекла. Войдите заново." }, 401);
    const body = await req.json().catch(() => null);
    if (body?.action === "status") {
      const { data, error } = await admin.rpc("company_deletion_status", { p_actor: auth.user.id });
      if (error) throw error;
      return json({ deletion: data });
    }
    if (body?.confirmation !== "УДАЛИТЬ" || !uuid.test(body?.companyId || "")) return json({ error: "Для подтверждения введите УДАЛИТЬ" }, 400);
    const companyId = body.companyId.toLowerCase();
    const { error: beginError } = await admin.rpc("begin_company_deletion", { p_actor: auth.user.id, p_company: companyId, p_confirmation: body.confirmation });
    if (beginError) {
      if (beginError.code === "42501") return json({ error: "Удалить компанию может только её руководитель сети." }, 403);
      if (beginError.code === "23514") return json({ error: "Есть связанные данные за пределами компании. Удаление не начато — обратитесь в поддержку." }, 409);
      throw beginError;
    }
    started = true;
    const deadline = Date.now() + 20000;
    for (let step = 0; step < 30 && Date.now() < deadline; step++) {
      const { data: batch, error } = await admin.rpc("company_deletion_batch", { p_actor: auth.user.id, p_company: companyId });
      if (error) throw error;
      if (batch.phase === "photos") {
        const buckets = new Map();
        for (const file of batch.photos) {
          if (!file.name.startsWith(companyId + "/")) throw new Error("Invalid deletion scope");
          if (!buckets.has(file.bucket_id)) buckets.set(file.bucket_id, []);
          buckets.get(file.bucket_id).push(file.name);
        }
        for (const [bucket, names] of buckets) {
          const { error: removeError } = await admin.storage.from(bucket).remove(names);
          if (removeError) throw removeError;
        }
      } else if (batch.phase === "accounts" && Array.isArray(batch.users)) {
        // The database supplies the original membership; the browser cannot choose accounts.
        for (let i = 0; i < batch.users.length; i += 5) {
          await Promise.all(batch.users.slice(i, i + 5).map(async id => {
            const { error: deleteError } = await admin.auth.admin.deleteUser(id, false);
            if (deleteError && deleteError.code !== "user_not_found" && deleteError.status !== 404) throw deleteError;
          }));
        }
        if (batch.final) return json({ complete: true });
      } else throw new Error("Invalid deletion phase");
    }
    return json({ complete: false, pending: true }, 202);
  } catch (error) {
    console.error("Company deletion failed", { code: error?.code || "unavailable" });
    return json({ error: started ? "Удаление начато, но не завершено. Повторите подтверждение, чтобы продолжить." : "Не удалось начать удаление. Повторите попытку.", pending: started }, 503);
  }
});
