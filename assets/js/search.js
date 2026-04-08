/* EnStory — Search Logic */

window.searchIndex = null;

// 加载搜索索引
async function loadSearchIndex() {
  if (window.searchIndex) return window.searchIndex;
  try {
    const base = document.querySelector('base') ? document.querySelector('base').href : '/';
    const res = await fetch('/search.json');
    if (!res.ok) throw new Error('Failed to load search index');
    window.searchIndex = await res.json();
    return window.searchIndex;
  } catch (e) {
    console.warn('EnStory: Could not load search index', e);
    return [];
  }
}

// 执行搜索并渲染结果
function performSearch(q, container) {
  if (!window.searchIndex || !q) {
    container.innerHTML = '';
    container.classList.remove('active');
    return;
  }
  const results = window.searchIndex.filter(item => {
    const title = (item.title || '').toLowerCase();
    const def = (item.definition || '').toLowerCase();
    return title.includes(q) || def.includes(q);
  }).slice(0, 8);

  if (results.length === 0) {
    container.innerHTML = `<div class="search-no-result">没有找到「${q}」相关词条</div>`;
  } else {
    container.innerHTML = results.map(item => `
      <a class="search-result-item" href="${item.url}">
        <span class="result-word">${item.title}</span>
        <span class="result-pos">${item.part_of_speech || ''}</span>
        <div class="result-def">${item.definition || ''}</div>
      </a>
    `).join('');
  }
  container.classList.add('active');
}

// 初始化 Header 搜索 Overlay
function initHeaderSearch() {
  const toggle = document.getElementById('searchToggle');
  const overlay = document.getElementById('searchOverlay');
  const closeBtn = document.getElementById('searchClose');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    overlay.classList.add('active');
    setTimeout(() => input && input.focus(), 50);
  });
  closeBtn && closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });

  function closeOverlay() {
    overlay.classList.remove('active');
    if (input) input.value = '';
    if (results) { results.innerHTML = ''; results.classList.remove('active'); }
  }

  input && input.addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    performSearch(q, results);
  });
}

// 初始化首页搜索
function initHeroSearch() {
  const heroInput = document.getElementById('heroSearchInput');
  const heroResults = document.getElementById('heroSearchResults');
  if (!heroInput || !heroResults) return;

  heroInput.addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    performSearch(q, heroResults);
  });

  document.addEventListener('click', e => {
    if (!heroResults.contains(e.target) && e.target !== heroInput) {
      heroResults.classList.remove('active');
    }
  });
}

// 启动
document.addEventListener('DOMContentLoaded', async () => {
  await loadSearchIndex();
  initHeaderSearch();
  initHeroSearch();
});
