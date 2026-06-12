# LootDrop 🎮

A dark-themed free game finder. Automatically fetches 100% off deals and free-to-play games from Steam and Epic Games every 6 hours.

**Live site:** https://YOUR-USERNAME.github.io/lootdrop

---

## Setup Guide

### Step 1 — Supabase Database

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. Click **SQL Editor** → **New Query**
3. Paste the entire contents of `supabase_schema.sql` and click **Run**
4. You should see the sample games appear in the results

### Step 2 — GitHub Repo

1. Create a new repo at github.com — name it `lootdrop`
2. Upload all files from this folder into the repo
3. Go to **Settings → Pages → Source** → set to **GitHub Actions**
4. Push to `main` — it auto-deploys in ~30 seconds

### Step 3 — Supabase Edge Function

Install the Supabase CLI first:
```bash
npm install -g supabase
```

Then deploy the sync function:
```bash
cd lootdrop
supabase login
supabase link --project-ref zcrlfagdpjtungpodaqj
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase functions deploy sync-games
```

### Step 4 — Set up the Cron Job

1. Go to Supabase Dashboard → **Edge Functions** → **sync-games**
2. Click **Schedule** → Add schedule
3. Set cron expression: `0 */6 * * *` (every 6 hours)
4. Save

Or invoke it manually to test:
```bash
supabase functions invoke sync-games
```

---

## Project Structure

```
lootdrop/
├── index.html                          # Frontend — structure
├── style.css                           # Frontend — dark gamer styles
├── script.js                           # Frontend — Supabase fetch + render
├── supabase_schema.sql                 # Run once in Supabase SQL Editor
├── supabase/
│   └── functions/
│       └── sync-games/
│           └── index.ts               # Edge Function — fetches Steam + Epic
└── .github/
    └── workflows/
        └── deploy.yml                 # Auto-deploy to GitHub Pages on push
```

---

## Supabase Table: `games`

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| title | text | Game name |
| type | text | `limited` or `f2p` |
| platform | text | `steam`, `epic`, or `gog` |
| discount_percent | integer | 100 for free deals |
| original_price | text | e.g. `$29.99` |
| image_url | text | Capsule image |
| store_link | text | Direct store URL |
| expires_at | timestamptz | For countdown timer |
| external_id | text | Unique per platform |

---

## Cost: $0

- Supabase free tier: 500MB database, Edge Functions included
- GitHub Pages: free
- Steam API: free, no key required
- Epic GraphQL API: free, no key required
