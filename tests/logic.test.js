import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername,
  parseSvgCount,
  computeGameState,
  normalizeStorageData,
  getRank,
  CRACKED_THRESHOLD,
  MAX_TODAY_COMMITS,
  AURA_BREAK_PENALTY,
  AURA_PER_COMMIT,
  AURA_TARGET_BONUS,
  AURA_STREAK_BONUS,
} from '../utils.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const D_TODAY     = '2026-05-26';
const D_YESTERDAY = '2026-05-25';
const D_2AGO      = '2026-05-24';

const base = (overrides = {}) => ({
  username:         'testuser',
  daily_target:     3,
  streak:           0,
  longest_streak:   0,
  aura:             0,
  cracked_bar:      0,
  cracked_achieved: false,
  last_active_date: '',
  today_commits:    0,
  last_fetched:     '',
  history:          {},
  ...overrides,
});

const run = (overrides, commits) =>
  computeGameState(base(overrides), commits, D_TODAY, D_YESTERDAY);

// ── TEST 1: Username validation ────────────────────────────────────────────────

test('TEST 1 — username validation', async (t) => {
  await t.test('valid — normal username',       () => assert.ok(validateUsername('yigitmeteozcan')));
  await t.test('valid — alphanumeric+hyphens',  () => assert.ok(validateUsername('valid-user-123')));
  await t.test('valid — single char',           () => assert.ok(validateUsername('a')));
  await t.test('valid — exactly 39 chars',      () => assert.ok(validateUsername('a'.repeat(38) + 'b')));

  await t.test('invalid — path traversal',      () => assert.ok(!validateUsername('../etc/passwd')));
  await t.test('invalid — space in name',       () => assert.ok(!validateUsername('user name')));
  await t.test('invalid — 40 chars',            () => assert.ok(!validateUsername('a'.repeat(40))));
  await t.test('invalid — empty string',        () => assert.ok(!validateUsername('')));
  await t.test('invalid — double hyphen',       () => assert.ok(!validateUsername('valid--double-hyphen')));
  await t.test('invalid — leading hyphen',      () => assert.ok(!validateUsername('-startswith')));
  await t.test('invalid — trailing hyphen',     () => assert.ok(!validateUsername('endswith-')));
  await t.test('invalid — null',                () => assert.ok(!validateUsername(null)));
  await t.test('invalid — number type',         () => assert.ok(!validateUsername(42)));
});

// ── TEST 2: SVG parsing safety ─────────────────────────────────────────────────

test('TEST 2 — SVG parsing safety', async (t) => {
  await t.test('valid SVG returns correct count', () => {
    const svg = `<svg><rect data-date="${D_TODAY}" data-level="2" data-count="5" /></svg>`;
    assert.equal(parseSvgCount(svg, D_TODAY), 5);
  });

  await t.test('attribute order reversed (count before date)', () => {
    const svg = `<svg><rect data-count="7" data-date="${D_TODAY}" /></svg>`;
    assert.equal(parseSvgCount(svg, D_TODAY), 7);
  });

  await t.test('SVG with script tag — script not executed, count still extracted', () => {
    // Text-only parsing means the script body is never evaluated
    const svg = `<svg><script>throw new Error("XSS")</script><rect data-date="${D_TODAY}" data-count="3" /></svg>`;
    assert.equal(parseSvgCount(svg, D_TODAY), 3);
  });

  await t.test('data-count negative — \\d+ regex rejects, returns null', () => {
    const svg = `<rect data-date="${D_TODAY}" data-count="-1" />`;
    assert.equal(parseSvgCount(svg, D_TODAY), null);
  });

  await t.test('data-count non-numeric — returns null', () => {
    const svg = `<rect data-date="${D_TODAY}" data-count="abc" />`;
    assert.equal(parseSvgCount(svg, D_TODAY), null);
  });

  await t.test('data-count exceeds MAX_TODAY_COMMITS — clamped to 0', () => {
    const svg = `<rect data-date="${D_TODAY}" data-count="${MAX_TODAY_COMMITS + 1}" />`;
    assert.equal(parseSvgCount(svg, D_TODAY), 0);
  });

  await t.test('empty string — returns null without crash', () => {
    assert.equal(parseSvgCount('', D_TODAY), null);
  });

  await t.test('null input — returns null without crash', () => {
    assert.equal(parseSvgCount(null, D_TODAY), null);
  });

  await t.test('malformed text — returns null without crash', () => {
    assert.equal(parseSvgCount('not svg at all <<<>>>', D_TODAY), null);
  });

  await t.test('wrong date in SVG — returns null', () => {
    const svg = `<rect data-date="2020-01-01" data-count="9" />`;
    assert.equal(parseSvgCount(svg, D_TODAY), null);
  });
});

// ── TEST 3: Streak calculation ─────────────────────────────────────────────────

test('TEST 3 — streak calculation', async (t) => {
  await t.test('hit target after yesterday hit → streak +1', () => {
    const result = run({ streak: 1, last_active_date: D_YESTERDAY }, 3);
    assert.equal(result.streak, 2);
  });

  await t.test('exactly hit target (commits == target) → streak +1', () => {
    const result = run({ streak: 2, last_active_date: D_YESTERDAY }, 3);
    assert.equal(result.streak, 3);
  });

  await t.test('exceed target (commits > target) → streak +1', () => {
    const result = run({ streak: 2, last_active_date: D_YESTERDAY }, 9);
    assert.equal(result.streak, 3);
  });

  await t.test('target not hit today — streak does not extend (last_active is yesterday)', () => {
    const result = run({ streak: 1, last_active_date: D_YESTERDAY }, 2);
    assert.equal(result.streak, 1);
  });

  await t.test('2 days missed → streak detected as broken, resets to 0', () => {
    const result = run({ streak: 5, last_active_date: D_2AGO, aura: 500 }, 0);
    assert.equal(result.streak, 0);
  });

  await t.test('fresh start (no last_active_date) + hits target → streak becomes 1', () => {
    const result = run({ streak: 0, last_active_date: '' }, 3);
    assert.equal(result.streak, 1);
  });

  await t.test('no double-count: second call same day does not extend streak again', () => {
    const first = run({ streak: 1, last_active_date: D_YESTERDAY }, 3);
    assert.equal(first.streak, 2);
    const second = computeGameState(
      base({ streak: first.streak, last_active_date: D_TODAY, history: first.history }),
      5, D_TODAY, D_YESTERDAY,
    );
    assert.equal(second.streak, 2); // streak stays 2, not 3
  });

  await t.test('streak = 0 already + missed days → no break penalty (nothing to break)', () => {
    const result = run({ streak: 0, last_active_date: D_2AGO, aura: 50 }, 0);
    // streak was 0 so break condition requires streak > 0 — no penalty
    assert.equal(result.streak, 0);
    assert.equal(result.aura, 50); // no deduction
  });
});

// ── TEST 4: Aura calculation ───────────────────────────────────────────────────

test('TEST 4 — aura calculation', async (t) => {
  await t.test('1 commit below target → only commit aura, no bonuses', () => {
    const result = run({ aura: 0 }, 1);
    assert.equal(result.aura, 1 * AURA_PER_COMMIT);
  });

  await t.test('hitting target from fresh start → commit + target + streak bonus', () => {
    // 3 commits * 10 = 30, +50 target bonus, +100 streak bonus = 180
    const result = run({ aura: 0, streak: 0, last_active_date: '' }, 3);
    assert.equal(result.aura, 3 * AURA_PER_COMMIT + AURA_TARGET_BONUS + AURA_STREAK_BONUS);
  });

  await t.test('streak break deducts AURA_BREAK_PENALTY', () => {
    const result = run({ streak: 3, aura: 500, last_active_date: D_2AGO }, 0);
    assert.equal(result.aura, 500 - AURA_BREAK_PENALTY);
  });

  await t.test('aura floors at 0 — never goes negative (50 - 100 penalty = 0)', () => {
    const result = run({ streak: 1, aura: 50, last_active_date: D_2AGO }, 0);
    assert.equal(result.aura, 0);
  });

  await t.test('aura at 0 with break penalty stays at 0', () => {
    const result = run({ streak: 2, aura: 0, last_active_date: D_2AGO }, 0);
    assert.equal(result.aura, 0);
  });

  await t.test('commit delta only counts new commits — no double-add on re-fetch', () => {
    // history[today] already has 2, now we see 5 → delta = 3
    const result = computeGameState(
      base({ aura: 20, history: { [D_TODAY]: 2 }, last_active_date: D_TODAY }),
      5, D_TODAY, D_YESTERDAY,
    );
    assert.equal(result.aura, 20 + 3 * AURA_PER_COMMIT);
  });
});

// ── TEST 5: Cracked bar ────────────────────────────────────────────────────────

test('TEST 5 — cracked bar', async (t) => {
  await t.test('day 29 complete → cracked_bar = 29, not yet achieved', () => {
    const result = run({ streak: 28, cracked_bar: 28, last_active_date: D_YESTERDAY }, 3);
    assert.equal(result.cracked_bar, 29);
    assert.equal(result.cracked_achieved, false);
  });

  await t.test('day 30 complete → cracked_bar = 30, cracked_achieved = true', () => {
    const result = run({ streak: 29, cracked_bar: 29, last_active_date: D_YESTERDAY }, 3);
    assert.equal(result.cracked_bar, CRACKED_THRESHOLD);
    assert.equal(result.cracked_achieved, true);
  });

  await t.test('streak break at day 25 → cracked_bar resets to 0', () => {
    const result = run({ streak: 25, cracked_bar: 25, last_active_date: D_2AGO }, 0);
    assert.equal(result.cracked_bar, 0);
    assert.equal(result.cracked_achieved, false);
  });

  await t.test('after CRACKED unlocked, bar stays at 30 forever even with streak break', () => {
    const result = run({
      streak:           30,
      cracked_bar:      CRACKED_THRESHOLD,
      cracked_achieved: true,
      last_active_date: D_2AGO,
    }, 0);
    assert.equal(result.cracked_bar, CRACKED_THRESHOLD);
    assert.equal(result.cracked_achieved, true);
  });

  await t.test('normalizeStorageData: cracked_bar=30 → sets cracked_achieved=true', () => {
    const data = normalizeStorageData({ cracked_bar: 30 });
    assert.equal(data.cracked_achieved, true);
  });
});

// ── TEST 6: Rank boundaries ────────────────────────────────────────────────────

test('TEST 6 — rank boundaries', async (t) => {
  const cases = [
    [0,   '🧳', 'Tourist'],
    [1,   '🧳', 'Tourist'],
    [2,   '🧳', 'Tourist'],
    [3,   '☕', 'Bay Area Intern'],
    [6,   '☕', 'Bay Area Intern'],
    [7,   '📚', 'CS Undergrad'],
    [13,  '📚', 'CS Undergrad'],
    [14,  '🎓', 'Stanford Kid'],
    [20,  '🎓', 'Stanford Kid'],
    [21,  '⚡', 'YC Founder'],
    [29,  '⚡', 'YC Founder'],
    [30,  '🧠', 'CRACKED'],
    [31,  '🧠', 'CRACKED'],
    [100, '🧠', 'CRACKED'],
  ];

  for (const [streak, emoji, name] of cases) {
    await t.test(`streak ${streak} → ${name}`, () => {
      const rank = getRank(streak);
      assert.equal(rank.emoji, emoji);
      assert.equal(rank.name,  name);
    });
  }
});

// ── TEST 7: Storage validation ─────────────────────────────────────────────────

test('TEST 7 — storage validation', async (t) => {
  await t.test('streak = -1 → normalized to 0', () => {
    assert.equal(normalizeStorageData({ streak: -1 }).streak, 0);
  });

  await t.test('streak = "abc" → normalized to 0', () => {
    assert.equal(normalizeStorageData({ streak: 'abc' }).streak, 0);
  });

  await t.test('aura = null → normalized to 0', () => {
    assert.equal(normalizeStorageData({ aura: null }).aura, 0);
  });

  await t.test('cracked_bar = 999 → capped at CRACKED_THRESHOLD', () => {
    assert.equal(normalizeStorageData({ cracked_bar: 999 }).cracked_bar, CRACKED_THRESHOLD);
  });

  await t.test('history with 400 entries → trimmed to 365', () => {
    const history = {};
    for (let i = 0; i < 400; i++) {
      const d = new Date('2024-01-01');
      d.setDate(d.getDate() + i);
      history[d.toISOString().slice(0, 10)] = i;
    }
    const result = normalizeStorageData({ history });
    assert.equal(Object.keys(result.history).length, 365);
  });

  await t.test('history trimmed keeps most recent entries', () => {
    const history = {};
    const allKeys = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date('2024-01-01');
      d.setDate(d.getDate() + i);
      const k = d.toISOString().slice(0, 10);
      history[k] = i;
      allKeys.push(k);
    }
    allKeys.sort();
    const result = normalizeStorageData({ history });
    const kept   = Object.keys(result.history).sort();
    assert.equal(kept[0], allKeys[400 - 365]); // oldest kept = 36th original entry
  });

  await t.test('history with non-numeric values → invalid entries stripped', () => {
    const result = normalizeStorageData({ history: { '2026-01-01': 'bad', '2026-01-02': 5 } });
    assert.equal(Object.keys(result.history).length, 1);
    assert.equal(result.history['2026-01-02'], 5);
  });

  await t.test('streak = NaN → normalized to 0', () => {
    assert.equal(normalizeStorageData({ streak: NaN }).streak, 0);
  });

  await t.test('daily_target out of range → clamped', () => {
    assert.equal(normalizeStorageData({ daily_target: 0 }).daily_target, 1);
    assert.equal(normalizeStorageData({ daily_target: 99 }).daily_target, 10);
  });

  await t.test('invalid notification_time → falls back to 21:00', () => {
    assert.equal(normalizeStorageData({ notification_time: 'bad:time' }).notification_time, '21:00');
    assert.equal(normalizeStorageData({ notification_time: null }).notification_time, '21:00');
  });

  await t.test('cracked_bar = 30 → cracked_achieved auto-set to true', () => {
    assert.equal(normalizeStorageData({ cracked_bar: 30 }).cracked_achieved, true);
  });
});

// ── TEST 8: Notification logic ─────────────────────────────────────────────────

test('TEST 8 — notification logic', async (t) => {
  await t.test('target hit → notification should NOT fire', () => {
    const data = normalizeStorageData({ today_commits: 3, daily_target: 3 });
    assert.equal(data.today_commits < data.daily_target, false);
  });

  await t.test('target not hit → notification should fire', () => {
    const data = normalizeStorageData({ today_commits: 1, daily_target: 3 });
    assert.equal(data.today_commits < data.daily_target, true);
  });

  await t.test('invalid notification_time → normalized to 21:00, no crash', () => {
    const data = normalizeStorageData({ notification_time: 'not-a-time' });
    assert.equal(data.notification_time, '21:00');
    const [h, m] = data.notification_time.split(':').map(Number);
    assert.ok(Number.isFinite(h) && Number.isFinite(m));
  });

  await t.test('username not set → normalizes cleanly without crash', () => {
    const data = normalizeStorageData({});
    assert.equal(data.username, '');
    assert.equal(data.today_commits, 0);
  });

  await t.test('0 commits < any positive target → notification fires', () => {
    const data = normalizeStorageData({ today_commits: 0, daily_target: 1 });
    assert.equal(data.today_commits < data.daily_target, true);
  });
});
