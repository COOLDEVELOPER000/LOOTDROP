// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zcrlfagdpjtungpodaqj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hGIcEXo88RzGj2-Qz87epg_qVTle43i';

// ── State ────────────────────────────────────────────────────────────────────
let allGames     = [];
let currentFilter = 'all';
let countdownInterval = null;

// ── Supabase Fetch ────────────────────────────────────────────────────────────
async function fetchGames() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/games?select=*&order=created_at.desc`,
        {
            headers: {
                'apikey':        SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type':  'application/json',
            }
        }
    );

    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
    return res.json();
}

// ── Countdown Timer ───────────────────────────────────────────────────────────
function startCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
        const now  = Date.now();
        const end  = new Date(expiresAt).getTime();
        const diff = end - now;

        if (diff <= 0) {
            clearInterval(countdownInterval);
            renderHero(allGames); // re-render: deal may have expired
            return;
        }

        const days  = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const mins  = Math.floor((diff % 3600000) / 60000);
        const secs  = Math.floor((diff % 60000) / 1000);

        const el = id => document.getElementById(id);
        if (el('cd-days'))  el('cd-days').textContent  = String(days).padStart(2, '0');
        if (el('cd-hours')) el('cd-hours').textContent = String(hours).padStart(2, '0');
        if (el('cd-mins'))  el('cd-mins').textContent  = String(mins).padStart(2, '0');
        if (el('cd-secs'))  el('cd-secs').textContent  = String(secs).padStart(2, '0');
    }

    update();
    countdownInterval = setInterval(update, 1000);
}

// ── Render Hero ───────────────────────────────────────────────────────────────
function renderHero(games) {
    const heroContent = document.getElementById('hero-content');
    const heroSection = document.getElementById('hero-section');

    const deals = games.filter(g => g.type === 'limited' && g.discount_percent === 100);

    if (!deals.length) {
        heroSection.style.display = 'none';
        return;
    }

    heroSection.style.display = '';
    const deal = deals[0];

    const countdownHTML = deal.expires_at ? `
        <div class="hero-countdown">
            <span class="countdown-label">Ends in</span>
            <div class="countdown-unit"><span class="countdown-number" id="cd-days">--</span><span class="countdown-unit-label">Days</span></div>
            <div class="countdown-unit"><span class="countdown-number" id="cd-hours">--</span><span class="countdown-unit-label">Hrs</span></div>
            <div class="countdown-unit"><span class="countdown-number" id="cd-mins">--</span><span class="countdown-unit-label">Min</span></div>
            <div class="countdown-unit"><span class="countdown-number" id="cd-secs">--</span><span class="countdown-unit-label">Sec</span></div>
        </div>
    ` : '';

    const priceHTML = deal.original_price
        ? `<span class="hero-original-price">Was ${deal.original_price}</span>`
        : '';

    heroContent.innerHTML = `
        <div class="hero-game">
            <div class="hero-img-wrap">
                <img src="${deal.image_url}" alt="${deal.title}" loading="lazy"
                     onerror="this.src='https://via.placeholder.com/460x215/13161e/6b7280?text=No+Image'">
                <span class="hero-platform-badge">${deal.platform || 'Game'}</span>
            </div>
            <div class="hero-info">
                <h1>${deal.title}</h1>
                <div class="hero-price-row">
                    <span class="hero-free-tag">FREE</span>
                    ${priceHTML}
                </div>
                ${countdownHTML}
                <a href="${deal.store_link || '#'}" target="_blank" rel="noopener" class="btn-claim">
                    Claim on ${capitalize(deal.platform || 'Store')}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </a>
            </div>
        </div>
    `;

    if (deal.expires_at) startCountdown(deal.expires_at);
}

// ── Render Grid ───────────────────────────────────────────────────────────────
function renderGrid(games) {
    const grid      = document.getElementById('game-grid');
    const noResults = document.getElementById('no-results');
    const countEl   = document.getElementById('game-count');

    grid.innerHTML = '';

    if (!games.length) {
        noResults.classList.remove('hidden');
        countEl.textContent = '';
        return;
    }

    noResults.classList.add('hidden');
    countEl.textContent = `${games.length} game${games.length !== 1 ? 's' : ''}`;

    games.forEach(game => {
        const card = document.createElement('a');
        card.className   = 'game-card';
        card.href        = game.store_link || '#';
        card.target      = '_blank';
        card.rel         = 'noopener';
        card.innerHTML   = `
            <img src="${game.image_url}" alt="${game.title}" loading="lazy"
                 onerror="this.src='https://via.placeholder.com/240x138/13161e/6b7280?text=No+Image'">
            <div class="game-info">
                <div class="card-meta">
                    <span class="platform-tag">${game.platform || ''}</span>
                    <span class="free-badge">Free</span>
                </div>
                <h3>${game.title}</h3>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ── Filter Logic ──────────────────────────────────────────────────────────────
function applyFilters() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    const searchTerm = document.getElementById('search-term');
    if (searchTerm) searchTerm.textContent = query;

    let filtered = allGames.filter(g => g.type === 'f2p');

    if (currentFilter !== 'all') {
        filtered = filtered.filter(g => g.platform === currentFilter);
    }

    if (query) {
        filtered = filtered.filter(g =>
            g.title.toLowerCase().includes(query)
        );
    }

    renderGrid(filtered);
}

// ── Error State ───────────────────────────────────────────────────────────────
function showError(message) {
    document.getElementById('hero-content').innerHTML = '';
    document.getElementById('hero-section').style.display = 'none';
    document.getElementById('game-grid').innerHTML = `
        <div class="error-state" style="grid-column:1/-1">
            <strong>Couldn't load games</strong>
            ${message}<br><br>
            <button onclick="init()" style="background:var(--accent);border:none;color:var(--bg);padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
                Try again
            </button>
        </div>
    `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    // Reset skeletons
    document.getElementById('game-grid').innerHTML = `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
    `;

    try {
        allGames = await fetchGames();
        renderHero(allGames);
        applyFilters();
    } catch (err) {
        console.error('LootDrop fetch error:', err);
        showError('Check your connection or Supabase setup.');
    }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', applyFilters);

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.platform;
        applyFilters();
    });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
