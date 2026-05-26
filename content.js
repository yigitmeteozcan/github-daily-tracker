(function () {
  'use strict';

  if (document.getElementById('gdt-widget')) return;

  const norm = (raw) => ({
    username:      typeof raw.username === 'string' ? raw.username : '',
    today_commits: Number.isFinite(raw.today_commits) ? Math.max(0, Math.round(raw.today_commits)) : 0,
    daily_target:  Number.isFinite(raw.daily_target)  ? Math.max(1, Math.round(raw.daily_target))  : 3,
    streak:        Number.isFinite(raw.streak)         ? Math.max(0, Math.round(raw.streak))         : 0,
  });

  // Build widget DOM
  const widget = document.createElement('div');
  widget.id = 'gdt-widget';

  const track = document.createElement('div');
  track.className = 'gdt-track';
  const fill = document.createElement('div');
  fill.className = 'gdt-fill';
  track.appendChild(fill);

  const commitsEl = document.createElement('span');
  commitsEl.className = 'gdt-commits';

  const dotEl = document.createElement('span');
  dotEl.className = 'gdt-dot';
  dotEl.textContent = '·';

  const streakEl = document.createElement('span');
  streakEl.className = 'gdt-streak';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gdt-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    widget.style.display = 'none';
  });

  widget.appendChild(track);
  widget.appendChild(commitsEl);
  widget.appendChild(dotEl);
  widget.appendChild(streakEl);
  widget.appendChild(closeBtn);
  document.body.appendChild(widget);

  const render = (raw) => {
    const data = norm(raw || {});
    if (!data.username) {
      widget.style.display = 'none';
      return;
    }
    widget.style.display = '';

    const pct = Math.min(100, (data.today_commits / data.daily_target) * 100);
    const hit = data.today_commits >= data.daily_target;

    fill.style.width = `${pct}%`;
    fill.className   = hit ? 'gdt-fill gdt-fill-hit' : 'gdt-fill';

    commitsEl.textContent = `${data.today_commits}/${data.daily_target}`;
    commitsEl.className   = hit ? 'gdt-commits gdt-commits-hit' : 'gdt-commits';

    if (data.streak > 0) {
      streakEl.textContent  = `🔥 ${data.streak}`;
      streakEl.style.display = '';
      dotEl.style.display    = '';
    } else {
      streakEl.style.display = 'none';
      dotEl.style.display    = 'none';
    }
  };

  chrome.storage.local.get(null, render);
  chrome.storage.onChanged.addListener(() => chrome.storage.local.get(null, render));
})();
