import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseSpokenAmount } from "../_shared/spoken-amount.ts";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : (allowedOrigins[0] || "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin") || "";
  if (allowedOrigins.length && !allowedOrigins.includes(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) {
    return json(req, { error: "Origin not allowed" }, 403);
  }

  try {
    const { text } = await req.json();
    if (typeof text !== "string" || !text.trim() || text.length > 300) {
      return json(req, { error: "Transaction text must be 1–300 characters" }, 400);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
    if (!apiKey) return json(req, { error: "Gemini is not configured" }, 503);

    const prompt = `Interpret one cash transaction written in Roman Urdu, Urdu transliteration, or English.
Return only the structured object required by the schema.

Rules:
- "X se liye", "wasool", "received", "mili", and bank se "nikalwaye" mean IN.
- "X ko diye", "paid", "spent", and bank main "jama karwaye/krwaye" mean OUT.
- direction must be IN or OUT.
- action should be Received, Spent, Withdrawn, or Deposited.
- amount is a positive number in PKR. Understand k, hazar/thousand, and lakh.
- Treat compound spoken amounts as arithmetic place values, never concatenated digits.
- Examples: "2 hazar 5 so 60", "2 hazar 5 so sath", and "do hazaar paanch sau saath" all mean 2,560.
- Roman Urdu number words include so/sau=100, sath/saath=60, sattar=70, assi=80, and nabbe=90.
- description is short and useful; exclude the numeric amount and currency.
- ambiguous is true when amount or direction cannot be determined confidently.

Transaction: ${text.trim()}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                amount: { type: "number", minimum: 0 },
                description: { type: "string" },
                direction: { type: "string", enum: ["IN", "OUT"] },
                action: { type: "string", enum: ["Received", "Spent", "Withdrawn", "Deposited"] },
                ambiguous: { type: "boolean" }
              },
              required: ["amount", "description", "direction", "action", "ambiguous"],
              additionalProperties: false
            }
          }
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Gemini request failed", response.status, detail.slice(0, 500));
      return json(req, { error: "AI parsing is temporarily unavailable" }, 502);
    }

    const data = await response.json();
    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!output) return json(req, { error: "Gemini returned no result" }, 502);
    const result = JSON.parse(output);
    const deterministicAmount = parseSpokenAmount(text);
    if (deterministicAmount > 0) result.amount = deterministicAmount;
    return json(req, result);
  } catch (error) {
    console.error("parse-transaction error", error);
    return json(req, { error: "Could not parse transaction" }, 400);
  }
});
