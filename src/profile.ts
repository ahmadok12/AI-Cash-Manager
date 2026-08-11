export type CurrencyCode = "PKR" | "CNY" | "USD" | "AED" | "GBP" | "EUR";
export type WalletType = "cash" | "bank";

export type CashbookProfile = {
  currency: CurrencyCode;
  walletType: WalletType;
  walletName: string;
  bankName: string;
  onboardingComplete: boolean;
};

export const DEFAULT_PROFILE: CashbookProfile = {
  currency: "PKR",
  walletType: "cash",
  walletName: "Cash",
  bankName: "",
  onboardingComplete: false,
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

export function normalizeProfile(value: unknown): CashbookProfile {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROFILE };
  const source = value as Partial<CashbookProfile>;
  const currency = CURRENCY_OPTIONS.some((option) => option.code === source.currency)
    ? source.currency as CurrencyCode
    : "PKR";
  const walletType = source.walletType === "bank" ? "bank" : "cash";
  return {
    currency,
    walletType,
    walletName: String(source.walletName || (walletType === "bank" ? "Bank account" : "Cash")),
    bankName: walletType === "bank" ? String(source.bankName || "") : "",
    onboardingComplete: Boolean(source.onboardingComplete),
  };
}

export function profileIsValid(profile: CashbookProfile) {
  return Boolean(
    profile.walletName.trim() &&
    (profile.walletType === "cash" || profile.bankName.trim()),
  );
}
