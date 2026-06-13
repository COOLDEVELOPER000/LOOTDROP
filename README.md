# LootDrop 🎮

A dark-themed free-game finder. An hourly sync pulls 100%-off "free to keep"
deals and free-to-play games from Steam and Epic into Supabase; a static
frontend renders them and computes live / upcoming / expired in the browser.

**Live site:** https://YOUR-USERNAME.github.io/lootdrop

---

## How it works

Two ingestion rails, because the platforms are opposite problems:

- **Epic** is schedule-driven. The public promotions feed returns the *current*
  and *upcoming* free games with exact start/end timestamps (about a week
  ahead). We store the windows; the browser decides what's live. Even a daily
  cron would be "on time" — the handoff happens client-side to the second, and
  next week's games show up in the **Free Soon** rail.
- **Steam** is discovery-driven. Free-to-keep promos aren't exposed cleanly, so
  we discover them via the store search `specials=1 & maxprice=free` filter
  (which returns only on-promotion titles), then enrich each appid **one at a
  time** — the multi-appid call returns `null`, which was the original bug.

Because every offer stores a window, "on time" is a data-model property, not a
cron-frequency one. Hourly is plenty: Steam promos run ≥24h so they're never
missed, and Epic timing is exact regardless.

---

## Setup

### 1 — Database
SQL Editor → New Query → paste `supabase_schema.sql` → Run. You'll see the seed
rows in the result.

### 2 — Frontend (GitHub Pages)
1. Create a repo named `lootdrop`, push all files.
2. Settings → Pages → Source → **GitHub Actions**.
3. Push to `main`; `.github/workflows/deploy.yml` publishes the frontend.
4. Edit `SUPABASE_URL` / `SUPABASE_KEY` at the top of `script.js` to your project.

### 3 — Edge Function
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
# optional notifications:
supabase secrets set DISCORD_WEBHOOK_URL=...
supabase secrets set TELEGRAM_BOT_TOKEN=...  TELEGRAM_CHAT_ID=...
supabase functions deploy sync-games
supabase functions invoke sync-games          # test it once
```

### 4 — Schedule (Supabase Cron, free tier)
SQL Editor → run `cron_setup.sql` (fill in your project ref + publishable key).
It enables `pg_cron`/`pg_net`, stores the function URL/key in Vault, and
schedules an hourly invoke.

> The hourly sync writes to `sync_log` every run, which counts as database
> activity — so the cron doubles as the free-tier keep-alive and the project
> won't auto-pause. No separate ping job needed.

Check it's running:
```sql
select * from cron.job_run_details order by start_time desc limit 5;
select * from public.sync_log order by ran_at desc limit 5;
```

---

## `games` table

| Column | Type | Notes |
|---|---|---|
| title | text | Game name |
| type | text | `limited` or `f2p` |
| platform | text | `steam`, `epic`, `gog` |
| discount_percent | int | 100 for free deals |
| original_price | text | e.g. `$29.99` |
| image_url | text | Header/capsule image |
| store_link | text | Direct store URL |
| starts_at | timestamptz | Offer start (null = already live) |
| ends_at | timestamptz | Offer end (null = unknown/permanent) |
| external_id | text | Unique per platform |

---

## Cost: $0
Supabase free tier (DB + Edge Functions + Cron), GitHub Pages, and the Steam/
Epic public endpoints are all free and keyless.

## Notes / limitations
- Steam exposes no end date for most free-to-keep promos, so those show without
  a countdown (Epic carries the countdown UX). When a promo appears in Steam's
  featured specials, its `discount_expiration` is used.
- The curated `STEAM_F2P` list in the function is a small baseline; expand it as
  you like.
