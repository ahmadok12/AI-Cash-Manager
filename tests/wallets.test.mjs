import test from "node:test";
import assert from "node:assert/strict";
import { migrateWalletTransactions, totalBalance, walletBalance } from "../src/wallets.ts";

test("legacy transactions migrate into the existing wallet", () => {
  const migrated = migrateWalletTransactions([{id:1,amount:1000,direction:"IN"}],"wallet-cash");
  assert.equal(migrated[0].walletId,"wallet-cash");
  assert.equal(walletBalance(migrated,"wallet-cash"),1000);
});

test("wallet transfer changes wallet balances but not total balance", () => {
  const entries = [
    {id:1,walletId:"cash",amount:1000,direction:"IN"},
    {id:2,walletId:"cash",amount:400,direction:"OUT",transferId:"t1"},
    {id:3,walletId:"bank",amount:400,direction:"IN",transferId:"t1"},
  ];
  assert.equal(walletBalance(entries,"cash"),600);
  assert.equal(walletBalance(entries,"bank"),400);
  assert.equal(totalBalance(entries),1000);
});
