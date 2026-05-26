'use strict';

const RANKS = [
  { min: 0,  max: 2,  emoji: '🧳', name: 'Tourist' },
  { min: 3,  max: 6,  emoji: '☕', name: 'Bay Area Intern' },
  { min: 7,  max: 13, emoji: '📚', name: 'CS Undergrad' },
  { min: 14, max: 20, emoji: '🎓', name: 'Stanford Kid' },
  { min: 21, max: 29, emoji: '⚡', name: 'YC Founder' },
  { min: 30, max: Infinity, emoji: '🧠', name: 'CRACKED' },
];

function getRank(streak) {
  return RANKS.find(r => streak >= r.min && streak <= r.max) || RANKS[0];
}

async function loadSettings() {
  const data = await chrome.storage.local.get(null);

  document.getElementById('username-input').value = data.username || '';
  document.getElementById('target-slider').value = data.daily_target || 3;
  document.getElementById('target-value').textContent = data.daily_target || 3;
  document.getElementById('notif-time').value = data.notification_time || '21:00';

  // Stats
  const streak = data.streak || 0;
  const aura = data.aura || 0;
  const rank = getRank(streak);

  document.getElementById('stat-streak').textContent = `${streak}🔥`;
  document.getElementById('stat-aura').textContent = aura.toLocaleString();
  document.getElementById('stat-rank').textContent = `${rank.emoji}`;
  document.getElementById('stat-today').textContent = `${data.today_commits || 0}`;
}

function showSaved() {
  const el = document.getElementById('save-status');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  // Live slider label
  document.getElementById('target-slider').addEventListener('input', e => {
    document.getElementById('target-value').textContent = e.target.value;
  });

  // Save form
  document.getElementById('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('username-input').value.trim().replace(/^@/, '');
    const daily_target = parseInt(document.getElementById('target-slider').value, 10);
    const notification_time = document.getElementById('notif-time').value;

    await chrome.storage.local.set({ username, daily_target, notification_time });

    // Reschedule notification alarm with new time
    try {
      await chrome.runtime.sendMessage({ type: 'RESCHEDULE_NOTIFICATION' });
    } catch (_) {}

    showSaved();
    await loadSettings();
  });

  // Test notification
  document.getElementById('test-notif-btn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['today_commits', 'daily_target']);
    const commits = data.today_commits || 0;
    const target = data.daily_target || 3;
    const remaining = Math.max(0, target - commits);
    chrome.notifications.create('test-notification', {
      type: 'basic',
      iconUrl: 'icons/icon-red-48.png',
      title: '⚠️ Streak at risk!',
      message: remaining > 0
        ? `You have ${commits} commit${commits !== 1 ? 's' : ''}. Need ${remaining} more to stay alive. Don't let your aura fade. 🔴`
        : `You've already hit your target today! Keep it up. 🟢`,
    });
  });

  // Back button
  document.getElementById('back-btn').addEventListener('click', e => {
    e.preventDefault();
    window.close();
  });
});
