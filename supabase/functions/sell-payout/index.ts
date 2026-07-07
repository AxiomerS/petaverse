// Supabase Edge Function "sell-payout": АДМИН подтверждает/отклоняет заявку на продажу PV.
// approve → отправляет SOL с казны игроку (подпись ключом казны из секрета TREASURY_SECRET) и ставит paid.
// reject  → возвращает PV в сейв игрока и ставит rejected.
// Доступ только у ADMIN (проверяем claim wallet в JWT тем же JWT_SECRET, что и в auth).
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "npm:@solana/web3.js@1.95.8";

const RPC = Deno.env.get("HELIUS_RPC_URL") ?? ""; // секрет Supabase (Edge Functions → Secrets) — НЕ хардкодить, ключ виден всем в публичном репо
const ADMIN = "EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk";
const MAX_PAYOUT_SOL = 5; // предохранитель: авто-выплату больше этого казна не отправит (разбирать вручную)
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TREASURY_SECRET = Deno.env.get("TREASURY_SECRET") ?? ""; // base58-приватный ключ казны

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResp(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
function sbHeaders(e?: Record<string, string>) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...e };
}
// Атомарная SQL-функция баланса (pv_add_checked) + гарантия строки баланса — чтобы возврат PV при reject
// не затирал параллельное начисление (lost update).
async function rpcNum(fn: string, args: Record<string, unknown>): Promise<number | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) });
  const data = await res.json().catch(() => null);
  const v = Array.isArray(data) ? data[0] : data;
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}
// resolution=ignore-duplicates -> INSERT ... ON CONFLICT DO NOTHING: если строку только что создал
// параллельный запрос (гонка при самом первом обращении кошелька), наш INSERT молча ничего не делает,
// а не ПЕРЕЗАПИСЫВАЕТ (как было с merge-duplicates) уже атомарно изменённый другим запросом баланс.
async function ensureBalanceRow(wallet: string): Promise<void> {
  const brows = await fetch(`${SB_URL}/rest/v1/balances?wallet=eq.${encodeURIComponent(wallet)}&select=wallet`, { headers: sbHeaders() }).then((r) => r.json());
  if (brows?.[0]) return;
  const sRows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  const coins = Math.floor(Number(sRows?.[0]?.data?.coins ?? 0)) || 0;
  await fetch(`${SB_URL}/rest/v1/balances`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal,resolution=ignore-duplicates" }), body: JSON.stringify({ wallet, coins, last_collect: Date.now(), updated_at: new Date().toISOString() }) });
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
async function walletFromJwt(auth: string | null): Promise<string | null> {
  const t = (auth ?? "").replace(/^Bearer /, "");
  const p = t.split(".");
  if (p.length !== 3) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  if (!ok) return null;
  const pl = JSON.parse(new TextDecoder().decode(b64urlToBytes(p[1])));
  if (pl.exp && pl.exp * 1000 < Date.now()) return null;
  return pl.wallet ?? null;
}
// Проверить on-chain, что подпись реально успешно исполнена (не просто отправлена).
async function txSucceeded(conn: Connection, sig: string): Promise<boolean> {
  try {
    const res = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const st = res.value[0];
    return !!st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized");
  } catch {
    return false;
  }
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error("bad base58");
    let carry = val;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = await walletFromJwt(req.headers.get("Authorization"));
    if (admin !== ADMIN) return jsonResp({ error: "forbidden" }, 403);
    const { id, action } = await req.json();
    if (!id) return jsonResp({ error: "missing id" }, 400);

    const rows = await fetch(`${SB_URL}/rest/v1/sell_requests?id=eq.${encodeURIComponent(id)}&select=*`, { headers: sbHeaders() }).then((r) => r.json());
    const reqRow = rows?.[0];
    if (!reqRow) return jsonResp({ error: "not found" }, 404);

    // reset → вернуть ЗАСТРЯВШУЮ заявку (error/paying) обратно в очередь, чтобы повторить выплату.
    // Только для не-терминальных статусов; paid/rejected не трогаем.
    if (action === "reset") {
      if (reqRow.status !== "error" && reqRow.status !== "paying") return jsonResp({ error: "not stuck" }, 409);
      await fetch(`${SB_URL}/rest/v1/sell_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "pending" }) });
      return jsonResp({ ok: true, status: "pending" });
    }

    if (reqRow.status !== "pending") return jsonResp({ error: "already handled" }, 409);

    // Предохранитель: авто-выплату сверх лимита казна не отправляет (аномальную заявку разбираем вручную).
    if (action === "approve" && Number(reqRow.sol) > MAX_PAYOUT_SOL) {
      return jsonResp({ error: `payout ${reqRow.sol} SOL exceeds cap ${MAX_PAYOUT_SOL} — handle manually from the treasury` }, 400);
    }

    // АТОМАРНЫЙ ЗАХВАТ: переводим pending → paying/rejecting условным UPDATE (WHERE status=pending).
    // Так двойной клик Approve/Reject не проходит: второй запрос обновит 0 строк и выйдет с 409.
    // Это чинит гонку, из-за которой казна могла заплатить несколько раз за одну продажу.
    const claimStatus = action === "reject" ? "rejecting" : "paying";
    const claimed = await fetch(`${SB_URL}/rest/v1/sell_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ status: claimStatus }),
    }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(claimed) || claimed.length === 0) return jsonResp({ error: "already handled" }, 409);

    if (action === "reject") {
      // Возвращаем удержанные PV в СЕРВЕРНЫЙ balances АТОМАРНО (только для чистой продажи PV; market/refund
      // PV не держат). pv_add_checked не гонится с параллельным начислением.
      if (reqRow.kind === "sell" && Number(reqRow.pv) > 0) {
        await ensureBalanceRow(reqRow.wallet);
        await rpcNum("pv_add_checked", { p_wallet: reqRow.wallet, p_delta: Number(reqRow.pv), p_min: 0 });
      }
      await fetch(`${SB_URL}/rest/v1/sell_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ status: "rejected" }) });
      return jsonResp({ ok: true, status: "rejected" });
    }

    // approve → выплата SOL с казны
    const setStatus = (status: string, sig?: string) =>
      fetch(`${SB_URL}/rest/v1/sell_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(sig ? { status, sig } : { status }) });
    if (!TREASURY_SECRET) {
      await setStatus("pending"); // ключа нет — ничего не отправляли, возвращаем в очередь
      return jsonResp({ error: "treasury key not set (TREASURY_SECRET)" }, 500);
    }
    const conn = new Connection(RPC, "confirmed");

    // Если у заявки уже ЕСТЬ подпись с прошлой попытки (approve после reset, когда confirm упал по
    // сети, но перевод мог уйти) — СНАЧАЛА проверяем её on-chain, прежде чем слать НОВЫЙ перевод.
    // Без этой проверки reset+approve после сетевого сбоя мог отправить казну платить дважды.
    if (reqRow.sig && (await txSucceeded(conn, reqRow.sig))) {
      await setStatus("paid", reqRow.sig);
      return jsonResp({ ok: true, status: "paid", sig: reqRow.sig });
    }

    try {
      const kp = Keypair.fromSecretKey(base58Decode(TREASURY_SECRET));
      const lamports = Math.round(Number(reqRow.sol) * LAMPORTS_PER_SOL);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(reqRow.wallet), lamports }),
      );
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize());
      // Подпись сохраняем СРАЗУ, до confirmTransaction — если подтверждение упадёт по сети, у reset+approve
      // будет чем свериться on-chain перед повторной отправкой (см. проверку выше).
      await setStatus("paying", sig);
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      await setStatus("paid", sig);
      return jsonResp({ ok: true, status: "paid", sig });
    } catch (e) {
      // Отправка/подтверждение упали. НЕ возвращаем в pending (tx мог уйти) — помечаем error,
      // чтобы избежать повторной выплаты; заявку разбираем вручную (или reset+approve свернёт сам,
      // если tx на самом деле прошла — см. проверку reqRow.sig выше).
      await setStatus("error");
      return jsonResp({ error: `payout failed: ${String(e)}` }, 500);
    }
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
