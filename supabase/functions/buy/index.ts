// Supabase Edge Function "buy": проверяет devnet-транзакцию оплаты и начисляет PV.
// БЕЗ внешних зависимостей. Клиент присылает {wallet, signature}. Мы:
//  1) убеждаемся, что подпись ещё не использована (защита от повторов);
//  2) читаем транзакцию из блокчейна и проверяем, что wallet заплатил на treasury;
//  3) начисляем PV в сейв игрока (через service_role, минуя RLS) и запоминаем покупку.
const RPC = "https://api.devnet.solana.com";
const TREASURY = "RjUd1g9rD6ZR1zZMwy5MgfupBGKstvdBLvJ6N7VaDoH";
const RATE = 7500; // 1 SOL → 7 500 PV
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
// Вызвать атомарную SQL-функцию баланса. Возвращает новый баланс или null.
async function rpcNum(fn: string, args: Record<string, unknown>): Promise<number | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  const v = Array.isArray(data) ? data[0] : data;
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}
// Гарантировать строку баланса (ленивый бэкфилл из сейва) — чтобы атомарный UPDATE нашёл что менять.
async function ensureBalanceRow(wallet: string): Promise<void> {
  const brows = await fetch(`${SB_URL}/rest/v1/balances?wallet=eq.${encodeURIComponent(wallet)}&select=wallet`, { headers: sbHeaders() }).then((r) => r.json());
  if (brows?.[0]) return;
  const sRows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  const coins = Math.floor(Number(sRows?.[0]?.data?.coins ?? 0)) || 0;
  await fetch(`${SB_URL}/rest/v1/balances`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal,resolution=merge-duplicates" }), body: JSON.stringify({ wallet, coins, last_collect: Date.now(), updated_at: new Date().toISOString() }) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { wallet, signature } = await req.json();
    if (!wallet || !signature) return jsonResp({ error: "missing fields" }, 400);

    // 1) Читаем транзакцию из блокчейна (с повторами — узел может ещё не видеть tx).
    let tx: any = null;
    for (let i = 0; i < 8; i++) {
      const rpcRes = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] }),
      });
      const rpc = await rpcRes.json();
      if (rpc.result) { tx = rpc.result; break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) return jsonResp({ error: "tx not found (try again in a few seconds)" }, 404);
    if (tx.meta?.err) return jsonResp({ error: "tx failed on-chain" }, 400);

    // 2) Проверяем перевод: wallet — плательщик (индекс 0), treasury получил lamports.
    const keys: string[] = tx.transaction.message.accountKeys;
    const tIdx = keys.indexOf(TREASURY);
    const wIdx = keys.indexOf(wallet);
    if (tIdx < 0 || wIdx !== 0) return jsonResp({ error: "bad accounts" }, 400);
    const paid = Number(tx.meta.postBalances[tIdx]) - Number(tx.meta.preBalances[tIdx]);
    if (paid <= 0) return jsonResp({ error: "no payment to treasury" }, 400);
    const pv = Math.floor((paid / 1e9) * RATE);

    // 3) Записываем покупку ПЕРВОЙ (signature — PK): при повторе будет конфликт 409 → не начисляем дважды.
    const rec = await fetch(`${SB_URL}/rest/v1/purchases`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ signature, wallet, lamports: paid, pv, created_at: new Date().toISOString() }),
    });
    if (rec.status === 409) return jsonResp({ error: "already processed" }, 409);
    if (!rec.ok) return jsonResp({ error: "record failed" }, 500);

    // 4) Начисляем PV в СЕРВЕРНЫЙ баланс АТОМАРНО (pv_add_checked: UPDATE ... SET coins=coins+pv RETURNING).
    //    Так параллельные покупки/начисления не затирают друг друга (без lost-update). Строку гарантируем заранее.
    await ensureBalanceRow(wallet);
    const coins = await rpcNum("pv_add_checked", { p_wallet: wallet, p_delta: pv, p_min: 0 });

    return jsonResp({ ok: true, credited: pv, coins: coins ?? pv });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
