// Supabase Edge Function "sell": запрос на продажу PV за SOL. БЕЗ ключа казны и без выплаты —
// только СПИСЫВАЕТ PV из сейва (держит) и создаёт заявку status=pending. Реальную выплату SOL
// делает отдельная функция после ручного подтверждения админом.
// Продавца определяем из JWT (claim wallet), проверяя подпись тем же JWT_SECRET, что и в auth.
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RATE = 10000; // 10 000 PV → 1 SOL

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function sbHeaders(extra?: Record<string, string>) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...extra };
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Проверить JWT (HS256) и вернуть claim wallet.
async function walletFromJwt(auth: string | null): Promise<string | null> {
  const token = (auth ?? "").replace(/^Bearer /, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (p.exp && p.exp * 1000 < Date.now()) return null;
  return p.wallet ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const wallet = await walletFromJwt(req.headers.get("Authorization"));
    if (!wallet) return jsonResp({ error: "unauthorized" }, 401);
    const { pv } = await req.json();
    if (!Number.isFinite(pv) || pv <= 0) return jsonResp({ error: "bad amount" }, 400);

    // Читаем сейв и проверяем баланс.
    const rows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
    const data = rows?.[0]?.data;
    if (!data) return jsonResp({ error: "no save" }, 400);
    const coins = Math.floor(data.coins ?? 0);
    if (coins < pv) return jsonResp({ error: "not enough PV" }, 400);

    const sol = +(pv / RATE).toFixed(6);
    const newCoins = coins - pv;

    // Списываем PV (держим до одобрения).
    await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ data: { ...data, coins: newCoins }, updated_at: new Date().toISOString() }),
    });

    // Создаём заявку.
    const id = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const rec = await fetch(`${SB_URL}/rest/v1/sell_requests`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ id, wallet, pv, sol, status: "pending", created_at: new Date().toISOString() }),
    });
    if (!rec.ok) {
      // откат списания, если заявку не создали
      await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ data: { ...data, coins }, updated_at: new Date().toISOString() }),
      });
      return jsonResp({ error: "request failed (sell_requests table?)" }, 500);
    }

    return jsonResp({ ok: true, coins: newCoins, pv, sol });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
