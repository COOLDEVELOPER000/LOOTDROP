-- ─────────────────────────────────────────────────────────────────
-- LootDrop — Supabase Schema  (run ONCE in SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────

-- 1. Games table ────────────────────────────────────────────────────
-- Note the model change vs the old version: instead of a single
-- `expires_at`, every offer now stores a WINDOW (starts_at / ends_at).
-- The frontend decides live / upcoming / expired by comparing to now(),
-- so timing is exact regardless of how often the sync cron runs.
CREATE TABLE IF NOT EXISTS public.games (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    title            text         NOT NULL,
    type             text         NOT NULL CHECK (type IN ('limited', 'f2p')),
    platform         text         NOT NULL CHECK (platform IN ('steam', 'epic', 'gog')),
    discount_percent integer      DEFAULT 0,
    original_price   text,
    image_url        text,
    store_link       text,
    starts_at        timestamptz,         -- when the offer goes live (null = already live / always free)
    ends_at          timestamptz,         -- when it expires (null = unknown / permanent)
    external_id      text         NOT NULL,
    created_at       timestamptz  DEFAULT now(),
    updated_at       timestamptz  DEFAULT now(),

    UNIQUE (external_id, platform)
);

CREATE INDEX IF NOT EXISTS games_type_platform_idx ON public.games (type, platform);
CREATE INDEX IF NOT EXISTS games_window_idx        ON public.games (starts_at, ends_at);

-- 2. Sync log ───────────────────────────────────────────────────────
-- Doubles as (a) observability and (b) a guaranteed write on every run.
-- That write is what keeps the free-tier project from auto-pausing,
-- so the sync cron is also the keep-alive heartbeat. No extra ping job.
CREATE TABLE IF NOT EXISTS public.sync_log (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ran_at      timestamptz  DEFAULT now(),
    steam_count integer      DEFAULT 0,
    epic_count  integer      DEFAULT 0,
    new_count   integer      DEFAULT 0,
    ok          boolean      DEFAULT true,
    note        text
);

-- 3. Keep updated_at fresh on every change ──────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS games_updated_at ON public.games;
CREATE TRIGGER games_updated_at
    BEFORE UPDATE ON public.games
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- 4. Row Level Security — public read-only ──────────────────────────
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read games" ON public.games;
CREATE POLICY "Public can read games"
    ON public.games FOR SELECT
    TO anon, authenticated
    USING (true);

-- sync_log stays private (no SELECT policy = service role only).
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

-- 5. Seed rows so the site renders before the first sync ────────────
-- (Steam capsule URLs use the reliable cdn.cloudflare host. The sync
--  function replaces all of this with live data on its first run.)
INSERT INTO public.games (title, type, platform, discount_percent, original_price, image_url, store_link, starts_at, ends_at, external_id)
VALUES
    ('Counter-Strike 2', 'f2p', 'steam', 0, NULL,
     'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg',
     'https://store.steampowered.com/app/730', NULL, NULL, 'steam_730'),
    ('Apex Legends', 'f2p', 'steam', 0, NULL,
     'https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/header.jpg',
     'https://store.steampowered.com/app/1172470', NULL, NULL, 'steam_1172470'),
    ('Warframe', 'f2p', 'steam', 0, NULL,
     'https://cdn.cloudflare.steamstatic.com/steam/apps/230410/header.jpg',
     'https://store.steampowered.com/app/230410', NULL, NULL, 'steam_230410'),
    ('Dota 2', 'f2p', 'steam', 0, NULL,
     'https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg',
     'https://store.steampowered.com/app/570', NULL, NULL, 'steam_570')
ON CONFLICT (external_id, platform) DO NOTHING;

-- 6. Verify
SELECT title, type, platform, starts_at, ends_at FROM public.games ORDER BY type, platform;
