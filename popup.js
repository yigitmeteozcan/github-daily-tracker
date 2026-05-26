import {
  getRank, getNextRank, normalizeStorageData,
  CRACKED_THRESHOLD, AURA_BAR_MAX, STRINGS,
} from './utils.js';

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

  // textContent only — never innerHTML for user-derived values
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

  const rank         = getRank(streak);
  const nextRank     = getNextRank(streak);
  const rankNextEl   = document.getElementById('rank-next');

  document.getElementById('rank-display').textContent = `${rank.emoji} ${rank.name}`;
  document.getElementById('rank-tagline').textContent = rank.tagline;

  // Build rank-next with DOM nodes — no innerHTML
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

const loadAndRender = async () => {
  try {
    const data = await chrome.storage.local.get(null);
    if (!data.username) { showNoUsername(); return; }
    showMain();
    render(data);
  } catch (_) {
    showError(STRINGS.loadFailed);
  }
};

const triggerRefresh = async () => {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
    await loadAndRender();
  } catch (_) {
    showError(STRINGS.refreshFailed);
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
};

const openSettings = () => chrome.runtime.openOptionsPage();

document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();
  document.getElementById('refresh-btn').addEventListener('click', triggerRefresh);
  document.getElementById('settings-link').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
  document.getElementById('settings-link-inline').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
});
