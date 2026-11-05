// ============================================================
// App Store — каталог приложений на базе GitHub Releases
// ============================================================

const CONFIG = {
  configUrl: 'apps.json',
  // Запасной список, если apps.json недоступен
  fallback: [],
  // Токен повышает лимит GitHub API (60/час → 5000/час).
  // Укажите свой Personal Access Token (без прав), либо оставьте null.
  token: null,
};

const state = {
  apps: [],
  category: 'all',
  query: '',
  sort: 'name',
};

// ---------- Утилиты ----------

const fmtNum = (n) => {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
  return String(n);
};

const fmtSize = (bytes) => {
  if (!bytes) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + units[i];
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const isInstallable = (name) =>
  /\.(apk|aab|ipa|exe|msi|dmg|pkg|deb|rpm|appimage|zip|tar\.gz)$/i.test(name);

// ---------- GitHub API ----------

async function ghFetch(path) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (CONFIG.token) headers['Authorization'] = `Bearer ${CONFIG.token}`;

  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function loadApp(entry) {
  const { repo, category = 'Другое', featured = false, icon, description } = entry;

  try {
    const [info, release] = await Promise.all([
      ghFetch(`/repos/${repo}`),
      ghFetch(`/repos/${repo}/releases/latest`).catch(() => null),
    ]);

    if (!release) return null;

    const assets = (release.assets || [])
      .filter((a) => isInstallable(a.name))
      .map((a) => ({
        name: a.name,
        size: a.size,
        url: a.browser_download_url,
        downloads: a.download_count || 0,
      }));

    if (!assets.length) return null;

    return {
      id: repo,
      repo,
      name: info.name,
      description: description || info.description || 'Без описания',
      icon: icon || info.owner?.avatar_url || null,
      category,
      featured,
      stars: info.stargazers_count || 0,
      updated: release.published_at || info.updated_at,
      version: release.tag_name || release.name || '',
      releaseNotes: release.body || '',
      homepage: info.homepage || null,
      assets,
    };
  } catch (err) {
    console.warn(`Не удалось загрузить ${repo}:`, err.message);
    return null;
  }
}

async function loadApps() {
  let entries = [];
  try {
    const res = await fetch(CONFIG.configUrl, { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      entries = Array.isArray(json) ? json : (json.apps || []);
    }
  } catch { /* fallback ниже */ }

  if (!entries.length) entries = CONFIG.fallback;

  const results = await Promise.all(entries.map(loadApp));
  return results.filter(Boolean);
}

// ---------- Рендер ----------

function iconHtml(app, large = false) {
  const letter = escapeHtml((app.name[0] || '?').toUpperCase());
  const wrapCls = large ? 'app-icon-wrap lg' : 'app-icon-wrap';
  const img = app.icon
    ? `<img class="app-icon" src="${escapeHtml(app.icon)}" alt="" loading="lazy"
         onerror="this.style.display='none'">`
    : '';
  return `<span class="${wrapCls}">
    <span class="app-icon-placeholder">${letter}</span>
    ${img}
  </span>`;
}

function renderFilters() {
  const cats = [...new Set(state.apps.map((a) => a.category))].sort();
  const items = [['all', 'Все'], ...cats.map((c) => [c, c])];
  document.getElementById('filters').innerHTML = items
    .map(([val, label]) =>
      `<button class="filter-btn ${state.category === val ? 'active' : ''}"
        data-cat="${escapeHtml(val)}">${escapeHtml(label)}</button>`)
    .join('');
}

function getVisibleApps() {
  let list = state.apps;

  if (state.category !== 'all') {
    list = list.filter((a) => a.category === state.category);
  }

  if (state.query) {
    const q = state.query.toLowerCase();
    list = list.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.repo.toLowerCase().includes(q));
  }

  const sorted = [...list];
  if (state.sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'stars') sorted.sort((a, b) => b.stars - a.stars);
  else if (state.sort === 'updated') sorted.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  return sorted;
}

function renderGrid() {
  const grid = document.getElementById('apps-grid');
  const empty = document.getElementById('empty');
  const apps = getVisibleApps();

  if (!apps.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = apps.map((app) => {
    const downloads = app.assets.reduce((s, a) => s + a.downloads, 0);
    return `
      <article class="app-card" data-id="${escapeHtml(app.id)}">
        <div class="app-header">
          ${iconHtml(app)}
          <div style="min-width:0;flex:1">
            <div class="app-title">${escapeHtml(app.name)}</div>
            <div class="app-version">v${escapeHtml(app.version)}</div>
          </div>
        </div>
        <div class="app-description">${escapeHtml(app.description)}</div>
        <div class="app-meta">
          <span class="category-badge">${escapeHtml(app.category)}</span>
          ${app.featured ? '<span class="featured-badge">⭐ Выбор редакции</span>' : ''}
          ${app.stars ? `<span>★ ${fmtNum(app.stars)}</span>` : ''}
          ${downloads ? `<span>⬇ ${fmtNum(downloads)}</span>` : ''}
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('.app-card').forEach((card) => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

// ---------- Модальное окно ----------

function openModal(id) {
  const app = state.apps.find((a) => a.id === id);
  if (!app) return;

  const downloads = app.assets.map((a) => `
    <a class="download-btn" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
      <span class="name">⬇ ${escapeHtml(a.name)}</span>
      <span class="size">${fmtSize(a.size)} · ${fmtNum(a.downloads)}</span>
    </a>`).join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-header">
      ${iconHtml(app, true)}
      <div style="min-width:0;flex:1">
        <h2>${escapeHtml(app.name)}</h2>
        <div class="app-version">
          Версия ${escapeHtml(app.version)} · ${fmtDate(app.updated)} · ★ ${fmtNum(app.stars)}
        </div>
        <div class="app-description">${escapeHtml(app.description)}</div>
      </div>
    </div>
    <div class="modal-body">
      <div class="section-title">Скачать последнюю версию</div>
      <div class="downloads">${downloads}</div>

      <div class="section-title" style="margin-top:24px">Исходный код</div>
      <a class="repo-link" href="https://github.com/${escapeHtml(app.repo)}"
         target="_blank" rel="noopener">GitHub · ${escapeHtml(app.repo)}</a>

      ${app.releaseNotes ? `
        <div class="section-title" style="margin-top:24px">Что нового</div>
        <div class="release-notes">${escapeHtml(app.releaseNotes.slice(0, 3000))}</div>
      ` : ''}
    </div>`;

  const modal = document.getElementById('modal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  document.body.style.overflow = '';
}

// ---------- Инициализация ----------

async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();

  // Поиск с debounce
  let t;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = e.target.value.trim();
      renderGrid();
    }, 180);
  });

  // Сортировка
  document.getElementById('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  // Фильтр категорий
  document.getElementById('filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    state.category = btn.dataset.cat;
    document.querySelectorAll('.filter-btn')
      .forEach((b) => b.classList.toggle('active', b === btn));
    renderGrid();
  });

  // Закрытие модалки
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modal').hidden) closeModal();
  });

  // Загрузка каталога
  try {
    state.apps = await loadApps();
    document.getElementById('loading').hidden = true;
    renderFilters();
    renderGrid();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `Ошибка загрузки: ${escapeHtml(err.message)}`;
  }
}

init();