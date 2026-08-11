import test from "node:test";
import assert from "node:assert/strict";
import { compareSheetTransactions, parseSheetRows } from "../src/sheet-conflicts.ts";

const app=[{id:1,date:"2026-08-10",time:"9:00 AM",action:"Opening balance",amount:1000,direction:"IN",description:"Opening balance",source:"Opening"}];

test("sheet edits are detected without changing the app ledger",()=>{
  const sheet=parseSheetRows([[1,"2026-08-10","9:00 AM","Opening balance",1200,"",1200,"Opening balance","Opening","Hisaab AI"]]);
  const conflict=compareSheetTransactions(app,sheet);
  assert.equal(conflict?.changed,1);
  assert.equal(app[0].amount,1000);
});

test("invalid sheet edits that create negative balance are rejected",()=>{
  assert.throws(()=>parseSheetRows([[2,"2026-08-10","10:00 AM","Spent","",500,"-500","Tea","Manual","Hisaab AI"]]),/negative/);
});

test("money in and money out cannot both be filled",()=>{
  assert.throws(()=>parseSheetRows([[2,"2026-08-10","10:00 AM","Spent",500,500,0,"Invalid","Manual","Hisaab AI"]]),/either Money In or Money Out/);
});
