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

    // 4) Начисляем PV в сейв игрока (read-modify-write через service_role).
    const rows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
    const data = rows?.[0]?.data;
    if (!data) return jsonResp({ error: "no save yet — play a bit first" }, 400);
    const coins = Math.floor((data.coins ?? 0) + pv);
    await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ data: { ...data, coins }, updated_at: new Date().toISOString() }),
    });

    return jsonResp({ ok: true, credited: pv, coins });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
