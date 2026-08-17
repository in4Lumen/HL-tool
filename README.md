# HL Recovery Tool

> Withdraw USDC from Hyperliquid when the official interface blocks you
> ("Your address has been flagged as high risk by a third-party screening tool").

**Live app:** https://in4Lumen.github.io/HL-tool/

This tool performs the same standard actions as the official UI — withdrawal
from the **HLP vault** (after the 4-day lock) and **bridge to Arbitrum** from
your **main Hyperliquid account** — directly in your browser. No server, no
backend, no keys collection.

## Features

- **Withdraw from HLP vault** — respects the 4-day lock, shows a live countdown
- **Bridge to Arbitrum** from main account — arrives in ~5 minutes
- **Auto-created agent** for vault operations (can move funds vault→main
  account only, never out of the account); key stays in localStorage
- **Destination locked by default** — the Arbitrum recipient field is your
  connected address; editing requires an explicit unlock checkbox
- **Read-only balance check** for any address — actions are automatically
  disabled when viewing an external address
- **MAX like the official UI** — accounts for the one-time activation fee
- **Action preview** (`window.confirm`) before every vault operation

## Security model

- Static HTML/JS only; every request goes to `api.hyperliquid.xyz`
- Your keys never leave your browser — signing happens inside the wallet
  extension
- Agent key is generated locally and stored in `localStorage`
- You approve the agent with one wallet popup, 14-day expiry
- The agent **cannot** bridge or withdraw funds from your main account
- Open source — read the code before use

## Fees

HL Recovery Tool charges **no commission**. The only costs are Hyperliquid
protocol fees — identical to what the official frontend charges:

| Operation | Fee |
|---|---|
| HLP vault → main account | free |
| Bridge to Arbitrum | 0.2 USDC (deducted from the amount) |
| One-time activation fee (first bridge) | ~1 USDC (paid once per account) |

## Quick start

1. Open the live app
2. **Connect Wallet**
3. **Check Balance** — your address is filled in automatically
4. **Withdraw from HLP vault** → confirm the preview → sign the agent
   approval (first time only) and the vault withdrawal
5. **Bridge to Arbitrum** — funds arrive in ~5 minutes

## Disclaimer

Provided "as is" for account owners who lost access to the official UI.
Not financial or legal advice. You sign every transaction with your own wallet
and are solely responsible for them.

## License

MIT