// Bottle & Bite — pairing API (Vercel serverless function, Node.js runtime, no dependencies)
//
// POST /api/pair
// Body: { mode: "bottle"|"food", name?: string, occasion?: string,
//         country?: { name, cur, ex:[lo,hi] }, image?: "<base64 JPEG/PNG/WebP>", imageType?: "image/jpeg" }
// Returns the pairing JSON the page renders, or { error: "<code>", message } with an HTTP error status.
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY         required  your key from console.anthropic.com
//   ANTHROPIC_MODEL           optional  default "claude-haiku-4-5-20251001" (fast and cheap, reads images)
//   DAILY_LIMIT               optional  scans per visitor per day, default 20
//   UPSTASH_REDIS_REST_URL    optional  enables reliable rate limiting across all servers
//   UPSTASH_REDIS_REST_TOKEN  optional  (both come from a free Upstash Redis database)
//   ALLOWED_ORIGINS           optional  extra comma-separated origins allowed to call this API (e.g. your custom domain)

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || "20", 10);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // base64 payload cap (the page sends ~150 KB)
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const OCCASIONS = new Set([
  "any", "quick snacks", "dinner at home", "date night", "barbecue", "movie night",
  "on a tight budget, cheap supermarket options only",
]);

// ---------- rate limiting ----------
const memoryHits = new Map(); // fallback: per server instance only (resets on cold start)

async function overLimit(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `bb:${day}:${ip}`;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const r = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, "90000"]]),
      });
      const out = await r.json();
      const count = Number(out?.[0]?.result || 0);
      return count > DAILY_LIMIT;
    } catch {
      // If Redis is down, fall through to the in-memory limiter rather than blocking everyone.
    }
  }
  const count = (memoryHits.get(key) || 0) + 1;
  memoryHits.set(key, count);
  if (memoryHits.size > 5000) memoryHits.clear();
  return count > DAILY_LIMIT;
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(req.headers["x-real-ip"] || "") || "unknown";
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GET-less fetches may omit it; the rate limit still applies
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
    if (o.hostname === "localhost" || o.hostname === "127.0.0.1") return true;
  } catch { return false; }
  const extra = String(process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return extra.includes(origin);
}

// ---------- prompts (kept on the server so the API can't be used as a free chatbot) ----------
const clean = (s, max = 80) => String(s || "").replace(/[\r\n"`]/g, " ").trim().slice(0, max);

function money(cur, n) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); }
  catch { return `${n} ${cur}`; }
}

function priceRules(country) {
  const name = clean(country?.name, 60) || "the European Union";
  const cur = /^[A-Z]{3}$/.test(country?.cur || "") ? country.cur : "EUR";
  const lo = Number(country?.ex?.[0]) || 8, hi = Number(country?.ex?.[1]) || 12;
  return `The user shops in ${name}. Recommend drinks and foods that are easy to find in shops and supermarkets there, and favor local products when they fit.
Prices: give realistic retail price ranges in ${cur} as typical in ${name}, written in that currency like "${money(cur, lo)}–${money(cur, hi)}". Keep ranges tight and honest. If the occasion is a budget one, keep everything cheap.`;
}

function bottlePrompt({ hasImage, name, occasion, country }) {
  return `You are a friendly sommelier and beer expert.
${hasImage ? "The attached photo shows a wine or beer bottle or its label. Read the label." : ""}
${name ? `The user says the drink is: "${name}".` : ""}
Occasion the user is planning for: ${occasion}.

Identify the drink as precisely as you can, estimate its shop price per bottle, then suggest food pairings that fit the occasion.
Give 3 snacks and 3 meals (if the occasion is "quick snacks", give 5 snacks and 1 meal). Prefer everyday foods people can actually buy or cook; when the drink is from a specific region, include at least one pairing from that region's cuisine.
For each food, "price" is the rough total cost to buy the ingredients (or ready-made snack) for 2 people.
${priceRules(country)}
If the image or name is clearly not a wine or beer, set "not_a_drink": true and leave the rest empty.

Reply with ONLY this JSON, no other text:
{"not_a_drink": false,
 "drink": {"name": "", "producer": "", "kind": "wine|beer|other", "style": "", "region": "", "vintage": "", "abv": "", "notes": ["3-5 short flavor notes"], "confidence": "high|medium|low", "price": "price range per bottle"},
 "serve": "one short line: temperature in °C and glass",
 "pairings": [{"food": "", "category": "snack|meal", "why": "one short sentence", "price": "price range"}],
 "avoid": ["1-2 foods that clash"]}
Use empty strings for anything you can't see or know.`;
}

function foodPrompt({ hasImage, name, occasion, country }) {
  return `You are a friendly sommelier and beer expert.
${hasImage ? "The attached photo shows a dish, snack or plate of food. Identify it." : ""}
${name ? `The user says the food is: "${name}".` : ""}
Occasion the user is planning for: ${occasion}.

Identify the food, then recommend drinks that pair well with it: 3 wines and 2 beers.
Spread them across price tiers: at least one "budget", one "mid" and one "splurge" option overall (unless the occasion is a budget one, then all budget or mid).
Recommend styles or grape varieties people can find in a normal shop (you may name a well-known example), and favor local options when the dish is regional.
Each "price" is the typical shop price for one bottle (wine 0.75 l, beer 0.5 l).
${priceRules(country)}
If the image or name is clearly not food, set "not_food": true and leave the rest empty.

Reply with ONLY this JSON, no other text:
{"not_food": false,
 "dish": {"name": "", "description": "one short line", "cuisine": "", "flavors": ["3-5 short flavor words"], "confidence": "high|medium|low"},
 "drinks": [{"name": "", "kind": "wine|beer", "style": "short style + region", "why": "one short sentence", "price": "price range", "tier": "budget|mid|splurge"}],
 "avoid": ["1-2 drink styles that clash"]}
Use empty strings for anything you can't see or know.`;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

const fail = (res, status, error, message) => res.status(status).json({ error, message });

// ---------- handler ----------
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fail(res, 405, "bad_request", "Use POST.");
  if (!originAllowed(req)) return fail(res, 403, "forbidden", "This API only serves the Bottle & Bite page.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 500, "not_configured", "ANTHROPIC_API_KEY is not set.");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== "object") return fail(res, 400, "bad_request", "Send JSON.");

  const mode = body.mode === "food" ? "food" : "bottle";
  const name = clean(body.name, 80);
  const occasion = OCCASIONS.has(body.occasion) ? body.occasion : "any";
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^,]+,/, "") : "";
  const imageType = IMAGE_TYPES.has(body.imageType) ? body.imageType : "image/jpeg";

  if (!image && !name) return fail(res, 400, "bad_request", "Add a photo or a name.");
  if (image && (image.length > MAX_IMAGE_BYTES || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200)))) {
    return fail(res, 413, "image_rejected", "Photo is too large or not an image.");
  }

  if (await overLimit(clientIp(req))) {
    return fail(res, 429, "rate_limited", `Daily limit of ${DAILY_LIMIT} scans reached.`);
  }

  const args = { hasImage: !!image, name, occasion, country: body.country };
  const prompt = mode === "food" ? foodPrompt(args) : bottlePrompt(args);
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: imageType, data: image } });
  content.push({ type: "text", text: prompt });

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
  } catch {
    return fail(res, 502, "upstream_error", "Couldn't reach the AI service.");
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("Anthropic error", r.status, detail.slice(0, 500));
    if (r.status === 429 || r.status === 529) return fail(res, 503, "busy", "The AI service is busy.");
    if (r.status === 400 && /image/i.test(detail)) return fail(res, 400, "image_rejected", "The AI couldn't read that photo.");
    return fail(res, 502, "upstream_error", "The AI service returned an error.");
  }

  const out = await r.json();
  const text = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const data = parseJson(text);
  if (!data || typeof data !== "object") return fail(res, 502, "invalid_json", "The answer came back garbled.");
  return res.status(200).json(data);
};
