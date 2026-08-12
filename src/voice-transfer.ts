import type { Wallet } from "./profile";

export type DetectedWalletTransfer = {
  fromWalletId: string;
  toWalletId: string;
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function walletAliases(wallet: Wallet) {
  return [wallet.name, wallet.bankName, `${wallet.bankName} ${wallet.name}`, wallet.type === "cash" ? "cash" : ""]
    .map(normalized)
    .filter((value, index, values) => value.length >= 3 && values.indexOf(value) === index)
    .sort((a, b) => b.length - a.length);
}

export function detectMentionedWallet(text: string, wallets: Wallet[]): Wallet | null {
  const clean = ` ${normalized(text)} `;
  return wallets
    .filter((wallet) => !wallet.archived)
    .map((wallet) => ({ wallet, aliases: walletAliases(wallet) }))
    .sort((a, b) => (b.aliases[0]?.length || 0) - (a.aliases[0]?.length || 0))
    .find(({ aliases }) => aliases.some((alias) => clean.includes(` ${alias} `)))?.wallet ?? null;
}

export function detectWalletTransfer(text: string, wallets: Wallet[], activeWalletId: string): DetectedWalletTransfer | null {
  const clean = normalized(text);
  const isDeposit = /\b(?:main|mein)\b.{0,60}\b(?:jama\s+(?:karwaye|krwaye)|deposit(?:ed)?)\b/.test(clean);
  const isWithdrawal = /\bse\b.{0,60}\b(?:nikalwaye|withdraw(?:n|al)?)\b/.test(clean);
  if (!isDeposit && !isWithdrawal) return null;

  const available = wallets.filter((wallet) => !wallet.archived);
  const bank = available
    .filter((wallet) => wallet.type === "bank")
    .map((wallet) => ({ wallet, aliases: walletAliases(wallet) }))
    .sort((a, b) => (b.aliases[0]?.length || 0) - (a.aliases[0]?.length || 0))
    .find(({ aliases }) => aliases.some((alias) => ` ${clean} `.includes(` ${alias} `)))?.wallet;
  if (!bank) return null;

  const active = available.find((wallet) => wallet.id === activeWalletId);
  const cash = active?.type === "cash" ? active : available.find((wallet) => wallet.type === "cash");
  if (!cash || cash.id === bank.id) return null;

  return isWithdrawal
    ? { fromWalletId: bank.id, toWalletId: cash.id }
    : { fromWalletId: cash.id, toWalletId: bank.id };
}
