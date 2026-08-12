// actions.js — запросы к Hyperliquid через официальный TS SDK.
import { HttpTransport, InfoClient, ExchangeClient } from "https://esm.sh/@nktkas/hyperliquid@0.33.3";
import { privateKeyToAccount } from "https://esm.sh/viem/accounts";

let infoClient = null;
let clientGw = null;

// Один клиент на текущий шлюз; при смене шлюза — пересоздание
function getInfo(gatewayUrl) {
  if (!infoClient || clientGw !== gatewayUrl) {
    const transport = new HttpTransport({ apiUrl: gatewayUrl });
    infoClient = new InfoClient({ transport });
    clientGw = gatewayUrl;
  }
  return infoClient;
}

// Аккаунт: стоимость и доступно к выводу (clearinghouseState)
export async function fetchAccount(gatewayUrl, user) {
  const st = await getInfo(gatewayUrl).clearinghouseState({ user });
  return {
    accountValue: parseFloat(st.marginSummary?.accountValue ?? 0),
    withdrawable: parseFloat(st.withdrawable ?? 0),
    raw: st,
  };
}

// Доля пользователя в заданном волте (userVaultEquities)
export async function fetchVault(gatewayUrl, vaultAddress, user) {
  const list = await getInfo(gatewayUrl).userVaultEquities({ user });
  const entry = (list || []).find(
    (v) => (v.vaultAddress || "").toLowerCase() === vaultAddress.toLowerCase()
  );
  return {
    equity: entry ? parseFloat(entry.equity) : 0,
    lockedUntil: entry ? entry.lockedUntilTimestamp : null,
    raw: list,
  };
}

// Spot-баланс: единый пул USDC (spotClearinghouseState).
export async function fetchSpot(gatewayUrl, user) {
  const st = await getInfo(gatewayUrl).spotClearinghouseState({ user });
  const balances = st.balances || [];
  const usdc = balances.find((b) => (b.coin || "").includes("USDC"));
  const total = usdc ? parseFloat(usdc.total || 0) : 0;
  const hold  = usdc ? parseFloat(usdc.hold  || 0) : 0;
  return { usdc: total - hold, raw: st };
}

// Activation gas fee (preTransferCheck): разовый сбор за первую транзакцию нового аккаунта.
export async function fetchTransferFee(gatewayUrl, source) {
  const r = await getInfo(gatewayUrl).preTransferCheck({
    source,
    user: "0x0000000000000000000000000000000000000000",
  });
  return parseFloat(r.fee ?? 1);
}

// Вывод в Arbitrum: sendToEvmWithData — официальный путь unified-аккаунта.
// signatureChainId НЕ хардкодим — SDK возьмёт из wallet.getChainId() (текущая сеть кошелька).
// destinationChainId 3 — внутренняя метка Arbitrum в реестре Hyperliquid (не зависит от сети).
export async function withdrawToArbitrum(gatewayUrl, wallet, destination, amount) {
  const transport = new HttpTransport({ apiUrl: gatewayUrl });
  const exchange = new ExchangeClient({ transport, wallet });
  return await exchange.sendToEvmWithData({
    token: "USDC",
    amount,
    sourceDex: "spot",
    destinationRecipient: destination,
    addressEncoding: "hex",
    destinationChainId: 3,
    gasLimit: 200000,
    data: "0x",
  });
}

// Вывод из волта: vaultTransfer с isDeposit: false.
// usd — целое в микро-единицах (1 USDC = 1_000_000), как требует документация.
export async function withdrawFromVault(gatewayUrl, wallet, vaultAddress, usdMicro) {
  const transport = new HttpTransport({ apiUrl: gatewayUrl });
  const exchange = new ExchangeClient({ transport, wallet });
  return await exchange.vaultTransfer({
    vaultAddress,
    isDeposit: false,
    usd: usdMicro,
  });
}

// [TEMP] ===== начало: тестовый депозит (удалить перед релизом) =====
export async function depositToVault(gatewayUrl, wallet, vaultAddress, usdMicro) {
  const transport = new HttpTransport({ apiUrl: gatewayUrl });
  const exchange = new ExchangeClient({ transport, wallet });
  return await exchange.vaultTransfer({
    vaultAddress,
    isDeposit: true,
    usd: usdMicro,
  });
}
// [TEMP] ===== конец: тестовый депозит =====

// ---------- Агент для L1-действий (vaultTransfer) ----------
// Ключ генерируется локально, живёт в localStorage.
// Агент НЕ может выводить средства наружу: мост/withdraw3 — только мастер.
export function generateAgentKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function agentAccountFromKey(keyHex) {
  return privateKeyToAccount(keyHex);
}

// Одобрение агента: user-signed → popup мастер-кошелька.
// Срок 14 дней (как официальный фронт), имя hl-recovery (не перезаписывает безымянный агент).
export async function approveAgent(gatewayUrl, wallet, agentAddress) {
  const transport = new HttpTransport({ apiUrl: gatewayUrl });
  const exchange = new ExchangeClient({ transport, wallet });
  const timestamp = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 дней
  return await exchange.approveAgent({
    agentAddress,
    agentName: `hl-recovery valid_until ${timestamp}`,
  });
}