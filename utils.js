// Shared constants and pure logic — imported by background.js, popup.js, settings.js

export const USERNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export const CRACKED_THRESHOLD   = 30;
export const MAX_STREAK          = 99999;
export const MAX_AURA            = 9999999;
export const AURA_PER_COMMIT     = 10;
export const AURA_TARGET_BONUS   = 50;
export const AURA_STREAK_BONUS   = 100;
export const AURA_BREAK_PENALTY  = 100;
export const AURA_BAR_MAX        = 5000;
export const MAX_TODAY_COMMITS   = 10000;
export const MAX_DAILY_TARGET    = 10;
export const MIN_DAILY_TARGET    = 1;
export const MAX_HISTORY_DAYS    = 365;
export const FETCH_TIMEOUT_MS    = 10000;
export const FETCH_INTERVAL_MINS = 30;

export const RANKS = [
  { min: 0,  max: 2,          emoji: '🧳', name: 'Tourist',        tagline: 'just visiting' },
  { min: 3,  max: 6,          emoji: '☕', name: 'Bay Area Intern', tagline: 'learning the ropes' },
  { min: 7,  max: 13,         emoji: '📚', name: 'CS Undergrad',    tagline: 'pulling all nighters' },
  { min: 14, max: 20,         emoji: '🎓', name: 'Stanford Kid',    tagline: "thinks he's cracked" },
  { min: 21, max: 29,         emoji: '⚡', name: 'YC Founder',      tagline: 'shipping at 3am' },
  { min: 30, max: Infinity,   emoji: '🧠', name: 'CRACKED',         tagline: 'no further questions' },
];

export const STRINGS = {
  noUsername:      '👋 Set your GitHub username in settings to get started.',
  openSettings:    'Open Settings →',
  refreshFailed:   'Refresh failed. Check your connection.',
  loadFailed:      'Failed to load data. Please try again.',
  alreadyCracked:  "You're already cracked. Legend. 🫡",
  invalidUsername: 'Invalid username. Use 1–39 alphanumeric characters or hyphens; cannot start or end with a hyphen, no consecutive hyphens.',
  usernameChanged: 'Username changed — stats reset for fresh start.',
};

// GitHub usernames: alphanumeric + hyphens, no leading/trailing/consecutive hyphens, max 39 chars
export const validateUsername = (username) => {
  if (!username || typeof username !== 'string') return false;
  if (username.length > 39) return false;
  if (username.includes('--')) return false;
  return USERNAME_REGEX.test(username);
};

export const getRank = (streak) =>
  RANKS.find(r => streak >= r.min && streak <= r.max) ?? RANKS[0];

export const getNextRank = (streak) => {
  const idx = RANKS.findIndex(r => streak >= r.min && streak <= r.max);
  return (idx >= 0 && idx < RANKS.length - 1) ? RANKS[idx + 1] : null;
};

// Local-timezone YYYY-MM-DD (matches GitHub's contribution calendar display)
export const todayLocalString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const yesterdayLocalString = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

const ordinalSuffix = (n) => {
  if (n >= 11 && n <= 13) return 'th';
  return ['th','st','nd','rd'][n % 10] ?? 'th';
};

// Text-only SVG parsing — never creates DOM from external content
export const parseSvgCount = (text, dateStr) => {
  if (!text || typeof text !== 'string') return null;
  const re1 = new RegExp(`data-date="${dateStr}"[^>]*data-count="(\\d+)"`, 'i');
  const re2 = new RegExp(`data-count="(\\d+)"[^>]*data-date="${dateStr}"`, 'i');
  const match = text.match(re1) ?? text.match(re2);
  if (!match) return null;
  const count = parseInt(match[1], 10);
  if (!Number.isFinite(count) || count < 0 || count > MAX_TODAY_COMMITS) return 0;
  return count;
};

// Parses today's contribution count from GitHub's contributions page HTML.
//
// GitHub embeds a full year of data, so the same "May 26th" appears TWICE
// (2025-05-26 and 2026-05-26). A plain ordinal-date search matches the wrong year.
// The correct approach: find the <td data-date="YYYY-MM-DD" id="..."> cell,
// then look up the matching <tool-tip for="..."> to read the exact count.
//
// Tooltip formats observed in the wild:
//   "16 contributions on May 26th."
//   "1 contribution on May 26th."
//   "No contributions on May 26th."
export const parseContributionCount = (text, dateStr) => {
  if (!text || typeof text !== 'string') return null;

  // Legacy: data-count attribute (GitHub used this before ~2023)
  const fromAttr = parseSvgCount(text, dateStr);
  if (fromAttr !== null) return fromAttr;

  // Primary: anchor to the exact data-date on the <td> cell, read its tooltip
  const cellRe = new RegExp(
    `id="(contribution-day-component[^"]*)"[^>]*data-date="${dateStr}"` +
    `|data-date="${dateStr}"[^>]*id="(contribution-day-component[^"]*)"`,
    'i',
  );
  const cellMatch = text.match(cellRe);
  if (cellMatch) {
    const cellId = cellMatch[1] || cellMatch[2];
    const tipMatch = text.match(new RegExp(`for="${cellId}"[^>]*>([^<]+)<\\/tool-tip>`, 'i'));
    if (tipMatch) {
      const tip = tipMatch[1].trim();
      if (/^No\s+contributions/i.test(tip)) return 0;
      const m = tip.match(/^(\d+)\s+contribution/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 0 && n <= MAX_TODAY_COMMITS) return n;
      }
    }
  }

  return null;
};

// Validate and clamp every value read from storage — defensive against tampering
export const normalizeStorageData = (raw) => {
  if (!raw || typeof raw !== 'object') raw = {};

  const numField = (v, def, lo, hi) => {
    const n = (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v) : def;
    return Math.min(hi, Math.max(lo, n));
  };
  const strField = (v, def) => (typeof v === 'string' ? v : def);

  const data = {
    username:          strField(raw.username, ''),
    daily_target:      numField(raw.daily_target, 3, MIN_DAILY_TARGET, MAX_DAILY_TARGET),
    notification_time: strField(raw.notification_time, '21:00'),
    streak:            numField(raw.streak, 0, 0, MAX_STREAK),
    longest_streak:    numField(raw.longest_streak, 0, 0, MAX_STREAK),
    aura:              numField(raw.aura, 0, 0, MAX_AURA),
    cracked_bar:       numField(raw.cracked_bar, 0, 0, CRACKED_THRESHOLD),
    cracked_achieved:  raw.cracked_achieved === true,
    last_active_date:  strField(raw.last_active_date, ''),
    today_commits:     numField(raw.today_commits, 0, 0, MAX_TODAY_COMMITS),
    last_fetched:      strField(raw.last_fetched, ''),
    history:           (raw.history && typeof raw.history === 'object' && !Array.isArray(raw.history))
                         ? raw.history : {},
  };

  // Enforce HH:MM format on notification time
  if (!/^\d{2}:\d{2}$/.test(data.notification_time)) data.notification_time = '21:00';

  // Sanitize history values and trim to MAX_HISTORY_DAYS
  const sanitized = {};
  for (const [k, v] of Object.entries(data.history)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      sanitized[k] = Math.min(MAX_TODAY_COMMITS, Math.round(v));
    }
  }
  const keys = Object.keys(sanitized).sort();
  data.history = keys.length > MAX_HISTORY_DAYS
    ? Object.fromEntries(keys.slice(-MAX_HISTORY_DAYS).map(k => [k, sanitized[k]]))
    : sanitized;

  // cracked_achieved is permanent once earned
  if (data.cracked_bar >= CRACKED_THRESHOLD) data.cracked_achieved = true;

  return data;
};

// Pure streak/aura computation. today and yesterday are injectable for tests.
export const computeGameState = (
  data,
  todayCommits,
  today     = todayLocalString(),
  yesterday = yesterdayLocalString(),
) => {
  const {
    daily_target,
    streak,
    longest_streak,
    aura,
    cracked_bar,
    cracked_achieved,
    last_active_date,
    history,
  } = data;

  let newStreak   = streak;
  let newCracked  = cracked_bar;
  let newAura     = aura;
  let streakBroke = false;
  let streakExtended = false;

  // Break if last activity was before yesterday and streak is still alive
  if (last_active_date && last_active_date !== today && last_active_date !== yesterday && streak > 0) {
    streakBroke = true;
    newStreak  = 0;
    if (!cracked_achieved) newCracked = 0;
  }

  const targetHit = todayCommits >= daily_target;

  // Extend streak at most once per calendar day
  if (targetHit && last_active_date !== today) {
    newStreak = streakBroke ? 1 : newStreak + 1;
    if (!cracked_achieved) {
      newCracked = streakBroke ? 1 : Math.min(CRACKED_THRESHOLD, newCracked + 1);
    }
    streakExtended = true;
  }

  const newCrackedAchieved = cracked_achieved || newCracked >= CRACKED_THRESHOLD;
  if (newCrackedAchieved) newCracked = CRACKED_THRESHOLD;

  // Aura delta: only count new commits since last fetch (use history[today] as baseline)
  const prevTodayCommits = history[today] !== undefined ? history[today] : 0;
  const commitDelta = Math.max(0, todayCommits - prevTodayCommits);
  newAura = aura + commitDelta * AURA_PER_COMMIT;
  if (streakExtended) newAura += AURA_TARGET_BONUS + AURA_STREAK_BONUS;
  if (streakBroke)    newAura -= AURA_BREAK_PENALTY;
  newAura = Math.min(MAX_AURA, Math.max(0, Math.round(newAura)));

  const newHistory = { ...history, [today]: todayCommits };
  const histKeys = Object.keys(newHistory).sort();
  const trimmedHistory = histKeys.length > MAX_HISTORY_DAYS
    ? Object.fromEntries(histKeys.slice(-MAX_HISTORY_DAYS).map(k => [k, newHistory[k]]))
    : newHistory;

  return {
    today_commits:    todayCommits,
    last_fetched:     new Date().toISOString(),
    streak:           Math.min(MAX_STREAK, newStreak),
    longest_streak:   Math.min(MAX_STREAK, Math.max(longest_streak, newStreak)),
    aura:             newAura,
    cracked_bar:      newCracked,
    cracked_achieved: newCrackedAchieved,
    history:          trimmedHistory,
    ...(targetHit ? { last_active_date: today } : {}),
  };
};
