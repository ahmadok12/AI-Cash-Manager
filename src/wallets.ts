import type { Wallet } from "./profile";

export type WalletTransaction = {
  id: number;
  amount: number;
  direction: "IN" | "OUT";
  walletId?: string;
  transferId?: string;
};

export function migrateWalletTransactions<T extends WalletTransaction>(entries: T[], defaultWalletId: string): Array<T & { walletId: string }> {
  return entries.map((entry) => ({ ...entry, walletId: entry.walletId || defaultWalletId }));
}

export function walletTransactions<T extends WalletTransaction>(entries: T[], walletId: string) {
  return entries.filter((entry) => entry.walletId === walletId);
}

export function walletBalance(entries: WalletTransaction[], walletId: string) {
  return walletTransactions(entries, walletId).reduce(
    (sum, entry) => sum + (entry.direction === "IN" ? entry.amount : -entry.amount),
    0,
  );
}

export function totalBalance(entries: WalletTransaction[]) {
  return entries.reduce((sum, entry) => sum + (entry.direction === "IN" ? entry.amount : -entry.amount), 0);
}

export function walletLabel(wallet: Wallet) {
  return wallet.type === "bank" && wallet.bankName ? `${wallet.bankName} · ${wallet.name}` : wallet.name;
}

export function uniqueWalletName(wallets: Wallet[], name: string, exceptId = "") {
  const normalized = name.trim().toLocaleLowerCase();
  return Boolean(normalized) && !wallets.some((wallet) => wallet.id !== exceptId && wallet.name.trim().toLocaleLowerCase() === normalized);
}

export function transferEntries<T extends WalletTransaction>(entries: T[], transferId: string) {
  return entries.filter((entry) => entry.transferId === transferId);
}
