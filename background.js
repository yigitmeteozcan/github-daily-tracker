import {
  validateUsername, parseSvgCount, normalizeStorageData, computeGameState,
  todayLocalString, yesterdayLocalString,
  FETCH_TIMEOUT_MS, FETCH_INTERVAL_MINS, CRACKED_THRESHOLD, AURA_BREAK_PENALTY,
} from './utils.js';

const FETCH_ALARM        = 'fetch-contributions';
const DAILY_RESET_ALARM  = 'daily-reset';
const NOTIFICATION_ALARM = 'daily-notification';
const DEBUG = false;

const dbg = (...args) => { if (DEBUG) console.error('[GDT]', ...args); };

const getStorage  = () => chrome.storage.local.get(null);
const setStorage  = (obj) => chrome.storage.local.set(obj);

const fetchContributions = async (username) => {
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const count = parseSvgCount(text, todayLocalString());
    return count ?? 0;
  } finally {
    clearTimeout(timer);
  }
};

const updateGameState = async (todayCommits) => {
  const raw  = await getStorage();
  const data = normalizeStorageData(raw);
  const update = computeGameState(data, todayCommits);
  await setStorage(update);
  return { ...data, ...update };
};

const updateIcon = async (targetHit, commitCount) => {
  const color = targetHit ? 'green' : 'red';
  try {
    await chrome.action.setIcon({
      path: {
        16:  `icons/icon-${color}-16.png`,
        48:  `icons/icon-${color}-48.png`,
        128: `icons/icon-${color}-128.png`,
      },
    });
  } catch (_) {}
  try {
    await chrome.action.setBadgeText({ text: commitCount > 0 ? String(commitCount) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: targetHit ? '#2ea043' : '#f85149' });
  } catch (_) {}
};

const fireStreakNotification = (todayCommits, dailyTarget) => {
  const remaining = dailyTarget - todayCommits;
  chrome.notifications.create('streak-reminder', {
    type:     'basic',
    iconUrl:  'icons/icon-red-48.png',
    title:    '⚠️ Streak at risk!',
    message:  `You have ${todayCommits} commit${todayCommits !== 1 ? 's' : ''}. Need ${remaining} more to stay alive. Don't let your aura fade. 🔴`,
  });
};

const doFetch = async () => {
  try {
    const raw      = await getStorage();
    const { username, daily_target } = normalizeStorageData(raw);
    if (!username || !validateUsername(username)) return;
    const commits  = await fetchContributions(username);
    const updated  = await updateGameState(commits);
    await updateIcon(commits >= (updated.daily_target ?? daily_target), commits);
  } catch (err) {
    dbg('Fetch failed:', err);
  }
};

const doDailyReset = async () => {
  try {
    const raw       = await getStorage();
    const data      = normalizeStorageData(raw);
    const yesterday = yesterdayLocalString();

    const yesterdayCommits = data.history[yesterday] ?? 0;
    const targetHit        = yesterdayCommits >= data.daily_target;

    // Always reset today_commits to 0 for the new day.
    // Apply streak penalty only if yesterday was missed and streak was alive.
    if (!targetHit && data.streak > 0) {
      await setStorage({
        streak:        0,
        cracked_bar:   data.cracked_achieved ? CRACKED_THRESHOLD : 0,
        aura:          Math.max(0, data.aura - AURA_BREAK_PENALTY),
        today_commits: 0,
      });
    } else {
      await setStorage({ today_commits: 0 });
    }
  } catch (err) {
    dbg('Daily reset failed:', err);
  }
};

const scheduleNotificationAlarm = async () => {
  try {
    const raw = await getStorage();
    const { notification_time } = normalizeStorageData(raw);
    const [hours, minutes] = notification_time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;

    const now    = new Date();
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    await chrome.alarms.clear(NOTIFICATION_ALARM);
    await chrome.alarms.create(NOTIFICATION_ALARM, {
      delayInMinutes:  (target - now) / 60000,
      periodInMinutes: 24 * 60,
    });
  } catch (err) {
    dbg('Notification scheduling failed:', err);
  }
};

const setupAlarms = async () => {
  const now      = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 1, 0);

  chrome.alarms.create(FETCH_ALARM, {
    periodInMinutes: FETCH_INTERVAL_MINS,
    delayInMinutes:  0.5,
  });
  chrome.alarms.create(DAILY_RESET_ALARM, {
    delayInMinutes:  (midnight - now) / 60000,
    periodInMinutes: 24 * 60,
  });
  await scheduleNotificationAlarm();
};

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FETCH_ALARM) {
    await doFetch();
  } else if (alarm.name === DAILY_RESET_ALARM) {
    await doDailyReset();
    await doFetch();
  } else if (alarm.name === NOTIFICATION_ALARM) {
    try {
      const raw  = await getStorage();
      const data = normalizeStorageData(raw);
      if (data.today_commits < data.daily_target) {
        fireStreakNotification(data.today_commits, data.daily_target);
      }
      await scheduleNotificationAlarm();
    } catch (_) {}
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_NOW') {
    doFetch()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'RESCHEDULE_NOTIFICATION') {
    scheduleNotificationAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarms();
  await doFetch();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarms();
  await doFetch();
});
