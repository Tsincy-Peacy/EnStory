/**
 * EnStory — lookup.js
 * 实时词源查询：通过 CORS 代理抓取词源谷内容，解析后渲染到页面
 */

(function () {
  'use strict';

  // ── CORS 代理列表（自动切换） ──────────────────────────────────────
  const PROXY_LIST = [
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  const BASE = 'https://www.ciyuangu.com';

  // ── 工具函数 ───────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 通过代理拉取 HTML，返回字符串
  async function fetchHtml(targetUrl) {
    let lastErr;
    for (const proxyFn of PROXY_LIST) {
      try {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => null);
        // allorigins 返回 { contents: "..." }
        if (json && json.contents) return json.contents;
        // 其他代理直接返回文本
        return await res.text();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('所有代理均请求失败');
  }

  // 解析词源谷 /word/{word} 页面
  function parseWordPage(html, word) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const result = {
      word: word,
      phonetic_en: '',
      phonetic_us: '',
      pos: '',
      definition: '',
      etymology: '',
      first_year: '',
      related: [],
      source_url: `${BASE}/word/${word}`,
    };

    // 尝试多种选择器（词源谷结构）
    const text = doc.body ? doc.body.innerText || doc.body.textContent : '';

    // ── 音标 ─────────────────────────────────────────────────────
    const phoneticMatch = text.match(/英\s*[\[【]([^\]】]+)[\]】].*?美\s*[\[【]([^\]】]+)[\]】]/s);
    if (phoneticMatch) {
      result.phonetic_en = phoneticMatch[1].trim();
      result.phonetic_us = phoneticMatch[2].trim();
    } else {
      // 宽松匹配
      const pm = text.match(/\[([^\]]+)\]/);
      if (pm) result.phonetic_en = pm[1].trim();
    }

    // ── 词性 ─────────────────────────────────────────────────────
    const posMatch = text.match(/\b(N\.|V\.|ADJ\.|ADV\.|INTERJ\.|PREP\.|CONJ\.|PRON\.)\b/i);
    if (posMatch) result.pos = posMatch[1];

    // ── 词源正文 ─────────────────────────────────────────────────
    // 词源谷词源块通常在含「源自」「来自」「追溯」「源于」的段落
    const allParas = Array.from(doc.querySelectorAll('p, div.content, .word-content, .entry-content, article p'));
    const etyParas = allParas
      .map(el => el.textContent.trim())
      .filter(t => t.length > 40 && (
        t.includes('源自') || t.includes('来自') || t.includes('追溯') ||
        t.includes('源于') || t.includes('世纪') || t.includes('年代') ||
        t.includes('PIE') || t.includes('古') || t.includes('拉丁')
      ));

    if (etyParas.length > 0) {
      result.etymology = etyParas.slice(0, 4).join('\n\n');
    } else {
      // 降级：找 main 内最长的段落
      const bodyParas = Array.from(doc.querySelectorAll('p'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 50)
        .sort((a, b) => b.length - a.length);
      result.etymology = bodyParas.slice(0, 3).join('\n\n');
    }

    // ── 首次记录年份 ─────────────────────────────────────────────
    const yearMatch = result.etymology.match(/(\d{3,4})\s*年/);
    if (yearMatch) result.first_year = yearMatch[1];

    // ── 相关词 ───────────────────────────────────────────────────
    const links = Array.from(doc.querySelectorAll('a[href*="/word/"]'));
    const relatedWords = links
      .map(a => a.textContent.trim().toLowerCase())
      .filter(w => w && w !== word && /^[a-z\-]+$/.test(w))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 8);
    result.related = relatedWords;

    return result;
  }

  // 解析搜索页 /search/{word}，提取匹配词列表
  function parseSearchPage(html, query) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href*="/word/"]'));
    const words = links
      .map(a => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/word\/([^/?"#]+)/);
        return m ? m[1].toLowerCase() : null;
      })
      .filter(Boolean)
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 6);
    return words;
  }

  // ── 渲染函数 ──────────────────────────────────────────────────────
  function renderLoading() {
    return `
      <div class="lookup-loading">
        <div class="loading-spinner"></div>
        <p>正在从词源谷获取数据…</p>
      </div>`;
  }

  function renderError(msg) {
    return `
      <div class="lookup-error">
        <div class="error-icon">⚠️</div>
        <h3>查询遇到了问题</h3>
        <p>${escHtml(msg)}</p>
        <p class="error-tip">可能原因：网络环境限制、代理服务暂时不可用，或该词词源谷暂无收录。</p>
      </div>`;
  }

  function renderSuggestions(words, query) {
    if (!words.length) return renderError(`词源谷暂无「${query}」相关词条`);
    return `
      <div class="lookup-suggestions">
        <h3>找到以下相关词条，请选择：</h3>
        <div class="suggestion-list">
          ${words.map(w => `
            <button class="suggestion-item" data-word="${escHtml(w)}">
              <span class="sug-word">${escHtml(w)}</span>
              <span class="sug-hint">查看词源 →</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  function isSaved(word) {
    try {
      const wb = JSON.parse(localStorage.getItem('enstory_wordbook') || '[]');
      return wb.some(item => item.word === word);
    } catch { return false; }
  }

  function renderWordResult(data) {
    const saved = isSaved(data.word);
    const etyLines = data.etymology
      ? data.etymology.split('\n\n').map(p =>
          `<p>${escHtml(p)}</p>`).join('')
      : '<p class="muted">暂无词源信息</p>';

    const relatedHtml = data.related.length
      ? data.related.map(w =>
          `<a class="related-tag lookup-related-link" href="/EnStory/lookup/?q=${encodeURIComponent(w)}" data-word="${escHtml(w)}">${escHtml(w)}</a>`
        ).join('')
      : '<span class="muted">暂无</span>';

    return `
      <div class="lookup-result-card" id="resultCard">

        <!-- 单词头部 -->
        <header class="lk-header">
          <div class="lk-title-row">
            <h2 class="lk-word">${escHtml(data.word)}</h2>
            <button class="save-btn ${saved ? 'saved' : ''}" id="saveBtn" title="${saved ? '已收藏' : '收藏到单词本'}">
              <span class="save-icon">${saved ? '★' : '☆'}</span>
              <span class="save-text">${saved ? '已收藏' : '收藏'}</span>
            </button>
          </div>
          <div class="lk-meta">
            ${data.phonetic_en ? `<span class="lk-phonetic">英 [${escHtml(data.phonetic_en)}]</span>` : ''}
            ${data.phonetic_us ? `<span class="lk-phonetic">美 [${escHtml(data.phonetic_us)}]</span>` : ''}
            ${data.pos ? `<span class="lk-pos">${escHtml(data.pos)}</span>` : ''}
            ${data.first_year ? `<span class="lk-year">首见于 ${escHtml(data.first_year)} 年</span>` : ''}
          </div>
        </header>

        <!-- 词源正文 -->
        <section class="lk-section">
          <h3 class="lk-section-title"><span>⚗️</span> 词源解析</h3>
          <div class="lk-etymology">
            ${etyLines}
          </div>
        </section>

        <!-- 相关词 -->
        <section class="lk-section">
          <h3 class="lk-section-title"><span>🔗</span> 相关词汇</h3>
          <div class="lk-related">${relatedHtml}</div>
        </section>

        <!-- 来源注释 -->
        <footer class="lk-footer">
          <span>数据来源：</span>
          <a href="${escHtml(data.source_url)}" target="_blank" rel="noopener">词源谷 ciyuangu.com</a>
        </footer>

      </div>`;
  }

  // ── 核心查询流程 ───────────────────────────────────────────────────
  async function lookupWord(rawWord) {
    const word = rawWord.trim().toLowerCase().replace(/\s+/g, '-');
    if (!word) return;

    const resultEl = document.getElementById('lookupResult');
    resultEl.innerHTML = renderLoading();
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 1. 先尝试直接访问 /word/{word}
    try {
      const html = await fetchHtml(`${BASE}/word/${word}`);
      const data = parseWordPage(html, word);
      resultEl.innerHTML = renderWordResult(data);
      bindResultEvents(data);
      // 更新 URL query string（不刷页）
      history.pushState({}, '', `?q=${encodeURIComponent(word)}`);
      return;
    } catch (e) {
      console.warn('Direct word fetch failed:', e);
    }

    // 2. 降级：搜索页
    try {
      const html = await fetchHtml(`${BASE}/search/${word}`);
      const words = parseSearchPage(html, word);
      if (words.length === 1) {
        // 只有一个结果，直接查
        return lookupWord(words[0]);
      }
      resultEl.innerHTML = renderSuggestions(words, word);
      bindSuggestionEvents();
      return;
    } catch (e) {
      console.warn('Search page fetch failed:', e);
    }

    resultEl.innerHTML = renderError(`无法获取「${word}」的词源信息`);
  }

  // ── 收藏逻辑 ──────────────────────────────────────────────────────
  function saveWord(data) {
    try {
      let wb = JSON.parse(localStorage.getItem('enstory_wordbook') || '[]');
      if (!wb.some(item => item.word === data.word)) {
        wb.unshift({
          word: data.word,
          phonetic_en: data.phonetic_en,
          phonetic_us: data.phonetic_us,
          pos: data.pos,
          etymology_snippet: data.etymology.slice(0, 120),
          first_year: data.first_year,
          saved_at: new Date().toISOString(),
        });
        localStorage.setItem('enstory_wordbook', JSON.stringify(wb));
      }
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  function unsaveWord(word) {
    try {
      let wb = JSON.parse(localStorage.getItem('enstory_wordbook') || '[]');
      wb = wb.filter(item => item.word !== word);
      localStorage.setItem('enstory_wordbook', JSON.stringify(wb));
    } catch (e) { }
  }

  // ── 事件绑定 ──────────────────────────────────────────────────────
  let _currentData = null;

  function bindResultEvents(data) {
    _currentData = data;
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', function () {
      const saved = isSaved(data.word);
      if (saved) {
        unsaveWord(data.word);
        saveBtn.classList.remove('saved');
        saveBtn.querySelector('.save-icon').textContent = '☆';
        saveBtn.querySelector('.save-text').textContent = '收藏';
      } else {
        saveWord(data);
        saveBtn.classList.add('saved');
        saveBtn.querySelector('.save-icon').textContent = '★';
        saveBtn.querySelector('.save-text').textContent = '已收藏';
        showToast(`「${data.word}」已加入单词本 ✓`);
      }
    });

    // 相关词点击
    document.querySelectorAll('.lookup-related-link').forEach(a => {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const w = this.dataset.word;
        if (w) {
          document.getElementById('lookupInput').value = w;
          lookupWord(w);
        }
      });
    });
  }

  function bindSuggestionEvents() {
    document.querySelectorAll('.suggestion-item').forEach(btn => {
      btn.addEventListener('click', function () {
        const w = this.dataset.word;
        if (w) {
          document.getElementById('lookupInput').value = w;
          lookupWord(w);
        }
      });
    });
  }

  // ── Toast 提示 ─────────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'lk-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  // ── 初始化 ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const input = document.getElementById('lookupInput');
    const btn = document.getElementById('lookupBtn');

    btn.addEventListener('click', () => {
      const q = input.value.trim();
      if (q) lookupWord(q);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) lookupWord(q);
      }
    });

    // 快捷词按钮
    document.querySelectorAll('.tip-word').forEach(b => {
      b.addEventListener('click', function () {
        input.value = this.dataset.word;
        lookupWord(this.dataset.word);
      });
    });

    // URL query string 自动查词
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (q) {
      input.value = q;
      lookupWord(q);
    }
  });

})();
