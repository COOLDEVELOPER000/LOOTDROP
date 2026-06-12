// ─────────────────────────────────────────────────────────────────────────────
// LootDrop — Edge Function: sync-games
// Fetches free/discounted games from Steam & Epic and upserts into Supabase
//
// Deploy:  supabase functions deploy sync-games
// Manual:  supabase functions invoke sync-games
// Cron:    Set in Supabase Dashboard → Edge Functions → sync-games → Schedule
//          Expression: 0 */6 * * *  (every 6 hours)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE  = Deno.env.get('SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ── Types ─────────────────────────────────────────────────────────────────────
interface GameRow {
    title:            string;
    type:             'limited' | 'f2p';
    platform:         'steam' | 'epic' | 'gog';
    discount_percent: number;
    original_price:   string | null;
    image_url:        string | null;
    store_link:       string;
    expires_at:       string | null;
    external_id:      string;
}

// ── Steam ─────────────────────────────────────────────────────────────────────
// Uses the Steam Storefront API — no key required
async function fetchSteamFreeGames(): Promise<GameRow[]> {
    const games: GameRow[] = [];

    try {
        // Fetch games currently 100% off from Steam's featured deals
        const featuredRes = await fetch(
            'https://store.steampowered.com/api/featuredcategories?cc=us&l=en',
            { headers: { 'User-Agent': 'LootDrop/1.0' } }
        );
        const featured = await featuredRes.json();

        // Check Specials (limited-time deals)
        const specials = featured?.specials?.items ?? [];
        for (const item of specials) {
            if (item.discount_percent === 100) {
                games.push({
                    title:            item.name,
                    type:             'limited',
                    platform:         'steam',
                    discount_percent: 100,
                    original_price:   item.original_price
                        ? `$${(item.original_price / 100).toFixed(2)}`
                        : null,
                    image_url:        item.large_capsule_image || item.header_image,
                    store_link:       `https://store.steampowered.com/app/${item.id}`,
                    expires_at:       null, // Steam doesn't expose end dates in this endpoint
                    external_id:      `steam_${item.id}`,
                });
            }
        }

        // Fetch the known-free-to-play list from Steam
        const f2pRes = await fetch(
            'https://store.steampowered.com/api/appdetails?appids=730,1172470,230410,578080,252490,346110&filters=basic,price_overview',
            { headers: { 'User-Agent': 'LootDrop/1.0' } }
        );
        const f2pData = await f2pRes.json();

        for (const [appId, appInfo] of Object.entries(f2pData as Record<string, any>)) {
            if (!appInfo.success) continue;
            const data = appInfo.data;
            if (data.is_free) {
                games.push({
                    title:            data.name,
                    type:             'f2p',
                    platform:         'steam',
                    discount_percent: 0,
                    original_price:   null,
                    image_url:        `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
                    store_link:       `https://store.steampowered.com/app/${appId}`,
                    expires_at:       null,
                    external_id:      `steam_${appId}`,
                });
            }
        }
    } catch (err) {
        console.error('Steam fetch error:', err);
    }

    return games;
}

// ── Epic Games ────────────────────────────────────────────────────────────────
// Uses Epic's public promotions GraphQL endpoint — no key required
async function fetchEpicFreeGames(): Promise<GameRow[]> {
    const games: GameRow[] = [];

    try {
        const query = `{
            Catalog {
                searchStore(
                    allowCountries: "US"
                    country: "US"
                    locale: "en-US"
                    sortBy: "effectiveDate"
                    sortDir: "asc"
                    freeGame: true
                    onSale: true
                ) {
                    elements {
                        title
                        id
                        namespace
                        keyImages { type url }
                        price(country: "US") {
                            totalPrice {
                                discountPrice
                                originalPrice
                                discount
                            }
                        }
                        promotions(category: "promo/free-games") {
                            promotionalOffers {
                                promotionalOffers {
                                    startDate
                                    endDate
                                    discountSetting { discountType discountPercentage }
                                }
                            }
                            upcomingPromotionalOffers {
                                promotionalOffers {
                                    startDate
                                    endDate
                                }
                            }
                        }
                        catalogNs { mappings(pageType: "productHome") { pageSlug pageType } }
                    }
                }
            }
        }`;

        const res = await fetch('https://graphql.epicgames.com/graphql', {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent':   'LootDrop/1.0',
            },
            body: JSON.stringify({ query }),
        });

        const json = await res.json();
        const elements = json?.data?.Catalog?.searchStore?.elements ?? [];

        for (const item of elements) {
            const offers = item.promotions?.promotionalOffers?.[0]?.promotionalOffers ?? [];
            const isCurrentlyFree = offers.some((o: any) =>
                o.discountSetting?.discountPercentage === 0 &&
                new Date(o.startDate) <= new Date() &&
                new Date(o.endDate) > new Date()
            );

            if (!isCurrentlyFree) continue;

            const endDate = offers[0]?.endDate ?? null;
            const slug    = item.catalogNs?.mappings?.[0]?.pageSlug ?? item.id;
            const thumb   = item.keyImages?.find((i: any) => i.type === 'Thumbnail')?.url
                         ?? item.keyImages?.[0]?.url
                         ?? null;
            const origCents = item.price?.totalPrice?.originalPrice ?? 0;

            games.push({
                title:            item.title,
                type:             origCents > 0 ? 'limited' : 'f2p',
                platform:         'epic',
                discount_percent: origCents > 0 ? 100 : 0,
                original_price:   origCents > 0 ? `$${(origCents / 100).toFixed(2)}` : null,
                image_url:        thumb,
                store_link:       `https://store.epicgames.com/en-US/p/${slug}`,
                expires_at:       endDate,
                external_id:      `epic_${item.id}`,
            });
        }
    } catch (err) {
        console.error('Epic fetch error:', err);
    }

    return games;
}

// ── Upsert to Supabase ────────────────────────────────────────────────────────
async function upsertGames(games: GameRow[]) {
    if (!games.length) return { inserted: 0, errors: 0 };

    const { data, error } = await supabase
        .from('games')
        .upsert(games, {
            onConflict:        'external_id,platform',
            ignoreDuplicates:  false,
        })
        .select('id');

    if (error) {
        console.error('Upsert error:', error);
        return { inserted: 0, errors: 1 };
    }

    return { inserted: data?.length ?? 0, errors: 0 };
}

// ── Remove expired limited deals ──────────────────────────────────────────────
async function cleanupExpired() {
    const { error } = await supabase
        .from('games')
        .delete()
        .eq('type', 'limited')
        .lt('expires_at', new Date().toISOString());

    if (error) console.error('Cleanup error:', error);
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (_req) => {
    try {
        console.log('LootDrop sync starting…');

        const [steamGames, epicGames] = await Promise.all([
            fetchSteamFreeGames(),
            fetchEpicFreeGames(),
        ]);

        const allGames = [...steamGames, ...epicGames];
        console.log(`Fetched: ${steamGames.length} Steam, ${epicGames.length} Epic`);

        const result = await upsertGames(allGames);
        await cleanupExpired();

        const summary = {
            success:  true,
            fetched:  allGames.length,
            upserted: result.inserted,
            steam:    steamGames.length,
            epic:     epicGames.length,
            timestamp: new Date().toISOString(),
        };

        console.log('Sync complete:', summary);

        return new Response(JSON.stringify(summary), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('Sync failed:', err);
        return new Response(JSON.stringify({ success: false, error: String(err) }), {
            status:  500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
