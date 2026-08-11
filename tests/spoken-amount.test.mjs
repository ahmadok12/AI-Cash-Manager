import test from "node:test";
import assert from "node:assert/strict";
import { parseSpokenAmount } from "../supabase/functions/_shared/spoken-amount.ts";

const cases = [
  ["2 hazar 5 so 60", 2560],
  ["2 hazar 5 so sath", 2560],
  ["do hazaar paanch sau saath", 2560],
  ["2 thousand five hundred and sixty", 2560],
  ["25 sau 60", 2560],
  ["pachis so saath", 2560],
  ["2,560 rupay Imran ko diye", 2560],
  ["2.5 hazar chaye wale ko diye", 2500],
  ["1 lakh 25 hazar 5 so 60", 125560],
  ["do lakh pachees hazar paanch sau saath", 225560],
  ["50000 meezan bank main jama krwaye", 50000],
  ["Imran se 500 rupay liye", 500],
];

for (const [phrase, expected] of cases) {
  test(`${phrase} = ${expected}`, () => {
    assert.equal(parseSpokenAmount(phrase), expected);
  });
}
