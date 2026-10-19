import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

function matchesSignature(input, signature) {
  const expected = createHash("md5").update(input).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

Deno.serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const password2 = Deno.env.get("ROBOKASSA_PASSWORD_2");
  const testPassword2 = Deno.env.get("ROBOKASSA_TEST_PASSWORD_2");
  if (!supabaseUrl || !serviceKey || !password2) return new Response("Server not configured", { status: 503 });
  try {
    let params;
    if (req.method === "GET") {
      params = new URL(req.url).searchParams;
    } else {
      const raw = await req.text();
      if (raw.length > 65536) return new Response("Request too large", { status: 413 });
      if ((req.headers.get("content-type") || "").includes("application/json")) {
        let body;
        try { body = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return new Response("Bad request", { status: 400 });
        params = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
      } else {
        params = raw ? new URLSearchParams(raw) : new URL(req.url).searchParams;
      }
    }
    const amount = params.get("OutSum") || "";
    const invoice = params.get("InvId") || params.get("InvoiceID") || "";
    const signature = (params.get("SignatureValue") || "").toLowerCase();
    if (!/^\d{1,15}$/.test(invoice) || BigInt(invoice) <= 0n ||
        !/^\d{1,10}(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0 ||
        !/^[a-f0-9]{32}$/.test(signature)) return new Response("Bad request", { status: 400 });
    // Reject ambiguous signed parameters before verifying or processing anything.
    if ([...params.keys()].some(key => params.getAll(key).length !== 1) ||
        (params.has("InvId") && params.has("InvoiceID") && params.get("InvId") !== params.get("InvoiceID"))) {
      return new Response("Ambiguous parameters", { status: 400 });
    }
    const additional = [...params.entries()].filter(([key]) => key.startsWith("Shp_"))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => key + "=" + value);
    if (!matchesSignature([amount, invoice, password2, ...additional].join(":"), signature)) {
      if (testPassword2 && matchesSignature([amount, invoice, testPassword2, ...additional].join(":"), signature)) {
        return new Response("OK" + invoice, { headers: { "Content-Type": "text/plain" } });
      }
      return new Response("Bad signature", { status: 403 });
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { error } = await admin.rpc("process_verified_robokassa_payment", { p_inv_id: invoice, p_amount: amount });
    if (error) {
      console.error("Payment processing rejected", { code: error.code });
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
      return new Response("Payment processing failed", { status });
    }
    return new Response("OK" + invoice, { headers: { "Content-Type": "text/plain" } });
  } catch {
    console.error("Payment processing unavailable");
    return new Response("Payment processing unavailable", { status: 500 });
  }
});
