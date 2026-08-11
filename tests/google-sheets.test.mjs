import test from "node:test";
import assert from "node:assert/strict";
import { cashbookSpreadsheetPayload, sheetProperties } from "../src/google-sheets.ts";

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
