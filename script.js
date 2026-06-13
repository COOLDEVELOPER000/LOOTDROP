// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zcrlfagdpjtungpodaqj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hGIcEXo88RzGj2-Qz87epg_qVTle43i';

// ── State ───────────────────────────────────────────────────────────────────
let allGames = [];
let currentFilter = 'all';
let countdownInterval = null;

// ── Window helpers ────────────────────────────────────────────────────────────
// Status is derived on the client from the offer window, so the live/upcoming/
// expired transition is exact regardless of when the sync cron last ran.
function statusOf(g) {
  const now = Date.now();
  const start = g.starts_at ? new Date(g.starts_at).getTime() : -Infinity;
  const end   = g.ends_at   ? new Date(g.ends_at).getTime()   :  Infinity;
  if (now < start) return 'upcoming';
  if (now >= end)  return 'expired';
  return 'live';
}

// ── Fetch ──────────────────────────────────────────────────────────────────────
async function fetchGames() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/games?select=*&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

// ── Countdown ───────────────────────────────────────────────────────────────
// Counts down to `target` (ms epoch). On reaching zero, re-renders everything
// so an expired deal disappears and an upcoming one promotes itself to live.
function startCountdown(targetMs) {
  if (countdownInterval) clearInterval(countdownInterval);

  function tick() {
    const diff = targetMs - Date.now();
    if (diff <= 0) {
      clearInterval(countdownInterval);
      render();
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v).padStart(2, '0'); };
    set('cd-days', d); set('cd-hours', h); set('cd-mins', m); set('cd-secs', s);
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ── Hero (live limited deals) ──────────────────────────────────────────────────
function renderHero(games) {
  const heroContent = document.getElementById('hero-content');
  const heroSection = document.getElementById('hero-section');

  const deals = games.filter((g) => g.type === 'limited' && statusOf(g) === 'live');
  if (!deals.length) { heroSection.style.display = 'none'; return; }
  heroSection.style.display = '';

  const deal = deals[0];
  const countdownHTML = deal.ends_at ? `
    <div class="hero-countdown">
      <span class="countdown-label">Ends in</span>
      <div class="countdown-unit"><span class="countdown-number" id="cd-days">--</span><span class="countdown-unit-label">Days</span></div>
      <div class="countdown-unit"><span class="countdown-number" id="cd-hours">--</span><span class="countdown-unit-label">Hrs</span></div>
      <div class="countdown-unit"><span class="countdown-number" id="cd-mins">--</span><span class="countdown-unit-label">Min</span></div>
      <div class="countdown-unit"><span class="countdown-number" id="cd-secs">--</span><span class="countdown-unit-label">Sec</span></div>
    </div>` : '';

  const priceHTML = deal.original_price ? `<span class="hero-original-price">Was ${deal.original_price}</span>` : '';

  heroContent.innerHTML = `
    <div class="hero-game">
      <div class="hero-img-wrap">
        <img src="${deal.image_url}" alt="${escapeAttr(deal.title)}" loading="lazy"
             onerror="this.src='https://placehold.co/460x215/13161e/6b7280?text=No+Image'">
        <span class="hero-platform-badge">${deal.platform || 'Game'}</span>
      </div>
      <div class="hero-info">
        <h1>${escapeHtml(deal.title)}</h1>
        <div class="hero-price-row"><span class="hero-free-tag">FREE</span>${priceHTML}</div>
        ${countdownHTML}
        <a href="${deal.store_link || '#'}" target="_blank" rel="noopener" class="btn-claim">
          Claim on ${capitalize(deal.platform || 'Store')}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>
      </div>
    </div>`;

  if (deal.ends_at) startCountdown(new Date(deal.ends_at).getTime());
}

// ── Upcoming rail (free soon — mostly Epic's next rotation) ─────────────────────
function renderUpcoming(games) {
  const section = document.getElementById('upcoming-section');
  const row = document.getElementById('upcoming-row');
  if (!section || !row) return;

  const soon = games
    .filter((g) => g.type === 'limited' && statusOf(g) === 'upcoming' && g.starts_at)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  if (!soon.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  row.innerHTML = '';

  soon.forEach((g) => {
    const days = Math.max(0, Math.ceil((new Date(g.starts_at).getTime() - Date.now()) / 86400000));
    const card = document.createElement('a');
    card.className = 'game-card upcoming';
    card.href = g.store_link || '#';
    card.target = '_blank';
    card.rel = 'noopener';
    card.innerHTML = `
      <img src="${g.image_url}" alt="${escapeAttr(g.title)}" loading="lazy"
           onerror="this.src='https://placehold.co/240x138/13161e/6b7280?text=No+Image'">
      <div class="game-info">
        <div class="card-meta">
          <span class="platform-tag">${g.platform || ''}</span>
          <span class="soon-badge">Free in ${days}d</span>
        </div>
        <h3>${escapeHtml(g.title)}</h3>
      </div>`;
    row.appendChild(card);
  });
}

// ── F2P grid ─────────────────────────────────────────────────────────────────
function renderGrid(games) {
  const grid = document.getElementById('game-grid');
  const noResults = document.getElementById('no-results');
  const countEl = document.getElementById('game-count');

  grid.innerHTML = '';
  if (!games.length) { noResults.classList.remove('hidden'); countEl.textContent = ''; return; }
  noResults.classList.add('hidden');
  countEl.textContent = `${games.length} game${games.length !== 1 ? 's' : ''}`;

  games.forEach((game) => {
    const card = document.createElement('a');
    card.className = 'game-card';
    card.href = game.store_link || '#';
    card.target = '_blank';
    card.rel = 'noopener';
    card.innerHTML = `
      <img src="${game.image_url}" alt="${escapeAttr(game.title)}" loading="lazy"
           onerror="this.src='https://placehold.co/240x138/13161e/6b7280?text=No+Image'">
      <div class="game-info">
        <div class="card-meta">
          <span class="platform-tag">${game.platform || ''}</span>
          <span class="free-badge">Free</span>
        </div>
        <h3>${escapeHtml(game.title)}</h3>
      </div>`;
    grid.appendChild(card);
  });
}

// ── Filters ──────────────────────────────────────────────────────────────────
function applyFilters() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  const term = document.getElementById('search-term');
  if (term) term.textContent = query;

  let filtered = allGames.filter((g) => g.type === 'f2p' && statusOf(g) !== 'expired');
  if (currentFilter !== 'all') filtered = filtered.filter((g) => g.platform === currentFilter);
  if (query) filtered = filtered.filter((g) => (g.title || '').toLowerCase().includes(query));
  renderGrid(filtered);
}

// ── Render all ────────────────────────────────────────────────────────────────
function render() {
  renderHero(allGames);
  renderUpcoming(allGames);
  applyFilters();
}

// ── Error state ────────────────────────────────────────────────────────────────
function showError(message) {
  document.getElementById('hero-content').innerHTML = '';
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('game-grid').innerHTML = `
    <div class="error-state" style="grid-column:1/-1">
      <strong>Couldn't load games</strong>${message}<br><br>
      <button onclick="init()" style="background:var(--accent);border:none;color:var(--bg);padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Try again</button>
    </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('game-grid').innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');
  try {
    allGames = await fetchGames();
    render();
  } catch (err) {
    console.error('LootDrop fetch error:', err);
    showError('Check your connection or Supabase setup.');
  }
}

// ── Events ─────────────────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', applyFilters);
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.platform;
    applyFilters();
  });
});

init();
