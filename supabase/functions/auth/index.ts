// Supabase Edge Function "auth": проверяет подпись кошелька Phantom и выдаёт Supabase-JWT.
// БЕЗ внешних зависимостей (только встроенный Deno) — чтобы бандлер ничего не качал и не падал по тайм-ауту.
// Клиент шлёт {wallet(base58), message, signature(hex)}. Проверяем ed25519-подпись через Web Crypto,
// и если верна + свежая — возвращаем JWT (role=authenticated, claim wallet).

const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const MAX_AGE_MS = 5 * 60 * 1000; // подпись действительна 5 минут

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error("bad base58");
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${head}.${body}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { wallet, message, signature } = await req.json();
    if (!wallet || !message || !signature) return jsonResp({ error: "missing fields" }, 400);

    const ts = /ts:(\d+)/.exec(message)?.[1];
    if (!message.includes(wallet) || !ts) return jsonResp({ error: "bad message" }, 400);
    if (Math.abs(Date.now() - Number(ts)) > MAX_AGE_MS) return jsonResp({ error: "expired" }, 400);

    const pub = base58Decode(wallet);
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, hexToBytes(signature), new TextEncoder().encode(message));
    if (!ok) return jsonResp({ error: "invalid signature" }, 401);

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ role: "authenticated", sub: wallet, wallet, iat: now, exp: now + 60 * 60 * 24 * 7 });
    return jsonResp({ token });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
