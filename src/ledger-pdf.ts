import type { jsPDF } from "jspdf";
import type { CashbookProfile } from "./profile";
import { currencyPrefix } from "./profile";
import type { InstallmentScheduleRow, PersonLedger, PersonLedgerEntry } from "./planning";
import { installmentSchedule, ledgerGiven, ledgerOutstanding, ledgerReceived } from "./planning";

const safeName = (value: string) => value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "ledger";
const money = (value: number, currency: CashbookProfile["currency"]) => `${currencyPrefix(currency)} ${value.toLocaleString("en-PK")}`;
const balanceMoney = (value:number,currency:CashbookProfile["currency"]) => value===0?`${money(0,currency)} settled`:`${money(Math.abs(value),currency)} ${value<0?"payable":"receivable"}`;
const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });

function addPageHeader(doc: jsPDF, ledger: PersonLedger, page: number) {
  doc.setFillColor(29, 27, 24);
  doc.rect(0, 0, 210, 31, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Hisaab - Khaata", 14, 14);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${ledger.personName}${ledger.relation ? ` - ${ledger.relation}` : ""}`, 14, 23);
  doc.text(`Page ${page}`, 194, 23, { align: "right" });
  doc.setTextColor(35, 33, 30);
}

function ensurePage(doc: jsPDF, ledger: PersonLedger, y: number, needed = 15) {
  if (y + needed < 282) return y;
  doc.addPage();
  addPageHeader(doc, ledger, doc.getNumberOfPages());
  return 41;
}

export async function createLedgerPdf(ledger: PersonLedger, entries: PersonLedgerEntry[], profile: CashbookProfile, walletNames: Record<string, string>, dates?:{from?:string;to?:string}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  addPageHeader(doc, ledger, 1);
  const allLedgerEntries=entries.filter(entry=>entry.ledgerId===ledger.id);const from=dates?.from;const to=dates?.to;const rows=allLedgerEntries.filter(entry=>(!from||entry.date>=from)&&(!to||entry.date<=to));
  const given = ledgerGiven(allLedgerEntries, ledger.id);
  const received = ledgerReceived(allLedgerEntries, ledger.id);
  const outstanding = ledgerOutstanding(ledger, allLedgerEntries);
  let y = 41;
  const cards = [
    ["Money given", money(given, profile.currency)],
    ["Money received", money(received, profile.currency)],
    [outstanding<0?"You will pay":"You will receive", money(Math.abs(outstanding), profile.currency)],
  ];
  cards.forEach(([label, value], index) => {
    const x = 14 + (index * 61);
    doc.setFillColor(index === 2 ? (outstanding<0?255:235) : 247, index === 2 ? (outstanding<0?241:248) : 245, index === 2 ? (outstanding<0?235:241) : 241);
    doc.roundedRect(x, y, 57, 23, 3, 3, "F");
    doc.setFontSize(8);
    doc.setTextColor(110, 104, 96);
    doc.text(label.toUpperCase(), x + 4, y + 7);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(35, 33, 30);
    doc.text(value, x + 4, y + 16);
    doc.setFont("helvetica", "normal");
  });
  y += 33;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Khaata activity", 14, y);
  if(from||to){doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(110,104,96);doc.text(`${from?displayDate(from):"Beginning"} to ${to?displayDate(to):"Today"}`,196,y,{align:"right"});doc.setTextColor(35,33,30)}
  y += 7;
  doc.setFillColor(235, 231, 224);
  doc.rect(14, y, 182, 9, "F");
  doc.setFontSize(8);
  ["Date", "Details", "Wallet", "Given", "Received", "Balance"].forEach((label, index) => doc.text(label, [16, 39, 99, 130, 151, 176][index], y + 6));
  y += 9;
  const before=from?allLedgerEntries.filter(entry=>entry.date<from):[];let balance=before.reduce((sum,entry)=>sum+(entry.kind==="RECEIVED"?-entry.amount:entry.amount),ledger.openingReceivable);
  if (ledger.openingReceivable !== 0 || before.length) {
    doc.setFontSize(8);
    doc.text("Opening", 16, y + 6);
    doc.text(from?"Balance brought forward":"Opening receivable", 39, y + 6);
    doc.text(balanceMoney(balance, profile.currency), 194, y + 6, {align:"right"});
    y += 9;
  }
  rows.forEach((entry) => {
    y = ensurePage(doc, ledger, y, 11);
    balance += entry.kind === "RECEIVED" ? -entry.amount : entry.amount;
    doc.setDrawColor(232, 228, 222);
    doc.line(14, y + 9, 196, y + 9);
    doc.setFontSize(8);
    doc.text(displayDate(entry.date), 16, y + 6);
    doc.text((entry.note || (entry.kind === "RECEIVED" ? "Installment received" : "Money given")).slice(0, 35), 39, y + 6);
    doc.text((entry.walletId ? walletNames[entry.walletId] : "-")?.slice(0, 16) || "-", 99, y + 6);
    if (entry.kind !== "RECEIVED") doc.text(money(entry.amount, profile.currency), 130, y + 6);
    if (entry.kind === "RECEIVED") doc.text(money(entry.amount, profile.currency), 151, y + 6);
    doc.text(balanceMoney(balance, profile.currency), 194, y + 6, {align:"right"});
    y += 10;
  });
  if (!rows.length && !balance) {
    doc.setFontSize(9);
    doc.setTextColor(110, 104, 96);
    doc.text("No ledger activity recorded yet.", 16, y + 8);
    y += 14;
  }
  const schedule = installmentSchedule(ledger, allLedgerEntries);
  if (schedule.length) y = addSchedule(doc, ledger, schedule, profile, y + 8);
  if (y + 32 < 282) {
    y += 8;
    doc.setDrawColor(211, 205, 197);
    doc.line(14, y, 82, y);
    doc.line(128, y, 196, y);
    doc.setFontSize(8);
    doc.setTextColor(110, 104, 96);
    doc.text("Lender signature", 14, y + 5);
    doc.text("Borrower signature", 128, y + 5);
  }
  doc.setFontSize(7);
  doc.text(`Generated by Hisaab on ${new Date().toLocaleDateString("en-PK")}`, 105, 290, { align: "center" });
  return { doc, filename: `${safeName(ledger.personName)}-khaata${from?`-${from}`:""}${to?`-to-${to}`:""}.pdf` };
}

function addSchedule(doc: jsPDF, ledger: PersonLedger, schedule: InstallmentScheduleRow[], profile: CashbookProfile, initialY: number) {
  let y = ensurePage(doc, ledger, initialY, 25);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(35, 33, 30);
  doc.setFontSize(12);
  doc.text("Monthly installment schedule", 14, y);
  y += 7;
  schedule.forEach((row) => {
    y = ensurePage(doc, ledger, y, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(50, 47, 43);
    doc.text(`#${row.number}`, 16, y + 5);
    doc.text(displayDate(row.dueDate), 32, y + 5);
    doc.text(money(row.amount, profile.currency), 91, y + 5);
    doc.text(row.paid ? `${money(row.paid, profile.currency)} paid` : "-", 127, y + 5);
    doc.text(row.status, 190, y + 5, { align: "right" });
    doc.setDrawColor(232, 228, 222);
    doc.line(14, y + 8, 196, y + 8);
    y += 9;
  });
  return y;
}

export function ledgerPdfFile(doc: jsPDF, filename: string) {
  const blob = doc.output("blob");
  return new File([blob], filename, { type: "application/pdf" });
}
