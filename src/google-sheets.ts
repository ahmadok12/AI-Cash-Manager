export const sheetProperties = (title: string) => ({
  title,
  gridProperties: { frozenRowCount: 1 },
});

export const cashbookSpreadsheetPayload = () => ({
  properties: { title: "Hisaab AI Cashbook" },
  sheets: [
    { properties: sheetProperties("Transactions") },
    { properties: sheetProperties("Daily Closings") },
  ],
});
