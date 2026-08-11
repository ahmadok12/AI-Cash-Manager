export type LedgerEntry = {
  id: number;
  amount: number;
  direction: "IN" | "OUT";
};

export function ledgerBalance(entries: LedgerEntry[]) {
  return entries.reduce(
    (sum, entry) => sum + (entry.direction === "IN" ? entry.amount : -entry.amount),
    0,
  );
}

export function canDeleteTransaction(entries: LedgerEntry[], target: LedgerEntry) {
  if (target.direction === "OUT") return true;
  return ledgerBalance(entries.filter((entry) => entry.id !== target.id)) >= 0;
}

export function canEditTransaction(
  entries: LedgerEntry[],
  target: LedgerEntry,
  replacement: Pick<LedgerEntry, "amount" | "direction">,
) {
  const currentBalance = ledgerBalance(entries);
  const nextEntries = entries.map((entry) =>
    entry.id === target.id ? { ...entry, ...replacement } : entry,
  );
  const nextBalance = ledgerBalance(nextEntries);

  // A correction that improves an already-negative legacy ledger is allowed.
  return nextBalance >= 0 || nextBalance >= currentBalance;
}
