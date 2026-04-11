/**
 * EnStory — lookup.js
 * 实时词源查询：通过 CORS 代理抓取词源谷 /word/{word} 页面，解析后渲染
 * 
 * 代理配置说明：
 *   1. 部署 cors-proxy-worker.js 到 Cloudflare Workers，将 URL 填入 CF_WORKER_URL
 *   2. 也可直接使用免费代理（自动降级），但可能不稳定
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // 👉 在这里填入你的 Cloudflare Worker URL（部署后复制过来）
  //    留空则自动降级到免费代理（可能较慢）
  // TODO: 部署 Vercel Edge Function 后填入 API 地址
  const CF_WORKER_URL = '';
  // ══════════════════════════════════════════════════════════════

  // ── CORS 代理列表（自动切换） ──────────────────────────────────────
  const PROXY_LIST = (() => {
    const list = [];
    if (CF_WORKER_URL) {
      list.push(url => `${CF_WORKER_URL}/?url=${encodeURIComponent(url)}`);
    }
    // 免费代理（不稳定，仅作降级）
    list.push(url => `https://corsproxy.io/?${encodeURIComponent(url)}`);
    list.push(url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    return list;
  })();

  const BASE = 'https://www.ciyuangu.com';

  // ── 工具函数 ───────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 通过代理拉取 HTML
  async function fetchHtml(targetUrl) {
    let lastErr;
    for (const proxyFn of PROXY_LIST) {
      try {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => null);
        if (json && json.contents) return json.contents;
        return await res.text();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('所有代理均请求失败');
  }

  // ── 判断词条是否存在 ───────────────────────────────────────────────
  // 词源谷的"词不存在"页面通常包含这些文本
  const NOT_FOUND_KEYWORDS = [
    '未找到', '找不到', '词条不存在', '没有找到', '404', 'not found',
    '页面不存在', '这个词还没有', '暂无收录'
  ];

  function isNotFoundPage(text) {
    const lower = text.toLowerCase();
    return NOT_FOUND_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
  }

  // ── 解析词源谷 /word/{word} 页面 ──────────────────────────────────
  function parseWordPage(html, word) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
    const bodyHtml = doc.body ? doc.body.innerHTML || '' : '';

    // 检测是否为"词不存在"页面
    if (isNotFoundPage(bodyText) || isNotFoundPage(bodyHtml)) {
      return { word, notFound: true };
    }

    const result = {
      word,
      notFound: false,
      phonetic_en: '',
      phonetic_us: '',
      pos: '',
      etymology: '',
      first_year: '',
      related: [],
      source_url: `${BASE}/word/${word}`,
    };

    // ── 音标 ─────────────────────────────────────────────────────
    // 典型格式: 英 [ˈkəˈmeməreit]  美 [kəˈmeməret]
    const phoneticMatch = bodyText.match(/英\s*[\[【]([^\]】]+)[\]】].*?美\s*[\[【]([^\]】]+)[\]】]/s);
    if (phoneticMatch) {
      result.phonetic_en = phoneticMatch[1].trim();
      result.phonetic_us = phoneticMatch[2].trim();
    } else {
      // 宽松匹配
      const pm = bodyText.match(/\[([^\]]{5,50})\]/);
      if (pm) result.phonetic_en = pm[1].trim();
    }

    // ── 词性 ─────────────────────────────────────────────────────
    const posMatch = bodyText.match(
      /\b(n\.|v\.|adj\.|adv\.|interj\.|prep\.|conj\.|pron\.)\b/gi
    );
    if (posMatch) result.pos = posMatch[0];

    // ── 词源正文 ───────────────────────────────────────────────────
    // 找含词源关键词的段落
    const allEls = Array.from(doc.querySelectorAll('p, div.content, .word-content, .entry-content, article > div'));
    const etyCandidates = allEls
      .map(el => el.textContent.trim())
      .filter(t => t.length > 30 && (
        t.includes('源自') || t.includes('来自') || t.includes('追溯') ||
        t.includes('源于') || t.includes('世纪') || t.includes('年代') ||
        t.includes('PIE') || t.includes('古英语') || t.includes('古希腊') ||
        t.includes('拉丁') || t.includes('希腊') || t.includes('词根')
      ));

    if (etyCandidates.length > 0) {
      result.etymology = etyCandidates.slice(0, 4).join('\n\n');
    } else {
      // 降级：找最长的正文段落
      const bodyParas = Array.from(doc.querySelectorAll('p'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 50)
        .sort((a, b) => b.length - a.length);
      result.etymology = bodyParas.slice(0, 3).join('\n\n');
    }

    // 如果正文太短或为空，视为无效页面
    if (!result.etymology || result.etymology.length < 20) {
      return { word, notFound: true };
    }

    // ── 首次记录年份 ─────────────────────────────────────────────
    const yearMatch = result.etymology.match(/(\d{4})\s*年/);
    if (yearMatch) result.first_year = yearMatch[1];

    // ── 相关词 ─────────────────────────────────────────────────────
    // 只从 <div class="related"> 区块提取，排除随机词区域 <aside class="hot">
    const relatedDiv = doc.querySelector('.related');
    const links = relatedDiv
      ? Array.from(relatedDiv.querySelectorAll('a[href*="/word/"]'))
      : [];
    const seen = new Set();
    const relatedWords = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/word\/([^/?#]+)/);
      if (!m) continue;
      const w = m[1].toLowerCase();
      if (w && w !== word && /^[a-z\-]+$/.test(w) && !seen.has(w)) {
        seen.add(w);
        relatedWords.push(w);
      }
      if (relatedWords.length >= 8) break;
    }
    result.related = relatedWords;

    return result;
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
        <div class="error-icon">🔍</div>
        <h3>未找到相关词条</h3>
        <p>${escHtml(msg)}</p>
        <p class="error-tip">可能原因：该词暂未收录于词源谷，或网络连接不稳定。</p>
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

    const base = window.SITE_BASE || '';
    const relatedHtml = data.related.length
      ? data.related.map(w =>
          `<a class="related-tag lookup-related-link" href="${base}/lookup/?q=${encodeURIComponent(w)}" data-word="${escHtml(w)}">${escHtml(w)}</a>`
        ).join('')
      : '<span class="muted">暂无</span>';

    return `
      <div class="lookup-result-card" id="resultCard">
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

        <section class="lk-section">
          <h3 class="lk-section-title"><span>⚗️</span> 词源解析</h3>
          <div class="lk-etymology">${etyLines}</div>
        </section>

        <section class="lk-section">
          <h3 class="lk-section-title"><span>🔗</span> 相关词汇</h3>
          <div class="lk-related">${relatedHtml}</div>
        </section>

        <footer class="lk-footer">
          <span>数据来源：</span>
          <a href="${escHtml(data.source_url)}" target="_blank" rel="noopener">词源谷 ciyuangu.com</a>
        </footer>
      </div>`;
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
    } catch (e) { console.error('Save failed', e); }
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
    if (saveBtn) {
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
    }

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

  // ── 核心查询：只用 /word/ ──────────────────────────────────────────
  async function lookupWord(rawWord) {
    const word = rawWord.trim().toLowerCase().replace(/\s+/g, '-');
    if (!word) return;

    const resultEl = document.getElementById('lookupResult');
    resultEl.innerHTML = renderLoading();
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const html = await fetchHtml(`${BASE}/word/${word}`);
      const data = parseWordPage(html, word);

      if (data.notFound) {
        resultEl.innerHTML = renderError(`词源谷暂未收录「${word}」`);
        return;
      }

      resultEl.innerHTML = renderWordResult(data);
      bindResultEvents(data);
      history.pushState({}, '', `?q=${encodeURIComponent(word)}`);
    } catch (e) {
      console.warn('Lookup failed:', e);
      resultEl.innerHTML = renderError(`无法连接到词源谷，请检查网络后重试`);
    }
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
