import {
  getRank, getNextRank, normalizeStorageData,
  CRACKED_THRESHOLD, AURA_BAR_MAX, STRINGS, todayLocalString,
} from './utils.js';

const STALE_MS = 30 * 60 * 1000; // auto-fetch if data is older than 30 min

const formatNumber = (n) => Math.round(n).toLocaleString();

const formatTime = (iso) => {
  if (!iso) return '';
  const d      = new Date(iso);
  const now    = new Date();
  const diffMs = now - d;
  if (diffMs < 0) return 'just now';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  return d.toLocaleDateString();
};

const isStale = (lastFetched) => {
  if (!lastFetched) return true;
  return (Date.now() - new Date(lastFetched).getTime()) > STALE_MS;
};

// Returns YYYY-MM-DD of any ISO timestamp in local time
const localDateOf = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const setBar = (id, pct, modifier) => {
  const el = document.getElementById(id);
  if (!el) return;
  requestAnimationFrame(() => {
    el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (modifier !== undefined) el.className = `progress-bar ${modifier}`;
  });
};

const render = (raw) => {
  const data = normalizeStorageData(raw);
  const {
    username, daily_target, streak, longest_streak,
    aura, cracked_bar, cracked_achieved, today_commits, last_fetched,
  } = data;

  document.getElementById('username-display').textContent = username ? `@${username}` : '';

  const commitsPct = daily_target > 0 ? (today_commits / daily_target) * 100 : 0;
  const targetHit  = today_commits >= daily_target;
  setBar('commits-bar', commitsPct, targetHit ? 'target-hit' : 'commits-bar');
  document.getElementById('commits-text').textContent  = `${today_commits} / ${daily_target}`;
  document.getElementById('streak-fire').textContent   = streak > 0 ? `🔥 ${streak} day streak!` : '';

  document.getElementById('streak-display').textContent = `🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}`;
  document.getElementById('best-streak').textContent    = `Best: ${longest_streak} day${longest_streak !== 1 ? 's' : ''}`;

  setBar('aura-bar', Math.min(100, (aura / AURA_BAR_MAX) * 100), 'aura-bar');
  document.getElementById('aura-points').textContent = `${formatNumber(aura)} ✨`;

  const crackedPct = (cracked_bar / CRACKED_THRESHOLD) * 100;
  setBar('cracked-bar', crackedPct, 'cracked-bar');
  document.getElementById('cracked-text').textContent = `Day ${cracked_bar} / ${CRACKED_THRESHOLD}`;

  const achievementEl = document.getElementById('cracked-achievement');
  if (cracked_achieved || cracked_bar >= CRACKED_THRESHOLD) {
    achievementEl.classList.remove('hidden');
  } else {
    achievementEl.classList.add('hidden');
  }

  const rank     = getRank(streak);
  const nextRank = getNextRank(streak);
  const rankNextEl = document.getElementById('rank-next');

  document.getElementById('rank-display').textContent = `${rank.emoji} ${rank.name}`;
  document.getElementById('rank-tagline').textContent = rank.tagline;

  rankNextEl.textContent = '';
  if (nextRank) {
    const streakNeeded = nextRank.min - streak;
    rankNextEl.append(
      'Next rank: ',
      Object.assign(document.createElement('span'), {
        textContent: `${nextRank.emoji} ${nextRank.name}`,
      }),
      ` → ${streakNeeded} more day${streakNeeded !== 1 ? 's' : ''}`,
    );
  } else {
    rankNextEl.textContent = STRINGS.alreadyCracked;
  }

  document.getElementById('last-updated').textContent =
    last_fetched ? `Updated ${formatTime(last_fetched)}` : '';
};

const showError = (msg) => {
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('no-username').classList.add('hidden');
  document.getElementById('error-card').classList.remove('hidden');
  document.getElementById('error-text').textContent = msg;
};

const showNoUsername = () => {
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
  document.getElementById('no-username').classList.remove('hidden');
};

const showMain = () => {
  document.getElementById('no-username').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
};

// Prevent concurrent fetches (e.g. auto-fetch + manual refresh at same time)
let fetching = false;

const fetchAndRender = async () => {
  if (fetching) return;
  fetching = true;
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
    const fresh = await chrome.storage.local.get(null);
    if (fresh.username) render(normalizeStorageData(fresh));
  } catch (_) {
    showError(STRINGS.refreshFailed);
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
    fetching = false;
  }
};

const loadAndRender = async () => {
  try {
    const raw = await chrome.storage.local.get(null);
    if (!raw.username) { showNoUsername(); return; }

    const data = normalizeStorageData(raw);

    // If last_fetched is from a prior day, show 0 for today's commits until
    // the fresh fetch arrives — avoids briefly displaying yesterday's count
    if (raw.last_fetched && localDateOf(raw.last_fetched) !== todayLocalString()) {
      data.today_commits = 0;
    }

    showMain();
    render(data);

    // Auto-refresh if cached data is stale (older than 30 min or from a prior day)
    if (isStale(raw.last_fetched)) fetchAndRender();
  } catch (_) {
    showError(STRINGS.loadFailed);
  }
};

// Opens settings in a new tab — chrome.tabs.create works without the tabs
// permission when the URL is a chrome-extension:// URL
const openSettings = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
};

document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();
  document.getElementById('refresh-btn').addEventListener('click', fetchAndRender);
  document.getElementById('settings-link').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
  document.getElementById('settings-link-inline').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
});
