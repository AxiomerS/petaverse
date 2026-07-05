// Реальная покупка PV за SOL (devnet). Клиент формирует перевод SOL на treasury и отправляет
// через Phantom; дальше серверная функция проверит транзакцию в блокчейне и начислит PV.
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getPhantom } from "./wallet";

// ⚙️ Конфиг покупки (devnet). Для mainnet поменять RPC и, при желании, RATE/пакеты.
export const TREASURY = "RjUd1g9rD6ZR1zZMwy5MgfupBGKstvdBLvJ6N7VaDoH"; // кошелёк-казна (куда идут оплаты)
export const SOLANA_RPC = "https://api.devnet.solana.com";
export const SOL_PV_RATE = 7500; // покупка: 1 SOL → 7 500 PV
export const SOL_SELL_RATE = 10000; // продажа: 10 000 PV → 1 SOL (спред в пользу казны)
export const SOL_SELL_PACKS = [5000, 10000, 25000, 50000]; // варианты продажи в PV
export const SOL_BUY_PACKS = [0.05, 0.1, 0.5, 1]; // варианты покупки в SOL
export const SOL_MARKET_FEE_BPS = 500; // комиссия казны с продажи пета между игроками (5%) — держим в синхроне с edge market-buy

// Отправить SOL на treasury через Phantom. Возвращает подпись транзакции или null (отмена/ошибка).
export async function sendSolPayment(sol: number): Promise<string | null> {
  const provider = getPhantom();
  if (!provider || !provider.publicKey) return null;
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const from = new PublicKey(provider.publicKey.toString());
  const to = new PublicKey(TREASURY);
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );
  const { signature } = await provider.signAndSendTransaction(tx);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
