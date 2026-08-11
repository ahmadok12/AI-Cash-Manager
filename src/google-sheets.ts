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

export const transactionHeaders = [
  "ID",
  "Date",
  "Time",
  "Type",
  "Money In (PKR)",
  "Money Out (PKR)",
  "Running Balance (PKR)",
  "Description",
  "Entry method",
  "Parser",
];

type CashbookTransaction = {
  id: number;
  date: string;
  time: string;
  action: string;
  amount: number;
  direction: "IN" | "OUT";
  description: string;
  source: string;
};

export function transactionRows(transactions: CashbookTransaction[]) {
  let balance = 0;
  return [...transactions]
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate) return byDate;
      const aOpening = a.source === "Opening" || a.action === "Opening balance";
      const bOpening = b.source === "Opening" || b.action === "Opening balance";
      if (aOpening !== bOpening) return aOpening ? -1 : 1;
      return a.id - b.id;
    })
    .map((row) => {
      const moneyIn = row.direction === "IN" ? row.amount : "";
      const moneyOut = row.direction === "OUT" ? row.amount : "";
      balance += row.direction === "IN" ? row.amount : -row.amount;
      return [
        row.id,
        row.date,
        row.time,
        row.action,
        moneyIn,
        moneyOut,
        balance,
        row.description,
        row.source,
        "Hisaab AI",
      ];
    });
}
