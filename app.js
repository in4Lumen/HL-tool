// app.js — связывает интерфейс с логикой. v9: авто-агент + preview действий + vault I/O.
import { fetchAccount, fetchVault, fetchSpot, fetchTransferFee, withdrawToArbitrum, withdrawFromVault } from "./actions.js";
import { approveAgent, generateAgentKey, agentAccountFromKey } from "./actions.js";
import { connectWallet, onAccountsChanged } from "./wallet.js";

const $ = (id) => document.getElementById(id);
const DEDUCT_FEE_USD = 0.2; // фикс-комиссия вывода, сервер вычитает из суммы
const GAS_BUFFER_USD = 0.01; // консервативный буфер под EVM-gas (официальный ~0.0011)
const DUST_USD = 0.01; // пыль: всё, что меньше цента, считаем нулём (как официальный фронт)
const AGENT_KEY_LS = "hl_agent_key"; // localStorage-ключ агента
const VERSION = "1.0.0"; // версия инструмента — менять здесь при каждом релизе
let last = { acc: null, vault: null, spot: null, fee: null }; // последние полученные данные
let walletCtx = null; // { address, wallet, provider } — появится после подключения

function log(t) {
  $("log").textContent += t + "\n";
  $("log").scrollTop = $("log").scrollHeight;
}
function err(t) { log("❌ " + t); }
function fmt(x) {
  if (x == null) return "—";
  return x.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/,/g, " ");
}
function okAddr(a) { return /^0x[0-9a-fA-F]{40}$/.test(a); }
function gw() { return $("gateway").value.trim().replace(/\/+$/, ""); }

// ---------- Агент ----------
function refreshAgentStatus() {
  const el = $("agentStatus");
  const key = localStorage.getItem(AGENT_KEY_LS);
  if (!key) {
    el.textContent = "Agent: ✗ not approved (auto-created on first vault op)";
    el.className = "status";
    return;
  }
  el.textContent = "Agent: ✓ " + agentAccountFromKey(key).address.slice(0, 10) + "…";
  el.className = "status ok";
}
// Общая: через N секунд после успеха имитирует клик по Check Balance,
// чтобы пользователь увидел свежие балансы без ручного действия.
async function autoRefreshAfterSuccess(delayMs) {
  log("→ балансы обновятся через " + (delayMs / 1000) + " сек…");
  await new Promise(r => setTimeout(r, delayMs));
  $("balance").click();
}

// Гарантирует наличие агента: если ключа нет — создаёт и одобряет (popup Rabby).
// Если одобрение упало — ключ НЕ сохраняется (чистая retry-логика).
async function ensureAgent() {
  const key = localStorage.getItem(AGENT_KEY_LS);
  if (key) return agentAccountFromKey(key);
  log("→ Агента нет: создаю ключ и запрашиваю одобрение (popup в кошельке)…");
  const newKey = generateAgentKey();
  const acc = agentAccountFromKey(newKey);
  const res = await approveAgent(gw(), walletCtx.wallet, acc.address);
  log("✓ approveAgent response: " + JSON.stringify(res));
  localStorage.setItem(AGENT_KEY_LS, newKey);
  refreshAgentStatus();
  return acc;
}

// ---------- Состояние ----------
function resetBalances() {
  last = { acc: null, vault: null, spot: null, fee: null };
  $("vaultBal").textContent = "Vault (HLP): —";
  $("accBal").textContent   = "Available Balance: —";
  $("lockStatus").textContent = "—";
  $("lockStatus").className = "status";
  $("hlpAmt").value = "";
  $("arbAmt").value = "";
}

function isUnlocked() {
  if (!last.acc || !last.vault) return false;
  const now = last.acc.raw?.time ?? Date.now();
  return !(last.vault.lockedUntil != null && last.vault.lockedUntil > now);
}

// Единый пул средств: Perps + Spot (на новых аккаунтах депозиты живут в Spot)
function availableBridge() {
  return (last.acc?.withdrawable ?? 0) + (last.spot?.usdc ?? 0);
}
// Потолок вывода как в официальном окне: available − activation fee (живое значение)
function maxBridge() {
  return Math.max(availableBridge() - (last.fee ?? 1), 0);
}

// Единая точка решения об активности кнопок вывода
function refreshActionButtons() {
  const connected = !!walletCtx;
  const checked = !!last.acc && !!last.vault && !!last.spot;

  $("outHlp").disabled = !(
    connected && checked && last.vault?.equity > DUST_USD && isUnlocked()
  );
  $("outArb").disabled = !(
    connected && checked && maxBridge() > DEDUCT_FEE_USD
  );
  
}

// Стартовое состояние: всё сброшено, кнопки вывода серые
resetBalances();
refreshActionButtons();
refreshAgentStatus();
$("appVer").textContent = "v" + VERSION;
log("HL Recovery Terminal v" + VERSION);

// ---------- Кошелёк ----------
$("connect").addEventListener("click", async () => {
  $("connect").disabled = true;
  try {
    log("→ Connect Wallet…");
    walletCtx = await connectWallet();
    $("who").textContent = "Connected: " + walletCtx.address;
    $("who").classList.add("ok");
    if (!$("checkAddr").value.trim()) $("checkAddr").value = walletCtx.address;
    if (!$("arbDest").value.trim()) $("arbDest").value = walletCtx.address;
    $("connect").textContent = "✓ Wallet Connected";
    log("✓ Connected: " + walletCtx.address);
    refreshActionButtons();
  } catch (e) {
    $("connect").disabled = false;
    err("Connect: " + (e.message || e));
  }
});

onAccountsChanged(async (accs) => {
  if (!accs || !accs.length) {
    walletCtx = null;
    $("who").textContent = "Not connected";
    $("who").className = "status";
    $("connect").disabled = false;
    $("connect").textContent = "🔌 Connect Wallet";
    resetBalances();
    refreshActionButtons();
    refreshAgentStatus();
    log("⚠ Кошелёк отключён в браузере");
  } else {
    const old = walletCtx?.address;
    log("⚠ В кошельке сменился аккаунт: " + accs[0]);
    resetBalances(); // старые балансы относятся к другому адресу
    try {
      walletCtx = await connectWallet(); // обновляем адрес (обычно без попапа)
      $("who").textContent = "Connected: " + walletCtx.address;
      $("who").classList.add("ok");
      if (old && $("checkAddr").value.trim().toLowerCase() === old) $("checkAddr").value = walletCtx.address;
      if (old && $("arbDest").value.trim().toLowerCase() === old)  $("arbDest").value = walletCtx.address;
    } catch (e) {
      err("Reconnect: " + (e.message || e));
    }
    refreshActionButtons();
    refreshAgentStatus();
  }
});

// ---------- Проверка баланса ----------
$("balance").addEventListener("click", async () => {
  const user = $("checkAddr").value.trim();
  const vault = $("vaultAddr").value.trim();
  if (!okAddr(user))  return err("Balance Check Address: нужен 0x + 40 символов");
  if (!okAddr(vault)) return err("HLP Vault Address: нужен 0x + 40 символов");

  $("hlpAmt").value = "";
  $("arbAmt").value = "";

  try {
    log("→ запрашиваю балансы для " + user.slice(0, 10) + "…");
    const [acc, vl, sp, fee] = await Promise.all([
      fetchAccount(gw(), user),
      fetchVault(gw(), vault, user),
      fetchSpot(gw(), user),
      fetchTransferFee(gw(), user),
    ]);
    last = { acc, vault: vl, spot: sp, fee };
    const totalAvailable = (acc.withdrawable || 0) + sp.usdc;
    $("vaultBal").textContent = "Vault (HLP): " + fmt(vl.equity) + " USDC";
    $("accBal").textContent   = "Available Balance: " + fmt(totalAvailable) + " USDC";
    updateLockStatus(acc, vl);
    refreshActionButtons();
    log("✓ account raw: " + JSON.stringify(acc.raw));
    log("✓ vault raw: " + JSON.stringify(vl.raw));
    log("✓ spot raw: " + JSON.stringify(sp.raw));
    log("✓ transfer fee: " + fee);
    if (fee > 0) {
      log("⚠ Activation gas fee (one-time, new account): " + fmt(fee) + " USDC — MAX уменьшен на эту сумму.");
    }
  } catch (e) {
    err("Ошибка запроса: " + e.message);
  }
});

// ---------- MAX ----------
$("maxHlp").addEventListener("click", () => {
  if (last.vault?.equity != null && last.vault.equity > DUST_USD) {
    $("hlpAmt").value = last.vault.equity.toFixed(2);
  } else {
    err("MAX: сначала выполните Check Balance");
  }
});
$("maxArb").addEventListener("click", () => {
  if (last.acc && last.spot && last.fee != null) {
    $("arbAmt").value = (Math.floor(maxBridge() * 100) / 100).toFixed(2);
  } else {
    err("MAX: сначала выполните Check Balance");
  }
});

// ---------- Bridge to Arbitrum ----------
$("outArb").addEventListener("click", async () => {
  if (!walletCtx) return err("Bridge: сначала подключите кошелёк");
  const dest = $("arbDest").value.trim();
  const amountStr = $("arbAmt").value.trim();
  const amount = parseFloat(amountStr);
  if (!okAddr(dest)) return err("Bridge: Destination — нужен 0x + 40 символов");
  if (!amountStr || isNaN(amount)) return err("Bridge: введите сумму");
  if (amount <= DEDUCT_FEE_USD) {
    return err("Bridge: сумма должна быть больше комиссии " + DEDUCT_FEE_USD + " USDC");
  }
  const capRaw = maxBridge();
  const cap = Math.floor(capRaw * 100) / 100; // тот же floor, что вставляет MAX
  if (amount > cap) {
    return err("Bridge: сумма превышает MAX " + fmt(cap) + " USDC");
  }
  // sent = min(введённая сумма, cap − gas buffer). При ручном вводе ниже потолка буфер не вмешивается.
  const sent = Math.min(amount, Math.max(capRaw - GAS_BUFFER_USD, 0));
  if (sent <= DEDUCT_FEE_USD) {
    return err("Bridge: сумма после газового буфера меньше комиссии " + DEDUCT_FEE_USD);
  }

  $("outArb").disabled = true;
  try {
    log("→ Bridge: введено " + amount.toFixed(2) + ", отправляем " + sent.toFixed(6) + " (буфер газа " + GAS_BUFFER_USD + ") → " + dest.slice(0, 10) + "…");
    log("→ получатель получит ≈ " + (sent - DEDUCT_FEE_USD).toFixed(2) + " USDC");
    const res = await withdrawToArbitrum(gw(), walletCtx.wallet, dest, sent.toFixed(6));
    log("✅ Bridge SUCCESS: средства списаны с Hyperliquid, в Arbitrum придут через ≈5 мин", "ok");
    await autoRefreshAfterSuccess(3000);
  } catch (e) {
    err("Bridge: " + (e.message || e));
  } finally {
    refreshActionButtons();
  }
});

// ---------- Withdraw from HLP ----------
$("outHlp").addEventListener("click", async () => {
  if (!walletCtx) return err("HLP: сначала подключите кошелёк");
  const vault = $("vaultAddr").value.trim();
  const amountStr = $("hlpAmt").value.trim();
  const amount = parseFloat(amountStr);
  if (!okAddr(vault)) return err("HLP: Vault address — нужен 0x + 40 символов");
  if (!amountStr || isNaN(amount) || amount <= 0) return err("HLP: введите сумму больше 0");
  if (!last.vault || last.vault.equity <= DUST_USD) return err("HLP: нет позиции в волте");
  if (!isUnlocked()) return err("HLP: вывод заблокирован, дождитесь разблокировки");

  // Агент (создастся автоматически при первом клике, если его нет)
  let agent;
  try {
    agent = await ensureAgent();
  } catch (e) {
    return err("Agent: " + (e.message || e));
  }

  const maxMicro = Math.floor(last.vault.equity * 1e6);
  const usdMicro = Math.min(Math.round(amount * 1e6), maxMicro);
  const action = { vaultAddress: vault, isDeposit: false, usd: usdMicro };
  const json = JSON.stringify(action, null, 2);
  console.log("[vaultTransfer action]\n" + json);
  if (!window.confirm("ВЫВЕРКА ДЕЙСТВИЯ (withdrawFromVault):\n\n" + json + "\n\nOK — отправить | Отмена — отклонить")) {
    return log("⚠ Отменено в окне выверки");
  }

  $("outHlp").disabled = true;
  try {
    log("→ HLP withdraw: " + (usdMicro / 1e6).toFixed(6) + " USDC из волта " + vault.slice(0, 10) + "…");
    const res = await withdrawFromVault(gw(), agent, vault, usdMicro);
    log("✅ HLP SUCCESS: средства переведены из волта в мастер-аккаунт", "ok");
    await autoRefreshAfterSuccess(3000);
  } catch (e) {
    // Если агент просрочен/отозван — очищаем ключ, чтобы следующий клик создал нового
    if (/agent/i.test(e.message || "")) {
      localStorage.removeItem(AGENT_KEY_LS);
      refreshAgentStatus();
      err("HLP: агент истёк/отозван — нажмите кнопку ещё раз, создастся новый");
    } else {
      err("HLP: " + (e.message || e));
    }
  } finally {
    refreshActionButtons();
  }
});

// ---------- Строка статуса блокировки (только текст; кнопки решает refreshActionButtons) ----------
function updateLockStatus(acc, vl) {
  const el = $("lockStatus");
  el.className = "status";

  if (!vl.equity || vl.equity < DUST_USD) {
    el.textContent = "— No HLP position found";
    return;
  }

  const now = acc.raw?.time ?? Date.now();
  if (vl.lockedUntil != null && vl.lockedUntil > now) {
    const left = vl.lockedUntil - now;
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const until = new Date(vl.lockedUntil).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    });
    el.textContent = "🔒 Withdrawal locked: " + d + " d " + h + " h left (until " + until + " UTC)";
    el.classList.add("warn");
  } else {
    el.textContent = "🔓 Withdrawal available";
    el.classList.add("ok");
  }
}