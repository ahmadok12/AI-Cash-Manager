import test from "node:test";
import assert from "node:assert/strict";
import { cashbookSpreadsheetPayload, sheetProperties, transactionHeaders, transactionRows } from "../src/google-sheets.ts";

test("frozen rows are nested under gridProperties", () => {
  const properties = sheetProperties("Transactions");

  assert.deepEqual(properties, {
    title: "Transactions",
    gridProperties: { frozenRowCount: 1 },
  });
  assert.equal("frozenRowCount" in properties, false);
});

test("cashbook creation payload uses valid Google Sheets properties", () => {
  const payload = cashbookSpreadsheetPayload();

  assert.equal(payload.properties.title, "Hisaab AI Cashbook");
  assert.deepEqual(
    payload.sheets.map((sheet) => sheet.properties.title),
    ["Transactions", "Daily Closings"],
  );
  for (const sheet of payload.sheets) {
    assert.equal(sheet.properties.gridProperties.frozenRowCount, 1);
    assert.equal("frozenRowCount" in sheet.properties, false);
  }
});

test("transaction sheet has separate money columns and a running balance", () => {
  assert.deepEqual(transactionHeaders, [
    "ID", "Date", "Time", "Wallet", "Type", "Money In (PKR)", "Money Out (PKR)",
    "Running Balance (PKR)", "Description", "Entry method", "Parser",
  ]);

  const rows = transactionRows([
    { id: 3, date: "2026-08-11", time: "5:20 PM", action: "Received", amount: 500, direction: "IN", description: "Imran se liye", source: "Voice" },
    { id: 2, date: "2026-08-11", time: "5:16 PM", action: "Spent", amount: 2000, direction: "OUT", description: "Tea", source: "Chat" },
    { id: 1, date: "2026-08-11", time: "5:09 PM", action: "Opening balance", amount: 10000, direction: "IN", description: "Opening balance", source: "Opening" },
  ]);

  assert.deepEqual(rows.map((row) => row.slice(5, 8)), [
    [10000, "", 10000],
    ["", 2000, 8000],
    [500, "", 8500],
  ]);
});

test("running balance follows transaction date and then creation order", () => {
  const rows = transactionRows([
    { id: 10, date: "2026-08-12", time: "9:00 AM", action: "Spent", amount: 300, direction: "OUT", description: "Later", source: "Manual" },
    { id: 20, date: "2026-08-11", time: "9:00 AM", action: "Received", amount: 1000, direction: "IN", description: "Earlier", source: "Manual" },
  ]);
  assert.deepEqual(rows.map((row) => [row[1], row[7]]), [
    ["2026-08-11", 1000],
    ["2026-08-12", 700],
  ]);
});

test("opening balance is first when it shares a date with transactions", () => {
  const rows = transactionRows([
    { id: 1, date: "2026-08-11", time: "8:00 AM", action: "Spent", amount: 200, direction: "OUT", description: "Tea", source: "Manual" },
    { id: 2, date: "2026-08-11", time: "9:00 AM", action: "Opening balance", amount: 1000, direction: "IN", description: "Opening balance", source: "Opening" },
  ]);
  assert.equal(rows[0][4], "Opening balance");
  assert.equal(rows[0][7], 1000);
  assert.equal(rows[1][7], 800);
});

test("running balances are calculated separately for each wallet", () => {
  const rows = transactionRows([
    { id: 1, walletId: "cash", walletName: "Cash", date: "2026-08-11", time: "9:00 AM", action: "Opening balance", amount: 1000, direction: "IN", description: "Opening balance", source: "Opening" },
    { id: 2, walletId: "bank", walletName: "Meezan", date: "2026-08-11", time: "9:01 AM", action: "Opening balance", amount: 5000, direction: "IN", description: "Opening balance", source: "Opening" },
    { id: 3, walletId: "cash", walletName: "Cash", date: "2026-08-11", time: "9:02 AM", action: "Spent", amount: 200, direction: "OUT", description: "Tea", source: "Manual" },
  ]);
  assert.deepEqual(rows.map((row) => [row[3], row[7]]), [["Cash",1000],["Meezan",5000],["Cash",800]]);
});
