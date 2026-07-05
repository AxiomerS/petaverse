// Supabase Edge Function "market-buy": проверяет devnet-оплату и проводит сделку на маркете.
// БЕЗ внешних зависимостей (только получаем SOL — казну не подписываем).
// Клиент присылает { wallet /*покупатель*/, signature, type: 'sale'|'exclusive', refId }. Мы:
//  1) читаем транзакцию и убеждаемся, что wallet заплатил в treasury достаточную сумму;
//  2) пишем подпись в market_purchases (PK) → повтор даёт 409, деньги не тратятся дважды;
//  3) sale     → отдаём лот покупателю (в его сейв), удаляем лот, создаём заявку на выплату продавцу;
//     exclusive → уменьшаем сток эксклюзива и выдаём пета покупателю (SOL остаётся у казны).
const RPC = "https://api.devnet.solana.com";
const TREASURY = "RjUd1g9rD6ZR1zZMwy5MgfupBGKstvdBLvJ6N7VaDoH";
const FEE_BPS = 500; // 5% комиссия казны с продажи между игроками
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

// Выдать вид питомца в сейв покупателя (ownedSpecies + progress + имя). Возвращает false, если уже владеет.
function grantPet(data: any, species: string, level: number, buffs: unknown, name?: string): boolean {
  const owned: string[] = data.ownedSpecies ?? [];
  if (owned.includes(species)) return false; // модель: один экземпляр на вид
  data.ownedSpecies = [...owned, species];
  data.progress = { ...(data.progress ?? {}), [species]: { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: level || 1, buffs: buffs ?? [] } };
  if (name) data.names = { ...(data.names ?? {}), [species]: name };
  return true;
}

async function loadSave(wallet: string): Promise<any | null> {
  const rows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  return rows?.[0]?.data ?? null;
}
async function writeSave(wallet: string, data: any): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { wallet, signature, type, refId } = await req.json();
    if (!wallet || !signature || !refId || (type !== "sale" && type !== "exclusive")) return jsonResp({ error: "missing fields" }, 400);

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

    // Проверяем перевод: wallet — плательщик (индекс 0), treasury получил lamports.
    const keys: string[] = tx.transaction.message.accountKeys;
    const tIdx = keys.indexOf(TREASURY);
    const wIdx = keys.indexOf(wallet);
    if (tIdx < 0 || wIdx !== 0) return jsonResp({ error: "bad accounts" }, 400);
    const paid = Number(tx.meta.postBalances[tIdx]) - Number(tx.meta.preBalances[tIdx]);
    if (paid <= 0) return jsonResp({ error: "no payment to treasury" }, 400);

    // 2) ЗАПИСЫВАЕМ ПЛАТЁЖ ПЕРВЫМ (signature — PK): дедуп + фиксация, что деньги пришли в казну.
    //    После этой точки любая неудача сделки → заявка на ВОЗВРАТ SOL (деньги не застревают в казне).
    const rec = await fetch(`${SB_URL}/rest/v1/market_purchases`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ signature, buyer: wallet, kind: type, ref_id: refId, seller: "", lamports: paid, created_at: new Date().toISOString() }),
    });
    if (rec.status === 409) return jsonResp({ error: "already processed" }, 409);
    if (!rec.ok) return jsonResp({ error: "record failed" }, 500);

    // Возврат: заявка на выплату всей уплаченной суммы обратно покупателю (админ подтвердит в панели).
    const refund = async (reason: string) => {
      await fetch(`${SB_URL}/rest/v1/sell_requests`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ id: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet, pv: 0, sol: +(paid / 1e9).toFixed(4), kind: "refund", status: "pending", created_at: new Date().toISOString() }),
      });
      return jsonResp({ error: `${reason} — refund queued`, refund: true }, 409);
    };

    // 3) Находим лот/эксклюзив и его цену.
    let priceSol: number;
    let seller = "";
    let species: string;
    let level = 1;
    let buffs: unknown = [];
    let name: string | undefined;

    if (type === "sale") {
      const rows = await fetch(`${SB_URL}/rest/v1/listings?id=eq.${encodeURIComponent(refId)}&kind=eq.sale&select=*`, { headers: sbHeaders() }).then((r) => r.json());
      const lot = rows?.[0];
      if (!lot) return refund("listing gone");
      priceSol = Number(lot.price);
      seller = lot.seller;
      species = lot.species;
      level = lot.level ?? 1;
      buffs = lot.buffs ?? [];
      name = lot.name || undefined;
    } else {
      const rows = await fetch(`${SB_URL}/rest/v1/exclusives?id=eq.${encodeURIComponent(refId)}&select=*`, { headers: sbHeaders() }).then((r) => r.json());
      const ex = rows?.[0];
      if (!ex || !ex.active || (ex.stock ?? 0) <= 0) return refund("exclusive sold out");
      priceSol = Number(ex.price);
      species = ex.species;
      name = ex.name || undefined;
    }
    if (paid < Math.round(priceSol * 1e9)) return refund("underpaid");

    // 4) Проверяем покупателя: сейв есть и он ещё не владеет этим видом (иначе дубль — блокируем ДО клейма).
    const buyer = await loadSave(wallet);
    if (!buyer) return refund("no save");
    if ((buyer.ownedSpecies ?? []).includes(species)) return refund("you already own this pet");

    // 5) АТОМАРНО «забираем» товар, чтобы два одновременных покупателя (две разные tx) не получили
    //    одного пета: продажу — условным DELETE лота; эксклюзив — атомарным decrement через RPC.
    if (type === "sale") {
      const claimed = await fetch(`${SB_URL}/rest/v1/listings?id=eq.${encodeURIComponent(refId)}&kind=eq.sale`, {
        method: "DELETE",
        headers: sbHeaders({ Prefer: "return=representation" }),
      }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(claimed) || claimed.length === 0) return refund("listing already sold");
      const lot = claimed[0]; // авторитетные данные лота на момент захвата
      species = lot.species;
      level = lot.level ?? 1;
      buffs = lot.buffs ?? [];
      name = lot.name || undefined;
      seller = lot.seller;
    } else {
      // buy_exclusive(p_id): один UPDATE ... WHERE stock>0 → атомарно уменьшает сток. Пусто = распродан/гонка.
      const claimed = await fetch(`${SB_URL}/rest/v1/rpc/buy_exclusive`, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ p_id: refId }),
      }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(claimed) || claimed.length === 0) return refund("exclusive sold out");
    }

    // 6) Выдаём пета покупателю (владение уже проверено на шаге 4).
    grantPet(buyer, species, level, buffs, name);
    await writeSave(wallet, buyer);

    // 7) Продажа между игроками → заявка продавцу на выплату (минус комиссия казны). Ретрай при сбое
    //    (id — PK, поэтому повторная удачная вставка = 409, считаем успехом → без двойной выплаты).
    if (type === "sale") {
      const payout = +((priceSol * (10000 - FEE_BPS)) / 10000).toFixed(4);
      const body = JSON.stringify({ id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet: seller, pv: 0, sol: payout, kind: "market", status: "pending", created_at: new Date().toISOString() });
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        const r = await fetch(`${SB_URL}/rest/v1/sell_requests`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal" }), body });
        ok = r.ok || r.status === 409;
        if (!ok) await new Promise((res) => setTimeout(res, 500));
      }
      if (!ok) console.error("payout row insert failed for seller", seller, "sig", signature);
    }

    return jsonResp({ ok: true, save: buyer });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
