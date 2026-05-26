'use strict';

const RANKS = [
  { min: 0,  max: 2,  emoji: '🧳', name: 'Tourist',        tagline: 'just visiting' },
  { min: 3,  max: 6,  emoji: '☕', name: 'Bay Area Intern', tagline: 'learning the ropes' },
  { min: 7,  max: 13, emoji: '📚', name: 'CS Undergrad',    tagline: 'pulling all nighters' },
  { min: 14, max: 20, emoji: '🎓', name: 'Stanford Kid',    tagline: 'thinks he\'s cracked' },
  { min: 21, max: 29, emoji: '⚡', name: 'YC Founder',      tagline: 'shipping at 3am' },
  { min: 30, max: Infinity, emoji: '🧠', name: 'CRACKED',   tagline: 'no further questions' },
];

function getRank(streak) {
  return RANKS.find(r => streak >= r.min && streak <= r.max) || RANKS[0];
}

function getNextRank(streak) {
  const idx = RANKS.findIndex(r => streak >= r.min && streak <= r.max);
  return idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}

function formatNumber(n) {
  return n.toLocaleString();
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString();
}

function setBar(id, pct, className) {
  const el = document.getElementById(id);
  if (!el) return;
  requestAnimationFrame(() => {
    el.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (className) el.className = `progress-bar ${className}`;
  });
}

function render(data) {
  const {
    username = '',
    daily_target = 3,
    streak = 0,
    longest_streak = 0,
    aura = 0,
    cracked_bar = 0,
    today_commits = 0,
    last_fetched = null,
  } = data;

  // Username
  document.getElementById('username-display').textContent = username ? `@${username}` : '';

  // Today's commits
  const commitsPct = daily_target > 0 ? (today_commits / daily_target) * 100 : 0;
  const targetHit = today_commits >= daily_target;
  setBar('commits-bar', commitsPct, targetHit ? 'progress-bar target-hit' : 'progress-bar commits-bar');
  document.getElementById('commits-text').textContent = `${today_commits} / ${daily_target}`;
  const fireEl = document.getElementById('streak-fire');
  fireEl.textContent = streak > 0 ? `🔥 ${streak} day streak!` : '';

  // Streak
  document.getElementById('streak-display').textContent = `🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}`;
  document.getElementById('best-streak').textContent = `Best: ${longest_streak} day${longest_streak !== 1 ? 's' : ''}`;

  // Aura
  const auraPct = Math.min(100, (aura / 5000) * 100);
  setBar('aura-bar', auraPct, 'progress-bar aura-bar');
  document.getElementById('aura-points').textContent = `${formatNumber(aura)} ✨`;

  // Cracked bar
  const crackedPct = (cracked_bar / 30) * 100;
  setBar('cracked-bar', crackedPct, 'progress-bar cracked-bar');
  document.getElementById('cracked-text').textContent = `Day ${cracked_bar} / 30`;

  const achievementEl = document.getElementById('cracked-achievement');
  if (cracked_bar >= 30) {
    achievementEl.classList.remove('hidden');
  } else {
    achievementEl.classList.add('hidden');
  }

  // Rank
  const rank = getRank(streak);
  document.getElementById('rank-display').textContent = `${rank.emoji} ${rank.name}`;
  document.getElementById('rank-tagline').textContent = rank.tagline;

  const nextRank = getNextRank(streak);
  const rankNextEl = document.getElementById('rank-next');
  if (nextRank) {
    const streakNeeded = nextRank.min - streak;
    rankNextEl.innerHTML = `Next rank: <span>${nextRank.emoji} ${nextRank.name}</span> → ${streakNeeded} more day${streakNeeded !== 1 ? 's' : ''}`;
  } else {
    rankNextEl.textContent = 'Max rank achieved. Respect. 🫡';
  }

  // Last updated
  document.getElementById('last-updated').textContent = last_fetched ? `Updated ${formatTime(last_fetched)}` : '';
}

function showError(msg) {
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('no-username').classList.add('hidden');
  const errCard = document.getElementById('error-card');
  errCard.classList.remove('hidden');
  document.getElementById('error-text').textContent = msg;
}

function showNoUsername() {
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
  document.getElementById('no-username').classList.remove('hidden');
}

function showMain() {
  document.getElementById('no-username').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

async function loadAndRender() {
  try {
    const data = await chrome.storage.local.get(null);
    if (!data.username) {
      showNoUsername();
      return;
    }
    showMain();
    render(data);
  } catch (err) {
    showError('Failed to load data. Please try again.');
  }
}

async function triggerRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
    await loadAndRender();
  } catch (err) {
    showError('Refresh failed. Check your connection.');
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function openSettings() {
  chrome.runtime.openOptionsPage
    ? chrome.runtime.openOptionsPage()
    : chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
}

document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();

  document.getElementById('refresh-btn').addEventListener('click', triggerRefresh);
  document.getElementById('settings-link').addEventListener('click', e => { e.preventDefault(); openSettings(); });
  document.getElementById('settings-link-inline').addEventListener('click', e => { e.preventDefault(); openSettings(); });
});
