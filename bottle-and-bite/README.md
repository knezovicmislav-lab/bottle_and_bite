# Bottle & Bite

Snap a wine or beer label to find food that goes with it, or snap your food to find the right drink. Prices come in the visitor's local currency, and every scan is saved as a photo "memory" (with an optional selfie) on the visitor's own phone.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The whole app (one page). |
| `privacy.html` | Privacy policy page. **Fill in the yellow `[...]` parts before going live.** |
| `api/pair.js` | The backend. Receives the photo, asks Claude for pairings with your secret API key, and sends the answer back. Also enforces a daily scan limit per visitor. |
| `vercel.json` | Vercel settings (lets the AI take up to 60 seconds). |
| `package.json` | Tells Vercel which Node.js version to use. No packages to install. |

## Deploy in about 15 minutes

### 1. Get an Anthropic API key
1. Go to **console.anthropic.com** and sign up.
2. Add a payment method under **Billing** and buy a small amount of credit (e.g. $5–10).
3. Under **Limits**, set a **monthly spend limit** (e.g. $20) so a surprise bill is impossible.
4. Under **API Keys**, create a key. Copy it somewhere safe; you'll only see it once. Never paste it into `index.html`.

### 2. Put the code on GitHub
1. Create a free account at **github.com**.
2. Click **+ → New repository**, name it `bottle-and-bite`, keep it **Private**, and create it.
3. Click **uploading an existing file**, drag in everything from this folder (including the `api` folder), and click **Commit changes**.

### 3. Deploy on Vercel
1. Go to **vercel.com**, sign up with your GitHub account.
2. Click **Add New → Project** and **Import** the `bottle-and-bite` repository.
3. Framework preset: **Other**. Leave build settings empty.
4. Open **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key from step 1
5. Click **Deploy**. After a minute you get a link like `bottle-and-bite.vercel.app`. Open it on your phone and try a scan.

Every time you upload changed files to GitHub, Vercel redeploys automatically.

**Alternative without GitHub:** install Node.js, open a terminal in this folder, run `npx vercel`, follow the prompts, then add the environment variable in the Vercel dashboard and run `npx vercel --prod`.

## Optional settings (Vercel → Settings → Environment Variables)

| Variable | Default | What it does |
|---|---|---|
| `DAILY_LIMIT` | `20` | Scans per visitor (IP address) per day. |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | The Claude model. Haiku is fast and cheap. For sharper label reading, try a Sonnet model (costs more per scan). |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | not set | Makes the daily limit reliable. Without them, the limit is counted per server instance and resets when Vercel restarts it, so it's only a soft limit. Create a free database at **upstash.com → Redis**, then copy the two "REST" values from its page. |
| `ALLOWED_ORIGINS` | not set | If you add a custom domain *and* keep another domain pointing at the same app, list extra origins here, comma-separated (e.g. `https://bottleandbite.com`). Normally not needed: the API already accepts calls from whatever domain it's served on. |

After changing a variable, redeploy (Deployments → ⋯ → Redeploy).

## Costs, roughly
- **Vercel:** free on the Hobby plan, but Hobby is for **personal, non-commercial use only**. If you add ads, sell anything, or charge for the app, move to the Pro plan.
- **Anthropic:** you pay per scan. With the default Haiku model, a photo scan is usually around one US cent or less. Your monthly spend limit caps the worst case.

## Before you share it publicly
- [ ] Fill in the `[...]` parts in `privacy.html` (your name, country, email, date).
- [ ] Set a monthly spend limit in the Anthropic console.
- [ ] Consider setting up Upstash so the daily limit can't be dodged.
- [ ] Check the name "Bottle & Bite" on **tmview.org** and that the domain you want is free.
- [ ] Try it on both an iPhone and an Android phone.

## How the privacy works
- Photos are shrunk on the phone, sent once to the backend, passed to Claude, and not stored on the server.
- Memories, scanned photos, selfies, the country choice and the age confirmation are stored only in the visitor's browser (localStorage and IndexedDB). Selfies are never uploaded.
- The age gate asks for 21+ in the US and 18+ elsewhere, and is remembered on the device.
