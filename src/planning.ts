export type SavingsGoal = {
  id: string;
  name: string;
  targetAmount: number;
  targetDate?: string;
  note?: string;
  createdAt: string;
  archived?: boolean;
};

export type SavingsEntry = {
  id: string;
  goalId: string;
  amount: number;
  direction: "ADD" | "WITHDRAW";
  date: string;
  note?: string;
  walletId?: string;
  transactionId?: number;
};

export type PersonLedger = {
  id: string;
  personName: string;
  relation?: string;
  mode: "OPEN" | "TARGET";
  openingReceivable: number;
  installmentAmount?: number;
  installmentDay?: number;
  firstDueDate?: string;
  note?: string;
  createdAt: string;
  archived?: boolean;
};

export type PersonLedgerEntry = {
  id: string;
  ledgerId: string;
  kind: "LENT" | "RECEIVED" | "ADJUSTMENT";
  amount: number;
  date: string;
  note?: string;
  walletId?: string;
  transactionId?: number;
};

export function goalSaved(entries: SavingsEntry[], goalId: string) {
  return entries
    .filter((entry) => entry.goalId === goalId)
    .reduce((sum, entry) => sum + (entry.direction === "ADD" ? entry.amount : -entry.amount), 0);
}

export function savingsWalletDirection(direction: SavingsEntry["direction"]): "IN" | "OUT" {
  return direction === "ADD" ? "OUT" : "IN";
}

export function goalProgress(goal: SavingsGoal, entries: SavingsEntry[]) {
  const saved = goalSaved(entries, goal.id);
  return goal.targetAmount > 0 ? Math.max(0, Math.min(100, (saved / goal.targetAmount) * 100)) : 0;
}

export function ledgerOutstanding(ledger: PersonLedger, entries: PersonLedgerEntry[]) {
  return entries
    .filter((entry) => entry.ledgerId === ledger.id)
    .reduce((sum, entry) => {
      if (entry.kind === "RECEIVED") return sum - entry.amount;
      return sum + entry.amount;
    }, ledger.openingReceivable);
}

export function ledgerReceived(entries: PersonLedgerEntry[], ledgerId: string) {
  return entries
    .filter((entry) => entry.ledgerId === ledgerId && entry.kind === "RECEIVED")
    .reduce((sum, entry) => sum + entry.amount, 0);
}

export function ledgerGiven(entries: PersonLedgerEntry[], ledgerId: string) {
  return entries
    .filter((entry) => entry.ledgerId === ledgerId && entry.kind !== "RECEIVED")
    .reduce((sum, entry) => sum + entry.amount, 0);
}

export function ledgerBalanceSide(balance: number) {
  return balance < 0 ? "PAYABLE" as const : "RECEIVABLE" as const;
}

export function ledgerPrincipal(ledger: PersonLedger, entries: PersonLedgerEntry[]) {
  if (ledger.openingReceivable < 0) return Math.abs(ledger.openingReceivable) + ledgerReceived(entries, ledger.id);
  return ledger.openingReceivable + ledgerGiven(entries, ledger.id);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type InstallmentScheduleRow = {
  number: number;
  dueDate: string;
  amount: number;
  status: "PAID" | "PARTIAL" | "DUE" | "UPCOMING";
  paid: number;
};

export function installmentSchedule(ledger: PersonLedger, entries: PersonLedgerEntry[], today = new Date()) {
  const principal = ledgerPrincipal(ledger, entries);
  const installment = Number(ledger.installmentAmount || 0);
  if (!principal || !installment || !ledger.firstDueDate) return [] as InstallmentScheduleRow[];
  const count = Math.ceil(principal / installment);
  let received = ledger.openingReceivable < 0 ? ledgerGiven(entries, ledger.id) : ledgerReceived(entries, ledger.id);
  const start = new Date(`${ledger.firstDueDate}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const due = new Date(start);
    due.setMonth(start.getMonth() + index);
    const amount = Math.min(installment, principal - (installment * index));
    const paid = Math.max(0, Math.min(amount, received));
    received -= paid;
    const status: InstallmentScheduleRow["status"] = paid >= amount ? "PAID" : paid > 0 ? "PARTIAL" : due < today ? "DUE" : "UPCOMING";
    return { number: index + 1, dueDate: monthKey(due), amount, paid, status };
  });
}

export function normalizePlanningState(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    goals: Array.isArray(raw.goals) ? raw.goals as SavingsGoal[] : [],
    savingsEntries: Array.isArray(raw.savingsEntries) ? raw.savingsEntries as SavingsEntry[] : [],
    peopleLedgers: Array.isArray(raw.peopleLedgers) ? raw.peopleLedgers as PersonLedger[] : [],
    ledgerEntries: Array.isArray(raw.ledgerEntries) ? raw.ledgerEntries as PersonLedgerEntry[] : [],
  };
}
