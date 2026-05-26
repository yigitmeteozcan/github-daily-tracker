import {
  getRank, getNextRank, normalizeStorageData, validateUsername,
  CRACKED_THRESHOLD, AURA_BAR_MAX, STRINGS, todayLocalString,
} from './utils.js';

const STALE_MS = 30 * 60 * 1000;

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

const localDateOf = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Stale if: no data, older than 30 min, or from a previous day
const isStale = (lastFetched) => {
  if (!lastFetched) return true;
  if (localDateOf(lastFetched) !== todayLocalString()) return true;
  return (Date.now() - new Date(lastFetched).getTime()) > STALE_MS;
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
  // Pass both classes so .commits-bar.target-hit CSS rule can match
  setBar('commits-bar', commitsPct, targetHit ? 'commits-bar target-hit' : 'commits-bar');
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

// --- View switching ---

const hideAll = () => {
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('no-username').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
  document.getElementById('settings-view').classList.add('hidden');
};

const showError = (msg) => {
  hideAll();
  document.getElementById('popup-footer').classList.remove('hidden');
  document.getElementById('error-card').classList.remove('hidden');
  document.getElementById('error-text').textContent = msg;
};

const showNoUsername = () => {
  hideAll();
  document.getElementById('popup-footer').classList.remove('hidden');
  document.getElementById('no-username').classList.remove('hidden');
};

const showMain = () => {
  hideAll();
  document.getElementById('popup-footer').classList.remove('hidden');
  document.getElementById('main-content').classList.remove('hidden');
};

const loadSettingsView = async () => {
  const raw  = await chrome.storage.local.get(null);
  const data = normalizeStorageData(raw);
  document.getElementById('username-input').value     = data.username;
  document.getElementById('target-slider').value      = data.daily_target;
  document.getElementById('target-value').textContent = data.daily_target;
  document.getElementById('notif-time').value         = data.notification_time;
  const rank = getRank(data.streak);
  document.getElementById('stat-streak').textContent  = `${data.streak}🔥`;
  document.getElementById('stat-aura').textContent    = data.aura.toLocaleString();
  document.getElementById('stat-rank').textContent    = rank.emoji;
  document.getElementById('stat-today').textContent   = String(data.today_commits);
};

const showSettings = async () => {
  hideAll();
  document.getElementById('popup-footer').classList.add('hidden');
  document.getElementById('username-error').classList.add('hidden');
  document.getElementById('save-status').classList.add('hidden');
  document.getElementById('settings-view').classList.remove('hidden');
  await loadSettingsView();
};

// --- Fetch logic ---

// Fetch today's commit count directly from the GitHub Events API.
// More reliable than service worker HTML parsing — returns an integer or null.
const fetchTodayCommits = async (username) => {
  try {
    const today = todayLocalString();
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
      { cache: 'no-store', headers: { Accept: 'application/vnd.github.v3+json' } },
    );
    if (!res.ok) return null;
    const events = await res.json();
    if (!Array.isArray(events)) return null;
    let count = 0;
    for (const ev of events) {
      if (ev.type !== 'PushEvent' || !ev.created_at) continue;
      const d = new Date(ev.created_at);
      const evDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (evDate === today) count += ev.payload?.size ?? ev.payload?.commits?.length ?? 0;
    }
    return count;
  } catch {
    return null;
  }
};

let fetching = false;

const fetchAndRender = async () => {
  if (fetching) return;
  fetching = true;
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    const raw      = await chrome.storage.local.get(null);
    const username = raw.username;
    if (!username) { showNoUsername(); return; }

    // Fetch commit count directly in the popup — bypass service-worker HTML parsing
    const count = await fetchTodayCommits(username);

    try {
      if (count !== null) {
        // Send the real count to the service worker so it can update game state
        await chrome.runtime.sendMessage({ type: 'FETCH_NOW_WITH_COUNT', count });
      } else {
        // Events API unavailable — let the service worker try its own strategies
        await chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
      }
    } catch (_) {
      // Service worker unreachable — write the count directly so the UI updates
      if (count !== null) {
        await chrome.storage.local.set({
          today_commits: count,
          last_fetched: new Date().toISOString(),
        });
      }
    }

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

    // Show 0 for today if last fetch was from a prior day (avoids flickering yesterday's count)
    if (raw.last_fetched && localDateOf(raw.last_fetched) !== todayLocalString()) {
      data.today_commits = 0;
    }

    showMain();
    render(data);

    // Always fetch fresh data when the popup opens — cached data shown instantly above,
    // then updated once the background fetch completes
    fetchAndRender();
  } catch (_) {
    showError(STRINGS.loadFailed);
  }
};

// --- DOMContentLoaded ---

document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();

  // Live update: re-render whenever the background writes new commit/streak data
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!('today_commits' in changes || 'streak' in changes || 'aura' in changes)) return;
    if (document.getElementById('main-content').classList.contains('hidden')) return;
    chrome.storage.local.get(null).then((raw) => {
      if (raw.username) render(normalizeStorageData(raw));
    }).catch(() => {});
  });

  document.getElementById('refresh-btn').addEventListener('click', fetchAndRender);

  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    showSettings();
  });

  document.getElementById('settings-link-inline').addEventListener('click', (e) => {
    e.preventDefault();
    showSettings();
  });

  document.getElementById('back-to-main').addEventListener('click', (e) => {
    e.preventDefault();
    loadAndRender();
  });

  document.getElementById('target-slider').addEventListener('input', (e) => {
    document.getElementById('target-value').textContent = e.target.value;
  });

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('username-error').classList.add('hidden');

    const rawUsername       = document.getElementById('username-input').value.trim().replace(/^@/, '');
    const daily_target      = parseInt(document.getElementById('target-slider').value, 10);
    const notification_time = document.getElementById('notif-time').value;

    if (!validateUsername(rawUsername)) {
      const errEl = document.getElementById('username-error');
      errEl.textContent = STRINGS.invalidUsername;
      errEl.classList.remove('hidden');
      return;
    }

    const existing     = await chrome.storage.local.get('username');
    const prevUsername = existing.username || '';
    const usernameChanged = prevUsername !== '' && prevUsername !== rawUsername;

    await chrome.storage.local.set({ username: rawUsername, daily_target, notification_time });

    if (usernameChanged) {
      await chrome.storage.local.set({
        streak: 0, longest_streak: 0, aura: 0, cracked_bar: 0,
        cracked_achieved: false, today_commits: 0,
        last_active_date: '', last_fetched: '', history: {},
      });
    }

    try { await chrome.runtime.sendMessage({ type: 'RESCHEDULE_NOTIFICATION' }); } catch (_) {}
    try { await chrome.runtime.sendMessage({ type: 'FETCH_NOW' }); } catch (_) {}

    const savedEl = document.getElementById('save-status');
    savedEl.textContent = usernameChanged ? STRINGS.usernameChanged : '✓ Saved!';
    savedEl.classList.remove('hidden');
    setTimeout(() => savedEl.classList.add('hidden'), 3000);

    await loadSettingsView();
  });

  document.getElementById('test-notif-btn').addEventListener('click', async () => {
    const raw      = await chrome.storage.local.get(['today_commits', 'daily_target']);
    const data     = normalizeStorageData(raw);
    const remaining = Math.max(0, data.daily_target - data.today_commits);
    chrome.notifications.create('test-notification', {
      type:    'basic',
      iconUrl: 'icons/icon-red-48.png',
      title:   '⚠️ Streak at risk!',
      message: remaining > 0
        ? `You have ${data.today_commits} commit${data.today_commits !== 1 ? 's' : ''}. Need ${remaining} more to stay alive. Don't let your aura fade. 🔴`
        : "You've already hit your target today! Keep it up. 🟢",
    });
  });
});
