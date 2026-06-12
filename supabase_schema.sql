-- ─────────────────────────────────────────────────────────────────
-- LootDrop — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────

-- 1. Create the games table
CREATE TABLE IF NOT EXISTS public.games (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    title            text         NOT NULL,
    type             text         NOT NULL CHECK (type IN ('limited', 'f2p')),
    platform         text         NOT NULL CHECK (platform IN ('steam', 'epic', 'gog')),
    discount_percent integer      DEFAULT 0,
    original_price   text,
    image_url        text,
    store_link       text,
    expires_at       timestamptz,
    external_id      text,
    created_at       timestamptz  DEFAULT now(),
    updated_at       timestamptz  DEFAULT now(),

    -- Prevent duplicate games per platform
    UNIQUE (external_id, platform)
);

-- 2. Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER games_updated_at
    BEFORE UPDATE ON public.games
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 3. Row Level Security — public read-only (no login needed)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read games"
    ON public.games
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- 4. Insert sample data so the frontend works immediately
-- (The Edge Function will replace this with real data later)
INSERT INTO public.games (title, type, platform, discount_percent, original_price, image_url, store_link, expires_at, external_id)
VALUES
    (
        'Dying Light — Enhanced Edition',
        'limited',
        'steam',
        100,
        '$29.99',
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/239140/capsule_616x353.jpg',
        'https://store.steampowered.com/app/239140',
        now() + interval '3 days',
        'steam_239140'
    ),
    (
        'Counter-Strike 2',
        'f2p',
        'steam',
        0,
        NULL,
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/capsule_616x353.jpg',
        'https://store.steampowered.com/app/730',
        NULL,
        'steam_730'
    ),
    (
        'Apex Legends',
        'f2p',
        'steam',
        0,
        NULL,
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1172470/capsule_616x353.jpg',
        'https://store.steampowered.com/app/1172470',
        NULL,
        'steam_1172470'
    ),
    (
        'Warframe',
        'f2p',
        'steam',
        0,
        NULL,
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/230410/capsule_616x353.jpg',
        'https://store.steampowered.com/app/230410',
        NULL,
        'steam_230410'
    ),
    (
        'Fortnite',
        'f2p',
        'epic',
        0,
        NULL,
        'https://cdn2.unrealengine.com/fortnite-chapter-4-season-4-1920x1080-1920x1080-d0f2c3f5a8d7.jpg',
        'https://store.epicgames.com/en-US/p/fortnite',
        NULL,
        'epic_fortnite'
    ),
    (
        'Rocket League',
        'f2p',
        'epic',
        0,
        NULL,
        'https://cdn2.unrealengine.com/rocket-league-1920x1080-1920x1080-6f73e8f9c8d2.jpg',
        'https://store.epicgames.com/en-US/p/rocket-league',
        NULL,
        'epic_rocket-league'
    )
ON CONFLICT (external_id, platform) DO NOTHING;

-- 5. Verify setup
SELECT id, title, type, platform, expires_at FROM public.games ORDER BY type, platform;
