import test from "node:test";
import assert from "node:assert/strict";
import { currentOpeningBalance, openingBalanceEntries, replaceOpeningBalance } from "../src/opening-balance.ts";

const entry = (id, amount, date = "2026-08-01") => ({
  id, amount, date, description: "Opening balance", direction: "IN", action: "Opening balance",
  time: "9:00 AM", source: "Opening", status: "Local",
});

test("opening balance is unique after save", () => {
  const normal = { ...entry(3, 200), description: "Sale", action: "Received", source: "Manual" };
  const result = replaceOpeningBalance([entry(1, 1000), normal, entry(2, 1500)], entry(1, 1800, "2026-07-31"));
  assert.equal(openingBalanceEntries(result).length, 1);
  assert.equal(currentOpeningBalance(result)?.amount, 1800);
  assert.equal(currentOpeningBalance(result)?.date, "2026-07-31");
  assert.ok(result.some((row) => row.id === 3));
});

test("the most recently created legacy opening entry is shown for correction", () => {
  assert.equal(currentOpeningBalance([entry(10, 1000), entry(20, 2500)])?.amount, 2500);
});
