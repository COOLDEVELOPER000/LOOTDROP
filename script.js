// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zcrlfagdpjtungpodaqj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hGIcEXo88RzGj2-Qz87epg_qVTle43i';

// ── State ─────────────────────────────────────────────────────────────────────
let GAMES = [];
let platform = 'all';
let query = '';
let ticker = null;

// ── Helpers ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const PLACEHOLDER = 'https://placehold.co/460x259/171a22/7c8598?text=No+image';

function statusOf(g) {
  const now = Date.now();
  const start = g.starts_at ? new Date(g.starts_at).getTime() : -Infinity;
  const end   = g.ends_at   ? new Date(g.ends_at).getTime()   :  Infinity;
  if (now < start) return 'upcoming';
  if (now >= end)  return 'expired';
  return 'live';
}

// "2d 04h" / "5h 12m" / "47m"
function compact(ms) {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function matches(g) {
  if (platform !== 'all' && g.platform !== platform) return false;
  if (query && !(g.title || '').toLowerCase().includes(query)) return false;
  return true;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────
async function fetchGames() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/games?select=*&order=ends_at.asc.nullslast,created_at.desc`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ── Card builder ────────────────────────────────────────────────────────────
function card(g, tone) {
  let pill;
  if (tone === 'now')  pill = g.ends_at ? `Ends in ${compact(new Date(g.ends_at) - Date.now())}` : 'Keep forever';
  else if (tone === 'soon') pill = `Free in ${Math.max(1, Math.ceil((new Date(g.starts_at) - Date.now()) / 86400000))}d`;
  else pill = 'Free';

  const a = document.createElement('a');
  a.className = `card card--${tone}`;
  a.href = g.store_link || '#';
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = `
    <div class="card-media"><img src="${g.image_url || PLACEHOLDER}" alt="${esc(g.title)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'"></div>
    <div class="card-body">
      <div class="card-meta">
        <span class="platform">${esc(g.platform || '')}</span>
        <span class="pill pill--${tone}">${pill}</span>
      </div>
      <span class="card-title">${esc(g.title)}</span>
    </div>`;
  return a;
}

function fillGrid(gridId, secId, countId, list, tone, noun) {
  const grid = $(gridId);
  grid.innerHTML = '';
  if (!list.length) { $(secId).hidden = true; return 0; }
  list.forEach((g, i) => {
    const c = card(g, tone);
    c.style.animationDelay = `${Math.min(i * 35, 350)}ms`;
    grid.appendChild(c);
  });
  $(countId).textContent = `${list.length} ${noun}${list.length === 1 ? '' : 's'}`;
  $(secId).hidden = false;
  return list.length;
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function renderHero(deal) {
  const hero = $('hero');
  if (!deal) { hero.hidden = true; if (ticker) { clearInterval(ticker); ticker = null; } return; }
  hero.hidden = false;

  const was = deal.original_price ? `<span class="was">was ${esc(deal.original_price)}</span>` : '';
  const cd = deal.ends_at ? `
    <div class="countdown" id="cd">
      <div><div class="cd-cap">Ends in</div></div>
      ${['d', 'h', 'm', 's'].map((u) => `<div class="cd-unit"><span class="cd-num" id="cd-${u}">--</span><span class="cd-lbl">${{ d: 'days', h: 'hrs', m: 'min', s: 'sec' }[u]}</span></div>`).join('')}
    </div>` : '';

  $('hero-inner').innerHTML = `
    <div class="hero-media"><img src="${deal.image_url || PLACEHOLDER}" alt="${esc(deal.title)}" onerror="this.src='${PLACEHOLDER}'"></div>
    <div class="hero-info">
      <span class="eyebrow eyebrow--urgent"><i class="dot"></i>Featured deal</span>
      <h2 class="hero-title">${esc(deal.title)}</h2>
      <div class="hero-price"><span class="tag-free">FREE</span>${was}</div>
      ${cd}
      <a class="claim" href="${deal.store_link || '#'}" target="_blank" rel="noopener">
        Claim on ${cap(deal.platform || 'store')}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </a>
    </div>`;

  if (ticker) { clearInterval(ticker); ticker = null; }
  if (deal.ends_at) startTicker(new Date(deal.ends_at).getTime());
}

function startTicker(end) {
  const tick = () => {
    const diff = end - Date.now();
    if (diff <= 0) { clearInterval(ticker); ticker = null; render(); return; }
    const set = (u, v) => { const el = $(`cd-${u}`); if (el) el.textContent = String(v).padStart(2, '0'); };
    set('d', Math.floor(diff / 86400000));
    set('h', Math.floor((diff % 86400000) / 3600000));
    set('m', Math.floor((diff % 3600000) / 60000));
    set('s', Math.floor((diff % 60000) / 1000));
  };
  tick();
  ticker = setInterval(tick, 1000);
}

// ── Render (filters + search apply to everything) ──────────────────────────────
function render() {
  $('loading').hidden = true;
  $('error').hidden = true;

  const visible = GAMES.filter(matches);
  const live = visible.filter((g) => g.type === 'limited' && statusOf(g) === 'live');
  const soon = visible.filter((g) => g.type === 'limited' && statusOf(g) === 'upcoming' && g.starts_at)
                      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const f2p = visible.filter((g) => g.type === 'f2p' && statusOf(g) !== 'expired');

  // Featured = soonest-ending live deal (so the countdown is real); else first live.
  const withEnd = live.filter((g) => g.ends_at).sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at));
  const hero = withEnd[0] || live[0] || null;
  renderHero(hero);

  const rest = hero ? live.filter((g) => g.external_id !== hero.external_id) : live;

  const n = fillGrid('grid-now',  'sec-now',  'count-now',  rest, 'now',  'deal')
          + fillGrid('grid-soon', 'sec-soon', 'count-soon', soon, 'soon', 'game')
          + fillGrid('grid-f2p',  'sec-f2p',  'count-f2p',  f2p,  'f2p',  'game');

  // Empty state only when nothing at all is showing (incl. hero)
  const empty = $('empty');
  if (!hero && n === 0) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-msg"><strong>${query || platform !== 'all' ? 'Nothing matches that' : 'No free games right now'}</strong>${query || platform !== 'all' ? 'Try a different name or switch platforms.' : 'Check back soon — the list refreshes every hour.'}</div>`;
  } else {
    empty.hidden = true;
  }
}

function showError() {
  $('loading').hidden = true;
  ['hero', 'sec-now', 'sec-soon', 'sec-f2p', 'empty'].forEach((id) => { $(id).hidden = true; });
  const e = $('error');
  e.hidden = false;
  e.innerHTML = `<div class="error-msg"><strong>Couldn't load games</strong>Check your connection and try again.<br><button class="retry" id="retry">Retry</button></div>`;
  $('retry').addEventListener('click', init);
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  $('error').hidden = true;
  $('loading').hidden = false;
  try {
    GAMES = await fetchGames();
    render();
  } catch (err) {
    console.error('LootDrop:', err);
    showError();
  }
}

// ── Events ─────────────────────────────────────────────────────────────────────
$('q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    platform = btn.dataset.platform;
    render();
  });
});

init();
