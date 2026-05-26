import { getRank, validateUsername, normalizeStorageData, STRINGS } from './utils.js';

const getEl = (id) => document.getElementById(id);

const showSaved = (msg = '✓ Saved!') => {
  const el = getEl('save-status');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
};

const showUsernameError = (msg) => {
  const el = getEl('username-error');
  el.textContent = msg;
  el.classList.remove('hidden');
};

const clearUsernameError = () => {
  getEl('username-error').classList.add('hidden');
};

const loadSettings = async () => {
  const raw  = await chrome.storage.local.get(null);
  const data = normalizeStorageData(raw);

  getEl('username-input').value    = data.username;
  getEl('target-slider').value     = data.daily_target;
  getEl('target-value').textContent = data.daily_target;
  getEl('notif-time').value        = data.notification_time;

  const rank = getRank(data.streak);
  getEl('stat-streak').textContent = `${data.streak}🔥`;
  getEl('stat-aura').textContent   = data.aura.toLocaleString();
  getEl('stat-rank').textContent   = rank.emoji;
  getEl('stat-today').textContent  = String(data.today_commits);
};

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  getEl('target-slider').addEventListener('input', (e) => {
    getEl('target-value').textContent = e.target.value;
  });

  getEl('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearUsernameError();

    const rawUsername    = getEl('username-input').value.trim().replace(/^@/, '');
    const daily_target   = parseInt(getEl('target-slider').value, 10);
    const notification_time = getEl('notif-time').value;

    if (!validateUsername(rawUsername)) {
      showUsernameError(STRINGS.invalidUsername);
      return;
    }

    const existing    = await chrome.storage.local.get('username');
    const prevUsername = existing.username || '';
    const usernameChanged = prevUsername !== '' && prevUsername !== rawUsername;

    await chrome.storage.local.set({
      username: rawUsername,
      daily_target,
      notification_time,
    });

    if (usernameChanged) {
      // New user — full game state reset
      await chrome.storage.local.set({
        streak:           0,
        longest_streak:   0,
        aura:             0,
        cracked_bar:      0,
        cracked_achieved: false,
        today_commits:    0,
        last_active_date: '',
        last_fetched:     '',
        history:          {},
      });
    }

    try {
      await chrome.runtime.sendMessage({ type: 'RESCHEDULE_NOTIFICATION' });
    } catch (_) {}

    showSaved(usernameChanged ? STRINGS.usernameChanged : '✓ Saved!');
    await loadSettings();
  });

  getEl('test-notif-btn').addEventListener('click', async () => {
    const raw    = await chrome.storage.local.get(['today_commits', 'daily_target']);
    const data   = normalizeStorageData(raw);
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

  getEl('back-btn').addEventListener('click', (e) => {
    e.preventDefault();
    window.close();
  });
});
