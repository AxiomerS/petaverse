// Минимальная интеграция кошелька Phantom — без тяжёлых adapter-библиотек.
// Phantom внедряет провайдер в window.phantom.solana (или window.solana).
// Здесь только подключение/отключение и получение адреса (= ID игрока).

type PublicKeyLike = { toString(): string };

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey: PublicKeyLike | null;
  isConnected: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKeyLike }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
  on: (event: string, handler: (arg: unknown) => void) => void;
  removeAllListeners: (event: string) => void;
};

// Подписать сообщение кошельком и вернуть подпись в hex (для отправки в auth-функцию).
export async function signMessageHex(provider: PhantomProvider, message: string): Promise<string> {
  const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  return Array.from(signature).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Куда отправлять, если Phantom не установлен.
export const PHANTOM_INSTALL_URL = "https://phantom.app/download";

// Достаём провайдер Phantom, если расширение установлено.
export function getPhantom(): PhantomProvider | null {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const provider = w.phantom?.solana ?? w.solana;
  return provider && provider.isPhantom ? provider : null;
}

// Короткий вид адреса: ABCD…WXYZ
export function shortAddress(addr: string): string {
  return addr.length > 9 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
