export type CurrencyCode = "PKR" | "CNY" | "USD" | "AED" | "GBP" | "EUR";
export type WalletType = "cash" | "bank";

export type Wallet = {
  id: string;
  type: WalletType;
  name: string;
  bankName: string;
  archived?: boolean;
};

export type CashbookProfile = {
  currency: CurrencyCode;
  wallets: Wallet[];
  activeWalletId: string;
  onboardingComplete: boolean;
  walletType: WalletType;
  walletName: string;
  bankName: string;
};

export const DEFAULT_WALLET: Wallet = { id: "wallet-cash", type: "cash", name: "Cash", bankName: "" };

export const DEFAULT_PROFILE: CashbookProfile = {
  currency: "PKR",
  wallets: [{ ...DEFAULT_WALLET }],
  activeWalletId: DEFAULT_WALLET.id,
  onboardingComplete: false,
  walletType: "cash",
  walletName: "Cash",
  bankName: "",
};

export const CURRENCY_OPTIONS: Array<{ code: CurrencyCode; label: string; prefix: string }> = [
  { code: "PKR", label: "Pakistani Rupee", prefix: "Rs." },
  { code: "CNY", label: "Chinese Yuan", prefix: "CNY" },
  { code: "USD", label: "US Dollar", prefix: "USD" },
  { code: "AED", label: "UAE Dirham", prefix: "AED" },
  { code: "GBP", label: "British Pound", prefix: "GBP" },
  { code: "EUR", label: "Euro", prefix: "EUR" },
];

export function currencyPrefix(currency: CurrencyCode) {
  return CURRENCY_OPTIONS.find((option) => option.code === currency)?.prefix ?? currency;
}

export function walletIsValid(wallet: Wallet) {
  return Boolean(wallet.name.trim() && (wallet.type === "cash" || wallet.bankName.trim()));
}

export function activeWallet(profile: CashbookProfile) {
  return profile.wallets.find((wallet) => wallet.id === profile.activeWalletId && !wallet.archived)
    ?? profile.wallets.find((wallet) => !wallet.archived)
    ?? profile.wallets[0]
    ?? { ...DEFAULT_WALLET };
}

export function normalizeProfile(value: unknown): CashbookProfile {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROFILE, wallets: [{ ...DEFAULT_WALLET }] };
  const source = value as Partial<CashbookProfile>;
  const currency = CURRENCY_OPTIONS.some((option) => option.code === source.currency)
    ? source.currency as CurrencyCode
    : "PKR";
  const legacyType = source.walletType === "bank" ? "bank" : "cash";
  const legacyWallet: Wallet = {
    id: DEFAULT_WALLET.id,
    type: legacyType,
    name: String(source.walletName || (legacyType === "bank" ? "Bank account" : "Cash")),
    bankName: legacyType === "bank" ? String(source.bankName || "") : "",
  };
  const suppliedWallets = Array.isArray(source.wallets) ? source.wallets : [];
  const seen = new Set<string>();
  const wallets: Wallet[] = suppliedWallets.map((item, index) => {
    const raw = item as Partial<Wallet>;
    let id = String(raw.id || `wallet-${index + 1}`);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const type: WalletType = raw.type === "bank" ? "bank" : "cash";
    return {
      id,
      type,
      name: String(raw.name || (type === "bank" ? "Bank account" : "Cash")),
      bankName: type === "bank" ? String(raw.bankName || "") : "",
      archived: Boolean(raw.archived),
    };
  }).filter(walletIsValid);
  if (!wallets.length) wallets.push(legacyWallet);
  const requestedActive = String(source.activeWalletId || "");
  const selected = wallets.find((wallet) => wallet.id === requestedActive && !wallet.archived)
    ?? wallets.find((wallet) => !wallet.archived)
    ?? wallets[0];
  return {
    currency,
    wallets,
    activeWalletId: selected.id,
    onboardingComplete: Boolean(source.onboardingComplete),
    walletType: selected.type,
    walletName: selected.name,
    bankName: selected.bankName,
  };
}

export function withActiveWallet(profile: CashbookProfile, walletId: string): CashbookProfile {
  const wallet = profile.wallets.find((item) => item.id === walletId && !item.archived) ?? activeWallet(profile);
  return { ...profile, activeWalletId: wallet.id, walletType: wallet.type, walletName: wallet.name, bankName: wallet.bankName };
}

export function profileIsValid(profile: CashbookProfile) {
  if (!Array.isArray(profile.wallets)) {
    return walletIsValid({ id: "legacy", type: profile.walletType, name: profile.walletName, bankName: profile.bankName });
  }
  const available = profile.wallets.filter((wallet) => !wallet.archived);
  return available.length > 0 && available.every(walletIsValid);
}
