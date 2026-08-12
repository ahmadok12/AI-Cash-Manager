import test from "node:test";
import assert from "node:assert/strict";
import { currencyPrefix, normalizeProfile, profileIsValid } from "../src/profile.ts";

test("PKR always uses the English Rs. prefix", () => {
  assert.equal(currencyPrefix("PKR"), "Rs.");
});

test("a bank wallet requires a bank name and account name", () => {
  assert.equal(profileIsValid({currency:"PKR",walletType:"bank",bankName:"",walletName:"Main",onboardingComplete:true}),false);
  assert.equal(profileIsValid({currency:"PKR",walletType:"bank",bankName:"Meezan Bank",walletName:"Main",onboardingComplete:true}),true);
});

test("old users migrate safely to PKR cash", () => {
  assert.deepEqual(normalizeProfile({onboardingComplete:true}),{
    currency:"PKR",wallets:[{id:"wallet-cash",type:"cash",name:"Cash",bankName:""}],activeWalletId:"wallet-cash",walletType:"cash",walletName:"Cash",bankName:"",onboardingComplete:true,
  });
});
