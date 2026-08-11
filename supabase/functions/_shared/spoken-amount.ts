const WORD_VALUES: Record<string, number> = {
  zero: 0,
  aik: 1, ek: 1, one: 1,
  do: 2, two: 2,
  teen: 3, three: 3,
  char: 4, chaar: 4, four: 4,
  panch: 5, paanch: 5, five: 5,
  che: 6, chay: 6, chhe: 6, six: 6,
  sat: 7, saat: 7, seven: 7,
  aath: 8, eight: 8,
  nau: 9, no: 9, nine: 9,
  das: 10, ten: 10,
  gyarah: 11, giarah: 11, eleven: 11,
  barah: 12, bara: 12, twelve: 12,
  tera: 13, terah: 13, thirteen: 13,
  chaudah: 14, choda: 14, fourteen: 14,
  pandra: 15, pandrah: 15, fifteen: 15,
  sola: 16, solah: 16, sixteen: 16,
  satra: 17, satrah: 17, seventeen: 17,
  athara: 18, atharah: 18, eighteen: 18,
  unnis: 19, unees: 19, nineteen: 19,
  bees: 20, bis: 20, twenty: 20,
  ikkis: 21, akees: 21,
  baees: 22, bais: 22,
  teis: 23, taees: 23,
  chaubees: 24, chobees: 24,
  pachees: 25, pachis: 25,
  chabees: 26, chabbis: 26,
  sataees: 27, sattais: 27,
  athaees: 28, atthais: 28,
  untees: 29, untis: 29,
  tees: 30, tis: 30, thirty: 30,
  iktees: 31, iktis: 31,
  batees: 32, battis: 32,
  tentees: 33, tentis: 33,
  chauntees: 34, chauntis: 34,
  paintees: 35, paintis: 35,
  chatees: 36, chattis: 36,
  saintees: 37, saintis: 37,
  artees: 38, adtis: 38,
  untalees: 39, untalis: 39,
  chalees: 40, chalis: 40, forty: 40,
  iktalees: 41, iktalis: 41,
  bayalees: 42, bayalis: 42,
  taintaalees: 43, taintalis: 43,
  chawalees: 44, chawalis: 44,
  paintalees: 45, paintalis: 45,
  chiyalees: 46, chiyalis: 46,
  saintalees: 47, saintalis: 47,
  arthalees: 48, artalis: 48,
  unchaas: 49, unchas: 49,
  pachas: 50, pachaas: 50, fifty: 50,
  ikyawan: 51, ikavan: 51,
  bawan: 52, baavan: 52,
  tirpan: 53, trepan: 53,
  chawan: 54, chauvan: 54,
  pachpan: 55,
  chappan: 56, chhappan: 56,
  sattawan: 57, satavan: 57,
  athawan: 58, atthavan: 58,
  unsath: 59, unsat: 59,
  sath: 60, saath: 60, sixty: 60,
  iksath: 61, iksat: 61,
  baasath: 62, basat: 62,
  tirsath: 63, tirasat: 63,
  chaunsath: 64, chausat: 64,
  painsath: 65, painsat: 65,
  chiyasath: 66, chiyasat: 66,
  sarsath: 67, sarsat: 67,
  arsath: 68, arsat: 68,
  unhattar: 69,
  sattar: 70, seventy: 70,
  ikhattar: 71,
  bahattar: 72,
  tihattar: 73,
  chauhattar: 74,
  pachattar: 75,
  chihattar: 76,
  satahattar: 77,
  athahattar: 78,
  unasi: 79, unaasi: 79,
  assi: 80, eighty: 80,
  ikyasi: 81,
  bayasi: 82,
  tirasi: 83,
  chaurasi: 84,
  pachasi: 85,
  chiyasi: 86,
  satasi: 87,
  athasi: 88,
  nawasi: 89,
  nabbe: 90, nabay: 90, ninety: 90,
  ikyanwe: 91,
  baanwe: 92,
  tiranwe: 93,
  chauranwe: 94,
  pachanwe: 95,
  chiyanwe: 96,
  satanwe: 97,
  athanwe: 98,
  ninyanwe: 99,
};

const HUNDREDS = new Set(["so", "sau", "soo", "hundred"]);
const THOUSANDS = new Set(["k", "hazar", "hazaar", "thousand"]);
const LAKHS = new Set(["lakh", "lac", "lakhs"]);
const CRORES = new Set(["crore", "crores", "karor", "karore"]);
const JOINERS = new Set(["and", "aur"]);
const CURRENCIES = new Set(["rs", "rs.", "rupay", "rupee", "rupees", "pkr"]);

export const SPOKEN_AMOUNT_TERMS = [
  ...Object.keys(WORD_VALUES),
  ...HUNDREDS,
  ...THOUSANDS,
  ...LAKHS,
  ...CRORES,
];

function normalizedTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*k\b/g, "$1 k")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Parses the first contiguous spoken-number expression in a transaction. */
export function parseSpokenAmount(text: string): number {
  const tokens = normalizedTokens(text);
  let total = 0;
  let group = 0;
  let started = false;
  let found = false;

  for (const token of tokens) {
    const numeric = /^\d+(?:\.\d+)?$/.test(token) ? Number(token) : undefined;
    const wordValue = WORD_VALUES[token];

    if (numeric !== undefined || wordValue !== undefined) {
      group += numeric ?? wordValue;
      started = true;
      found = true;
      continue;
    }

    if (HUNDREDS.has(token)) {
      if (!started) continue;
      group = (group || 1) * 100;
      found = true;
      continue;
    }

    if (THOUSANDS.has(token)) {
      if (!started) continue;
      total += (group || 1) * 1_000;
      group = 0;
      found = true;
      continue;
    }

    if (LAKHS.has(token)) {
      if (!started) continue;
      total += (group || 1) * 100_000;
      group = 0;
      found = true;
      continue;
    }

    if (CRORES.has(token)) {
      if (!started) continue;
      total += (group || 1) * 10_000_000;
      group = 0;
      found = true;
      continue;
    }

    if (started && (JOINERS.has(token) || CURRENCIES.has(token))) continue;
    if (started) break;
  }

  return found ? total + group : 0;
}

export function stripSpokenAmount(text: string): string {
  const terms = SPOKEN_AMOUNT_TERMS
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  return text
    .replace(new RegExp(`\\b(?:[\\d,.]+|${terms})\\b`, "gi"), " ")
    .replace(/\b(?:rs\.?|rupay|rupee|rupees|pkr|rmb|cny)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
