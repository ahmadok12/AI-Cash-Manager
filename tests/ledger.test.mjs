import test from "node:test";
import assert from "node:assert/strict";
import { canDeleteTransaction, canEditTransaction, ledgerBalance } from "../src/ledger.ts";

const entries = [
  { id: 1, amount: 1000, direction: "IN" },
  { id: 2, amount: 700, direction: "OUT" },
];

test("deleting money-out always succeeds and increases balance", () => {
  assert.equal(canDeleteTransaction(entries, entries[1]), true);
  assert.equal(ledgerBalance(entries.filter((entry) => entry.id !== 2)), 1000);
});

test("deleting money-out is allowed even for a legacy negative ledger", () => {
  const legacy = [
    { id: 1, amount: 100, direction: "IN" },
    { id: 2, amount: 150, direction: "OUT" },
  ];
  assert.equal(canDeleteTransaction(legacy, legacy[1]), true);
});

test("deleting money-in is blocked only when it makes balance negative", () => {
  assert.equal(canDeleteTransaction(entries, entries[0]), false);
  const safe = [...entries, { id: 3, amount: 1000, direction: "IN" }];
  assert.equal(canDeleteTransaction(safe, safe[0]), true);
});

test("editing is allowed when valid or when it improves legacy negative balance", () => {
  assert.equal(canEditTransaction(entries, entries[1], { amount: 200, direction: "OUT" }), true);
  assert.equal(canEditTransaction(entries, entries[1], { amount: 1200, direction: "OUT" }), false);

  const legacy = [
    { id: 1, amount: 100, direction: "IN" },
    { id: 2, amount: 200, direction: "OUT" },
  ];
  assert.equal(canEditTransaction(legacy, legacy[1], { amount: 150, direction: "OUT" }), true);
});
