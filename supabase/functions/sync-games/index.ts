// ─────────────────────────────────────────────────────────────────────────────
// LootDrop — Edge Function: sync-games
//
// Two ingestion rails with opposite characteristics:
//   • Epic  — schedule-driven. The public promotions feed hands us exact
//             start/end windows for CURRENT and UPCOMING free games (a week
//             ahead). We store the windows; the client decides what's live.
//   • Steam — discovery-driven. Free-to-keep promos aren't exposed cleanly, so
//             we discover them via the store search "specials + maxprice=free"
//             filter, then enrich each appid one at a time (the multi-appid
//             call returns null — that was the original bug).
//
// On free-tier Supabase this also serves as the keep-alive: every run writes to
// sync_log, which counts as DB activity and prevents the 7-day auto-pause.
//
// Deploy:  supabase functions deploy sync-games
// Secrets: supabase secrets set SERVICE_ROLE_KEY=...        (required)
//          supabase secrets set DISCORD_WEBHOOK_URL=...     (optional)
//          supabase secrets set TELEGRAM_BOT_TOKEN=...      (optional)
//          supabase secrets set TELEGRAM_CHAT_ID=...        (optional)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SERVICE_ROLE_KEY')!;
const DISCORD_WEBHOOK  = Deno.env.get('DISCORD_WEBHOOK_URL') ?? '';
const TG_TOKEN         = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TG_CHAT          = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

const UA = { 'User-Agent': 'Mozilla/5.0 (LootDrop sync)' };

interface GameRow {
  title:            string;
  type:             'limited' | 'f2p';
  platform:         'steam' | 'epic' | 'gog';
  discount_percent: number;
  original_price:   string | null;
  image_url:        string | null;
  store_link:       string;
  starts_at:        string | null;
  ends_at:          string | null;
  external_id:      string;
}

// Permanent free-to-play titles we always want listed (Steam has no clean
// "all F2P" feed; this is a small curated baseline). Discovery adds the rest.
const STEAM_F2P = ['730', '570', '1172470', '230410', '578080', '252490'];

// ── small helpers ─────────────────────────────────────────────────────────────
const usd = (cents: number | null | undefined) =>
  cents && cents > 0 ? `$${(cents / 100).toFixed(2)}` : null;

const steamImg = (appId: string | number) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

async function appDetails(appId: string): Promise<any | null> {
  // appdetails ONLY works one appid per request — never batch.
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic,price_overview&cc=us&l=en`,
      { headers: UA },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const entry = j?.[appId];
    return entry?.success ? entry.data : null;
  } catch {
    return null;
  }
}

// ── Steam ───────────────────────────────────────────────────────────────────
async function fetchSteam(): Promise<GameRow[]> {
  const out: GameRow[] = [];

  // (a) Build an appid -> discount_expiration map from featuredcategories.
  //     This is the only Steam endpoint that exposes an end date, so it's our
  //     source for limited-deal countdowns when a promo happens to appear here.
  const expiry = new Map<string, number>();
  try {
    const r = await fetch(
      'https://store.steampowered.com/api/featuredcategories?cc=us&l=en',
      { headers: UA },
    );
    const j = await r.json();
    for (const it of (j?.specials?.items ?? [])) {
      if (it?.id && it?.discount_expiration) {
        expiry.set(String(it.id), Number(it.discount_expiration));
      }
    }
  } catch (e) {
    console.error('Steam featuredcategories failed:', e);
  }

  // (b) Discover free-to-keep promos. The `specials=1` filter returns ONLY
  //     on-promotion titles, so permanent F2P (CS2, Dota…) is excluded here.
  const promoIds: string[] = [];
  try {
    const r = await fetch(
      'https://store.steampowered.com/search/results/?maxprice=free&specials=1&cc=us&l=en&infinite=1&count=50',
      { headers: UA },
    );
    const j = await r.json();
    const html: string = j?.results_html ?? '';
    for (const m of html.matchAll(/data-ds-appid="([\d,]+)"/g)) {
      const id = m[1].split(',')[0];           // first id (ignore bundle lists)
      if (id && !promoIds.includes(id)) promoIds.push(id);
    }
  } catch (e) {
    console.error('Steam search failed:', e);
  }

  // (c) Enrich each discovered promo one appid at a time.
  for (const id of promoIds) {
    const d = await appDetails(id);
    if (!d) continue;
    const exp = expiry.get(id);
    out.push({
      title:            d.name,
      type:             'limited',
      platform:         'steam',
      discount_percent: 100,
      original_price:   usd(d.price_overview?.initial),
      image_url:        steamImg(id),
      store_link:       `https://store.steampowered.com/app/${id}`,
      starts_at:        null,                                   // Steam exposes no start
      ends_at:          exp ? new Date(exp * 1000).toISOString() : null,
      external_id:      `steam_${id}`,
    });
    await new Promise((res) => setTimeout(res, 120));           // be polite to Steam
  }

  // (d) Curated permanent F2P baseline.
  for (const id of STEAM_F2P) {
    if (out.some((g) => g.external_id === `steam_${id}`)) continue;
    const d = await appDetails(id);
    if (!d || !d.is_free) continue;
    out.push({
      title:            d.name,
      type:             'f2p',
      platform:         'steam',
      discount_percent: 0,
      original_price:   null,
      image_url:        steamImg(id),
      store_link:       `https://store.steampowered.com/app/${id}`,
      starts_at:        null,
      ends_at:          null,
      external_id:      `steam_${id}`,
    });
    await new Promise((res) => setTimeout(res, 120));
  }

  return out;
}

// ── Epic ──────────────────────────────────────────────────────────────────────
// Correct public endpoint. The old graphql.epicgames.com URL now 404s.
async function fetchEpic(): Promise<GameRow[]> {
  const out: GameRow[] = [];
  try {
    const r = await fetch(
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US',
      { headers: UA },
    );
    const j = await r.json();
    const els = j?.data?.Catalog?.searchStore?.elements ?? [];
    const now = Date.now();

    for (const it of els) {
      const promo  = it?.promotions ?? {};
      const cur    = promo.promotionalOffers?.[0]?.promotionalOffers ?? [];
      const upNext = promo.upcomingPromotionalOffers?.[0]?.promotionalOffers ?? [];

      // a "free" offer is discountPercentage === 0 (you pay 0% of price)
      const isFree = (o: any) => o?.discountSetting?.discountPercentage === 0;
      const current  = cur.find(isFree);
      const upcoming = upNext.find(isFree);
      const offer = current ?? upcoming;
      if (!offer) continue;

      const slug =
        it.catalogNs?.mappings?.[0]?.pageSlug ??
        it.offerMappings?.[0]?.pageSlug ??
        it.productSlug ?? it.urlSlug ?? it.id;

      const img =
        it.keyImages?.find((k: any) => k.type === 'OfferImageWide')?.url ??
        it.keyImages?.find((k: any) => k.type === 'DieselStoreFrontWide')?.url ??
        it.keyImages?.find((k: any) => k.type === 'Thumbnail')?.url ??
        it.keyImages?.[0]?.url ?? null;

      const origCents = it.price?.totalPrice?.originalPrice ?? 0;
      const ended = offer.endDate && new Date(offer.endDate).getTime() < now;
      if (ended) continue;

      out.push({
        title:            it.title,
        type:             'limited',
        platform:         'epic',
        discount_percent: 100,
        original_price:   origCents > 0 ? usd(origCents) : null,
        image_url:        img,
        store_link:       `https://store.epicgames.com/en-US/p/${slug}`,
        starts_at:        offer.startDate ?? null,
        ends_at:          offer.endDate ?? null,
        external_id:      `epic_${it.id}`,
      });
    }
  } catch (e) {
    console.error('Epic fetch failed:', e);
  }
  return out;
}

// ── Notifications (optional, all outbound HTTP — free) ─────────────────────────
async function notify(games: GameRow[]) {
  if (!games.length) return;
  const lines = games.map(
    (g) => `🎮 ${g.title} — FREE on ${g.platform}${g.ends_at ? ` (until ${g.ends_at.slice(0, 10)})` : ''}\n${g.store_link}`,
  );
  const text = `New free game${games.length > 1 ? 's' : ''} on LootDrop:\n\n${lines.join('\n\n')}`;

  if (DISCORD_WEBHOOK) {
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
    } catch (e) { console.error('Discord notify failed:', e); }
  }
  if (TG_TOKEN && TG_CHAT) {
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: false }),
      });
    } catch (e) { console.error('Telegram notify failed:', e); }
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async () => {
  let steam: GameRow[] = [];
  let epic:  GameRow[] = [];
  let newCount = 0;
  let ok = true;
  let note = '';

  try {
    // Rails run independently so one failing doesn't sink the other.
    [steam, epic] = await Promise.all([fetchSteam(), fetchEpic()]);
    const all = [...steam, ...epic];

    if (all.length) {
      // Diff against what we already have to find genuinely-new free games.
      const ids = all.map((g) => g.external_id);
      const { data: existing } = await supabase
        .from('games').select('external_id').in('external_id', ids);
      const known = new Set((existing ?? []).map((r) => r.external_id));
      const fresh = all.filter((g) => g.type === 'limited' && !known.has(g.external_id));
      newCount = fresh.length;

      const { error } = await supabase
        .from('games')
        .upsert(all, { onConflict: 'external_id,platform', ignoreDuplicates: false });
      if (error) { ok = false; note = `upsert: ${error.message}`; }

      // Remove offers that have fully expired (only rows with a known end date).
      await supabase
        .from('games')
        .delete()
        .eq('type', 'limited')
        .not('ends_at', 'is', null)
        .lt('ends_at', new Date().toISOString());

      // Notify only about offers that are live right now.
      const nowIso = new Date().toISOString();
      await notify(fresh.filter((g) => !g.starts_at || g.starts_at <= nowIso));
    } else {
      note = 'no games returned from either source';
    }
  } catch (e) {
    ok = false;
    note = String(e);
    console.error('Sync failed:', e);
  }

  // Always log — this write is also the free-tier keep-alive heartbeat.
  await supabase.from('sync_log').insert({
    steam_count: steam.length,
    epic_count:  epic.length,
    new_count:   newCount,
    ok,
    note: note || null,
  });

  return new Response(
    JSON.stringify({ ok, steam: steam.length, epic: epic.length, new: newCount, note }),
    { status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } },
  );
});
