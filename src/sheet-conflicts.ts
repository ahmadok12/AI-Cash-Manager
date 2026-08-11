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
    entry.direction, entry.description.trim(), entry.source,
  ]);
}

export function parseSheetRows<T extends SheetComparableTransaction>(rows: unknown[][]): T[] {
  const parsed = rows.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => {
    const id = Number(row[0]);
    const date = String(row[1] ?? "").trim();
    const time = String(row[2] ?? "").trim();
    const action = String(row[3] ?? "").trim() || "Edited in Google Sheets";
    const moneyIn = Number(String(row[4] ?? "").replace(/,/g, "")) || 0;
    const moneyOut = Number(String(row[5] ?? "").replace(/,/g, "")) || 0;
    const description = String(row[7] ?? "").trim();
    const source = String(row[8] ?? "").trim() || "Manual";
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("A Google Sheet row has a missing or invalid ID.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Transaction ${id} has an invalid date.`);
    if (!description) throw new Error(`Transaction ${id} needs a description.`);
    if ((moneyIn > 0) === (moneyOut > 0)) throw new Error(`Transaction ${id} must have an amount in either Money In or Money Out, not both.`);
    return {
      id, date, time, action,
      amount: moneyIn || moneyOut,
      direction: moneyIn > 0 ? "IN" : "OUT",
      description, source, status: "Pending",
    } as T;
  });

  const ids = new Set<number>();
  for (const entry of parsed) {
    if (ids.has(entry.id)) throw new Error(`Google Sheet contains duplicate transaction ID ${entry.id}.`);
    ids.add(entry.id);
  }
  let balance = 0;
  for (const entry of [...parsed].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    balance += entry.direction === "IN" ? entry.amount : -entry.amount;
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
