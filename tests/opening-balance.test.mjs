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

test("each wallet keeps its own opening balance", () => {
  const cash = {...entry(1,1000),walletId:"cash"};
  const bank = {...entry(2,5000),walletId:"bank"};
  assert.equal(currentOpeningBalance([cash,bank],"cash")?.amount,1000);
  assert.equal(currentOpeningBalance([cash,bank],"bank")?.amount,5000);
  const replaced = replaceOpeningBalance([cash,bank],{...cash,amount:1500},"cash");
  assert.equal(currentOpeningBalance(replaced,"cash")?.amount,1500);
  assert.equal(currentOpeningBalance(replaced,"bank")?.amount,5000);
});
