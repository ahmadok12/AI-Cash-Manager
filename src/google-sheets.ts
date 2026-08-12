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

export const transactionHeadersFor = (currency = "PKR") => [
  "ID",
  "Date",
  "Time",
  "Wallet",
  "Type",
  `Money In (${currency})`,
  `Money Out (${currency})`,
  `Running Balance (${currency})`,
  "Description",
  "Entry method",
  "Parser",
];

export const transactionHeaders = transactionHeadersFor();

type CashbookTransaction = {
  id: number;
  date: string;
  time: string;
  action: string;
  amount: number;
  direction: "IN" | "OUT";
  description: string;
  source: string;
  walletId?: string;
  walletName?: string;
};

export function transactionRows(transactions: CashbookTransaction[]) {
  const balances = new Map<string, number>();
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
      const walletKey = row.walletId || "wallet-cash";
      const moneyIn = row.direction === "IN" ? row.amount : "";
      const moneyOut = row.direction === "OUT" ? row.amount : "";
      const balance = (balances.get(walletKey) || 0) + (row.direction === "IN" ? row.amount : -row.amount);
      balances.set(walletKey, balance);
      return [
        row.id,
        row.date,
        row.time,
        row.walletName || row.walletId || "Cash",
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
