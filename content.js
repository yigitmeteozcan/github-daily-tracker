(function () {
  'use strict';

  if (document.getElementById('gdt-widget')) return;

  // Minimal rank lookup (mirrors utils.js RANKS)
  const RANKS = [
    [30, '🧠', 'CRACKED'],
    [21, '⚡', 'YC Founder'],
    [14, '🎓', 'Stanford Kid'],
    [7,  '📚', 'CS Undergrad'],
    [3,  '☕', 'Bay Area Intern'],
    [0,  '🧳', 'Tourist'],
  ];
  const getRank = (streak) => RANKS.find(([min]) => streak >= min) ?? RANKS[5];

  const fmtAura = (n) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
  };

  const timeAgo = (iso) => {
    if (!iso) return '';
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1)  return 'now';
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h`;
  };

  const norm = (raw) => ({
    username:      typeof raw.username === 'string' ? raw.username : '',
    today_commits: Number.isFinite(raw.today_commits) ? Math.max(0, Math.round(raw.today_commits)) : 0,
    daily_target:  Number.isFinite(raw.daily_target)  ? Math.max(1, Math.round(raw.daily_target))  : 3,
    streak:        Number.isFinite(raw.streak)         ? Math.max(0, Math.round(raw.streak))         : 0,
    aura:          Number.isFinite(raw.aura)           ? Math.max(0, Math.round(raw.aura))           : 0,
    last_fetched:  typeof raw.last_fetched === 'string' ? raw.last_fetched : '',
  });

  // ── Build widget DOM ──────────────────────────────────

  const widget = document.createElement('div');
  widget.id = 'gdt-widget';

  // Row 1: header
  const header = document.createElement('div');
  header.className = 'gdt-row gdt-header';

  const labelEl = document.createElement('span');
  labelEl.className = 'gdt-label';
  labelEl.textContent = 'Today';

  const countEl = document.createElement('span');
  countEl.className = 'gdt-count';
  countEl.id = 'gdt-count';

  const pctEl = document.createElement('span');
  pctEl.className = 'gdt-pct';
  pctEl.id = 'gdt-pct';

  const rightEl = document.createElement('div');
  rightEl.className = 'gdt-right';

  const timeEl = document.createElement('span');
  timeEl.className = 'gdt-time';
  timeEl.id = 'gdt-time';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gdt-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    widget.style.display = 'none';
  });

  rightEl.appendChild(timeEl);
  rightEl.appendChild(closeBtn);
  header.appendChild(labelEl);
  header.appendChild(countEl);
  header.appendChild(pctEl);
  header.appendChild(rightEl);

  // Row 2: progress bar
  const track = document.createElement('div');
  track.className = 'gdt-track';
  const fill = document.createElement('div');
  fill.className = 'gdt-fill';
  fill.id = 'gdt-fill';
  track.appendChild(fill);

  // Row 3: stats
  const statsRow = document.createElement('div');
  statsRow.className = 'gdt-row gdt-stats';
  statsRow.id = 'gdt-stats';

  widget.appendChild(header);
  widget.appendChild(track);
  widget.appendChild(statsRow);
  document.body.appendChild(widget);

  // ── Render ────────────────────────────────────────────

  const render = (raw) => {
    const data = norm(raw || {});

    if (!data.username) {
      widget.style.display = 'none';
      return;
    }
    widget.style.display = '';

    const pct = data.daily_target > 0
      ? Math.min(100, (data.today_commits / data.daily_target) * 100)
      : 0;
    const hit = data.today_commits >= data.daily_target;

    // Header
    countEl.textContent = `${data.today_commits} / ${data.daily_target}`;
    countEl.className   = hit ? 'gdt-count gdt-green' : 'gdt-count';
    pctEl.textContent   = `${Math.round(pct)}%`;
    pctEl.className     = hit ? 'gdt-pct gdt-green' : 'gdt-pct';
    timeEl.textContent  = timeAgo(data.last_fetched);
    widget.className    = hit ? 'gdt-hit' : '';

    // Progress bar
    document.getElementById('gdt-fill').style.width = `${pct}%`;
    document.getElementById('gdt-fill').className   = hit ? 'gdt-fill gdt-fill-hit' : 'gdt-fill';

    // Stats row — rebuild cleanly each render
    const stats = document.getElementById('gdt-stats');
    while (stats.firstChild) stats.removeChild(stats.firstChild);

    const [, rankEmoji, rankName] = getRank(data.streak);

    const items = [
      `🔥 ${data.streak}d streak`,
      `${rankEmoji} ${rankName}`,
      ...(data.aura > 0 ? [`✨ ${fmtAura(data.aura)}`] : []),
    ];

    items.forEach((text, i) => {
      if (i > 0) {
        const dot = document.createElement('span');
        dot.className = 'gdt-dot';
        dot.textContent = '·';
        stats.appendChild(dot);
      }
      const s = document.createElement('span');
      s.className = 'gdt-stat';
      s.textContent = text;
      stats.appendChild(s);
    });
  };

  chrome.storage.local.get(null, render);
  chrome.storage.onChanged.addListener(() => chrome.storage.local.get(null, render));
})();
