export type OpeningBalanceEntry = {
  id: number;
  amount: number;
  description: string;
  direction: "IN" | "OUT";
  action: string;
  date: string;
  time: string;
  source: string;
  status: string;
};

export function isOpeningBalanceEntry(entry: Pick<OpeningBalanceEntry, "source" | "action" | "description">) {
  return entry.source === "Opening" ||
    entry.action.toLowerCase() === "opening balance" ||
    entry.description.toLowerCase() === "opening balance";
}

export function openingBalanceEntries<T extends OpeningBalanceEntry>(entries: T[]) {
  return entries.filter(isOpeningBalanceEntry);
}

export function currentOpeningBalance<T extends OpeningBalanceEntry>(entries: T[]) {
  return openingBalanceEntries(entries).sort((a, b) => b.id - a.id)[0] ?? null;
}

export function replaceOpeningBalance<T extends OpeningBalanceEntry>(entries: T[], replacement: T) {
  return [replacement, ...entries.filter((entry) => !isOpeningBalanceEntry(entry))];
}
