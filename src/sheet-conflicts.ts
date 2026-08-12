export type SheetComparableTransaction = {
  id: number;
  date: string;
  time: string;
  action: string;
  amount: number;
  direction: "IN" | "OUT";
  description: string;
  source: string;
  status?: string;
  walletId?: string;
};

export type SheetConflictSummary<T extends SheetComparableTransaction> = {
  sheetTransactions: T[];
  added: number;
  changed: number;
  removed: number;
};

function normalized(entry: SheetComparableTransaction) {
  return JSON.stringify([
    entry.id, entry.date, entry.time, entry.action, entry.amount,
    entry.direction, entry.description.trim(), entry.source, entry.walletId || "wallet-cash",
  ]);
}

export function parseSheetRows<T extends SheetComparableTransaction>(rows: unknown[][], walletIdsByLabel: Record<string,string> = {}): T[] {
  const parsed = rows.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => {
    const rowWalletLabel = String(row[3] ?? "").trim().toLocaleLowerCase();
    const modern = row.length >= 11 || Boolean(walletIdsByLabel[rowWalletLabel]);
    const id = Number(row[0]);
    const date = String(row[1] ?? "").trim();
    const time = String(row[2] ?? "").trim();
    const walletLabel = modern ? String(row[3] ?? "").trim() : "Cash";
    if (modern && Object.keys(walletIdsByLabel).length && !walletIdsByLabel[walletLabel.toLocaleLowerCase()]) {
      throw new Error(`Transaction ${id || "row"} uses a wallet that does not match the app.`);
    }
    const walletId = walletIdsByLabel[walletLabel.toLocaleLowerCase()] || (modern ? walletLabel : "wallet-cash") || "wallet-cash";
    const action = String(row[modern ? 4 : 3] ?? "").trim() || "Edited in Google Sheets";
    const moneyIn = Number(String(row[modern ? 5 : 4] ?? "").replace(/,/g, "")) || 0;
    const moneyOut = Number(String(row[modern ? 6 : 5] ?? "").replace(/,/g, "")) || 0;
    const description = String(row[modern ? 8 : 7] ?? "").trim();
    const source = String(row[modern ? 9 : 8] ?? "").trim() || "Manual";
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("A Google Sheet row has a missing or invalid ID.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Transaction ${id} has an invalid date.`);
    if (!description) throw new Error(`Transaction ${id} needs a description.`);
    if ((moneyIn > 0) === (moneyOut > 0)) throw new Error(`Transaction ${id} must have an amount in either Money In or Money Out, not both.`);
    return {
      id, date, time, action,
      amount: moneyIn || moneyOut,
      direction: moneyIn > 0 ? "IN" : "OUT",
      description, source, status: "Pending", walletId,
    } as T;
  });

  const ids = new Set<number>();
  for (const entry of parsed) {
    if (ids.has(entry.id)) throw new Error(`Google Sheet contains duplicate transaction ID ${entry.id}.`);
    ids.add(entry.id);
  }
  const balances = new Map<string,number>();
  for (const entry of [...parsed].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const walletId = entry.walletId || "wallet-cash";
    const balance = (balances.get(walletId) || 0) + (entry.direction === "IN" ? entry.amount : -entry.amount);
    balances.set(walletId, balance);
    if (balance < 0) throw new Error(`Google Sheet changes would make the balance negative on ${entry.date}.`);
  }
  return parsed;
}

export function compareSheetTransactions<T extends SheetComparableTransaction>(app: T[], sheet: T[]): SheetConflictSummary<T> | null {
  const appById = new Map(app.map((entry) => [entry.id, entry]));
  const sheetById = new Map(sheet.map((entry) => [entry.id, entry]));
  let added = 0; let changed = 0; let removed = 0;
  for (const [id, entry] of sheetById) {
    const appEntry = appById.get(id);
    if (!appEntry) added += 1;
    else if (normalized(appEntry) !== normalized(entry)) changed += 1;
  }
  for (const id of appById.keys()) if (!sheetById.has(id)) removed += 1;
  return added || changed || removed ? { sheetTransactions: sheet, added, changed, removed } : null;
}
