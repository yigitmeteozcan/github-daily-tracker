'use strict';

const FETCH_ALARM = 'fetch-contributions';
const DAILY_RESET_ALARM = 'daily-reset';
const NOTIFICATION_ALARM = 'daily-notification';

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function getStorage() {
  return chrome.storage.local.get(null);
}

async function setStorage(obj) {
  return chrome.storage.local.set(obj);
}

// ── GitHub fetch ──────────────────────────────────────────────────────────────

async function fetchContributions(username) {
  const url = `https://github.com/users/${username}/contributions`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const text = await res.text();
  const today = todayString();
  // Parse SVG for today's rect
  const regex = new RegExp(`data-date="${today}"[^>]*data-count="(\\d+)"`, 'i');
  const altRegex = new RegExp(`data-count="(\\d+)"[^>]*data-date="${today}"`, 'i');
  const match = text.match(regex) || text.match(altRegex);
  if (!match) {
    // Try DOM parsing as fallback
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const rect = doc.querySelector(`rect[data-date="${today}"]`);
    if (rect) return parseInt(rect.getAttribute('data-count') || '0', 10);
    return 0;
  }
  return parseInt(match[1], 10);
}

// ── Game logic ────────────────────────────────────────────────────────────────

function computeAura(commits, dailyTarget, streakExtended, streakBroke, currentAura) {
  let aura = currentAura;
  aura += commits * 10;
  if (commits >= dailyTarget) aura += 50;
  if (streakExtended) aura += 100;
  if (streakBroke) aura -= 100;
  return Math.max(0, aura);
}

async function updateGameState(todayCommits) {
  const data = await getStorage();
  const {
    username = '',
    daily_target = 3,
    streak = 0,
    longest_streak = 0,
    aura = 0,
    cracked_bar = 0,
    last_active_date = '',
    history = {},
  } = data;

  const today = todayString();
  const yesterday = yesterdayString();

  let newStreak = streak;
  let newCrackedBar = cracked_bar;
  let newAura = aura;
  let streakExtended = false;
  let streakBroke = false;

  const prevHistory = { ...history, [today]: todayCommits };

  // Detect streak break: last_active_date was not yesterday and not today
  if (last_active_date && last_active_date !== today && last_active_date !== yesterday) {
    // Missed at least one day
    streakBroke = true;
    newStreak = 0;
    newCrackedBar = 0;
  }

  const targetHit = todayCommits >= daily_target;

  if (targetHit && last_active_date !== today) {
    // Extending streak today for the first time
    newStreak = streakBroke ? 1 : newStreak + 1;
    newCrackedBar = streakBroke ? 1 : Math.min(30, newCrackedBar + 1);
    streakExtended = true;
  }

  // Recompute aura fresh from commits * 10 delta
  // Only add bonuses when first recording a hit today
  const prevTodayCommits = data.today_commits || 0;
  const commitDelta = Math.max(0, todayCommits - prevTodayCommits);
  newAura = aura + commitDelta * 10;
  if (streakExtended) newAura += 50 + 100; // target bonus + streak bonus
  if (streakBroke) newAura -= 100;
  newAura = Math.max(0, newAura);

  const newLongest = Math.max(longest_streak, newStreak);

  const update = {
    today_commits: todayCommits,
    last_fetched: new Date().toISOString(),
    streak: newStreak,
    longest_streak: newLongest,
    aura: newAura,
    cracked_bar: newCrackedBar,
    history: prevHistory,
  };

  if (targetHit) update.last_active_date = today;

  await setStorage(update);
  return { ...data, ...update };
}

// ── Icon & badge ──────────────────────────────────────────────────────────────

async function updateIcon(targetHit, commitCount) {
  const color = targetHit ? 'green' : 'red';
  try {
    await chrome.action.setIcon({
      path: {
        16: `icons/icon-${color}-16.png`,
        48: `icons/icon-${color}-48.png`,
        128: `icons/icon-${color}-128.png`,
      },
    });
  } catch (_) {}

  try {
    const badge = commitCount > 0 ? String(commitCount) : '';
    await chrome.action.setBadgeText({ text: badge });
    await chrome.action.setBadgeBackgroundColor({
      color: targetHit ? '#2ea043' : '#f85149',
    });
  } catch (_) {}
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function fireStreakNotification(todayCommits, dailyTarget) {
  const remaining = dailyTarget - todayCommits;
  chrome.notifications.create('streak-reminder', {
    type: 'basic',
    iconUrl: 'icons/icon-red-48.png',
    title: '⚠️ Streak at risk!',
    message: `You have ${todayCommits} commit${todayCommits !== 1 ? 's' : ''}. Need ${remaining} more to stay alive. Don't let your aura fade. 🔴`,
  });
}

// ── Main fetch flow ───────────────────────────────────────────────────────────

async function doFetch() {
  try {
    const data = await getStorage();
    const username = data.username;
    if (!username) return;

    const commits = await fetchContributions(username);
    const updated = await updateGameState(commits);
    const targetHit = commits >= (updated.daily_target || 3);
    await updateIcon(targetHit, commits);
  } catch (err) {
    console.error('[GDT] Fetch failed:', err);
  }
}

// ── Daily reset at midnight ───────────────────────────────────────────────────

async function doDailyReset() {
  try {
    const data = await getStorage();
    const yesterday = yesterdayString();

    if (data.last_active_date === yesterday) return; // already counted yesterday

    const yesterdayCommits = (data.history || {})[yesterday] || 0;
    const targetHit = yesterdayCommits >= (data.daily_target || 3);

    if (!targetHit && data.streak > 0) {
      const newAura = Math.max(0, (data.aura || 0) - 100);
      await setStorage({
        streak: 0,
        cracked_bar: 0,
        aura: newAura,
        today_commits: 0,
      });
    } else {
      await setStorage({ today_commits: 0 });
    }
  } catch (err) {
    console.error('[GDT] Daily reset failed:', err);
  }
}

// ── Alarm scheduling ─────────────────────────────────────────────────────────

async function scheduleNotificationAlarm() {
  try {
    const data = await getStorage();
    const time = data.notification_time || '21:00';
    const [hours, minutes] = time.split(':').map(Number);

    const now = new Date();
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    const delayInMinutes = (target - now) / 60000;
    await chrome.alarms.create(NOTIFICATION_ALARM, {
      delayInMinutes,
      periodInMinutes: 24 * 60,
    });
  } catch (err) {
    console.error('[GDT] Notification alarm scheduling failed:', err);
  }
}

async function setupAlarms() {
  // Fetch every 30 minutes
  chrome.alarms.create(FETCH_ALARM, { periodInMinutes: 30, delayInMinutes: 0.5 });

  // Daily reset at midnight
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 1, 0);
  const delayToMidnight = (midnight - now) / 60000;
  chrome.alarms.create(DAILY_RESET_ALARM, { delayInMinutes: delayToMidnight, periodInMinutes: 24 * 60 });

  await scheduleNotificationAlarm();
}

// ── Event listeners ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === FETCH_ALARM) {
    await doFetch();
  } else if (alarm.name === DAILY_RESET_ALARM) {
    await doDailyReset();
    await doFetch();
  } else if (alarm.name === NOTIFICATION_ALARM) {
    try {
      const data = await getStorage();
      if ((data.today_commits || 0) < (data.daily_target || 3)) {
        await fireStreakNotification(data.today_commits || 0, data.daily_target || 3);
      }
      await scheduleNotificationAlarm();
    } catch (err) {
      console.error('[GDT] Notification alarm handler failed:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_NOW') {
    doFetch().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'RESCHEDULE_NOTIFICATION') {
    scheduleNotificationAlarm().then(() => sendResponse({ ok: true }));
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
