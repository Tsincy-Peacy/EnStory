/**
 * EnStory — wordbook.js
 * 单词本页面逻辑：读取 localStorage，展示收藏词卡片
 */

(function () {
  'use strict';

  const KEY = 'enstory_wordbook';
  const baseUrl = document.querySelector('base')
    ? new URL(document.querySelector('base').href).pathname
    : '/EnStory';

  function getWordbook() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch { return []; }
  }

  function saveWordbook(wb) {
    try {
      localStorage.setItem(KEY, JSON.stringify(wb));
    } catch (e) { }
  }

  function removeWord(word) {
    let wb = getWordbook();
    wb = wb.filter(item => item.word !== word);
    saveWordbook(wb);
    render();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderCard(item) {
    return `
      <div class="wb-card" data-word="${escHtml(item.word)}">
        <div class="wb-card-top">
          <h3 class="wb-word">
            <a href="${baseUrl}/lookup/?q=${encodeURIComponent(item.word)}">${escHtml(item.word)}</a>
          </h3>
          <button class="wb-remove" data-word="${escHtml(item.word)}" title="从单词本移除">✕</button>
        </div>
        <div class="wb-meta">
          ${item.phonetic_en ? `<span class="wb-phonetic">[${escHtml(item.phonetic_en)}]</span>` : ''}
          ${item.pos ? `<span class="wb-pos">${escHtml(item.pos)}</span>` : ''}
          ${item.first_year ? `<span class="wb-year">${escHtml(item.first_year)}年</span>` : ''}
        </div>
        ${item.etymology_snippet ? `<p class="wb-snippet">${escHtml(item.etymology_snippet)}…</p>` : ''}
        <div class="wb-footer">
          <span class="wb-date">收藏于 ${formatDate(item.saved_at)}</span>
          <a class="wb-lookup-link" href="${baseUrl}/lookup/?q=${encodeURIComponent(item.word)}">查看词源 →</a>
        </div>
      </div>`;
  }

  function render() {
    const wb = getWordbook();
    const grid = document.getElementById('wordbookGrid');
    const empty = document.getElementById('wordbookEmpty');
    const count = document.getElementById('wordbookCount');

    count.textContent = `${wb.length} 个单词`;

    if (!wb.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = wb.map(renderCard).join('');

    // 绑定移除按钮
    grid.querySelectorAll('.wb-remove').forEach(btn => {
      btn.addEventListener('click', function () {
        const w = this.dataset.word;
        if (confirm(`从单词本移除「${w}」？`)) {
          removeWord(w);
        }
      });
    });
  }

  // 清空全部
  document.getElementById('clearAllBtn').addEventListener('click', function () {
    if (!getWordbook().length) return;
    if (confirm('确定清空所有收藏的单词？此操作不可撤销。')) {
      saveWordbook([]);
      render();
    }
  });

  // 导出为文本
  document.getElementById('exportBtn').addEventListener('click', function () {
    const wb = getWordbook();
    if (!wb.length) { alert('单词本是空的'); return; }
    const text = wb.map(item => {
      const lines = [`${item.word.toUpperCase()}`];
      if (item.phonetic_en) lines.push(`英 [${item.phonetic_en}]`);
      if (item.pos) lines.push(`词性：${item.pos}`);
      if (item.etymology_snippet) lines.push(`词源：${item.etymology_snippet}…`);
      lines.push('');
      return lines.join('\n');
    }).join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EnStory_wordbook_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 初始化渲染
  render();

})();
