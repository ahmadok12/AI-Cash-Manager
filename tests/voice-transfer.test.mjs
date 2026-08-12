import test from "node:test";
import assert from "node:assert/strict";
import { detectMentionedWallet, detectWalletTransfer } from "../src/voice-transfer.ts";

const wallets = [
  { id: "cash", type: "cash", name: "Cash Wallet", bankName: "" },
  { id: "meezan", type: "bank", name: "Business Account", bankName: "Meezan Bank" },
  { id: "hbl", type: "bank", name: "Current Account", bankName: "HBL" },
];

test("bank main jama karwaye is a cash-to-bank transfer", () => {
  assert.deepEqual(detectWalletTransfer("Meezan Bank main 50,000 jama karwaye", wallets, "cash"), { fromWalletId: "cash", toWalletId: "meezan" });
});

test("bank se nikalwaye is a bank-to-cash transfer", () => {
  assert.deepEqual(detectWalletTransfer("Meezan Bank se 20 hazar nikalwaye", wallets, "meezan"), { fromWalletId: "meezan", toWalletId: "cash" });
});

test("ordinary jama wording stays a normal transaction without a matching wallet", () => {
  assert.equal(detectWalletTransfer("supplier ko 50000 jama karwaye", wallets, "cash"), null);
});

test("a named wallet is detected in an ordinary expense", () => {
  assert.equal(detectMentionedWallet("Meezan Bank se 5000 bill pay kiya", wallets)?.id, "meezan");
  assert.equal(detectMentionedWallet("cash se 500 chaye ke diye", wallets)?.id, "cash");
  assert.equal(detectMentionedWallet("500 chaye ke diye", wallets), null);
});
