import test from "node:test";
import assert from "node:assert/strict";
import { goalProgress, goalSaved, installmentSchedule, ledgerOutstanding, ledgerPrincipal, ledgerReceived, savingsWalletDirection } from "../src/planning.ts";

const ledger = {
  id: "person-1",
  personName: "Ammi",
  mode: "TARGET",
  openingReceivable: 120000,
  installmentAmount: 10000,
  firstDueDate: "2026-09-05",
  createdAt: "2026-08-13T00:00:00Z",
};

test("savings additions and withdrawals calculate the saved amount", () => {
  const entries = [
    { id: "1", goalId: "tour", amount: 25000, direction: "ADD", date: "2026-08-01" },
    { id: "2", goalId: "tour", amount: 5000, direction: "WITHDRAW", date: "2026-08-02" },
  ];
  assert.equal(goalSaved(entries, "tour"), 20000);
  assert.equal(goalProgress({ id: "tour", name: "Tour", targetAmount: 100000, createdAt: "" }, entries), 20);
  assert.equal(savingsWalletDirection("ADD"), "OUT");
  assert.equal(savingsWalletDirection("WITHDRAW"), "IN");
});

test("person ledger combines opening target, new lending, and receipts", () => {
  const entries = [
    { id: "1", ledgerId: ledger.id, kind: "LENT", amount: 30000, date: "2026-08-15" },
    { id: "2", ledgerId: ledger.id, kind: "RECEIVED", amount: 20000, date: "2026-09-05" },
  ];
  assert.equal(ledgerPrincipal(ledger, entries), 150000);
  assert.equal(ledgerReceived(entries, ledger.id), 20000);
  assert.equal(ledgerOutstanding(ledger, entries), 130000);
});

test("monthly installment schedule allocates receipts oldest-first", () => {
  const entries = [{ id: "1", ledgerId: ledger.id, kind: "RECEIVED", amount: 15000, date: "2026-10-01" }];
  const rows = installmentSchedule(ledger, entries, new Date("2026-10-06T12:00:00"));
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.slice(0, 3).map(row => [row.paid, row.status]), [
    [10000, "PAID"],
    [5000, "PARTIAL"],
    [0, "UPCOMING"],
  ]);
});
