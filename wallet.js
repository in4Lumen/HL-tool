// wallet.js — подключение горячего кошелька (стандарт EIP-1193).
// Не содержит логики Hyperliquid, ключей и DOM.
// Возвращает wallet-объект, совместимый с @nktkas/hyperliquid.

function getProvider() {
  if (!window.ethereum) {
    throw new Error("Кошелёк не найден: установите Rabby или MetaMask и обновите страницу");
  }
  return window.ethereum;
}

// Подключение: попап кошелька → адрес → готовый wallet-объект
export async function connectWallet() {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) {
    throw new Error("Кошелёк не вернул ни одного адреса");
  }
  const address = accounts[0].toLowerCase();

  const wallet = {
    // Подпись EIP-712 (для SDK): принимает typedData, отдаёт подпись
    async signTypedData(typedData) {
      console.log("[signTypedData] domain:", typedData.domain);
      console.log("[signTypedData] primaryType:", typedData.primaryType);
      console.log("[signTypedData] message:", typedData.message);
      
      try {
        const json = JSON.stringify(typedData);
        console.log("[signTypedData] JSON length:", json.length);
        return await provider.request({
          method: "eth_signTypedData_v4",
          params: [address, json],
        });
      } catch (e) {
        console.error("[signTypedData] ERROR:", e);
        console.error("[signTypedData] Error stack:", e.stack);
        throw e;
      }
    },
    async getAddresses() {
      return [address];
    },
    async getChainId() {
      const hex = await provider.request({ method: "eth_chainId" });
      return parseInt(hex, 16);
    },
  };

  return { address, wallet, provider };
}

// Смена/отключение аккаунта в кошельке → колбэк (безопасно без кошелька)
export function onAccountsChanged(cb) {
  if (!window.ethereum || typeof window.ethereum.on !== "function") return;
  window.ethereum.on("accountsChanged", cb);
}