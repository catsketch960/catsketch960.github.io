/* ============================================
   AI RecPaper Hub - Main Application Logic
   ============================================ */

const ArxivAPI = {
  BASE_URL: 'https://export.arxiv.org/api/query',
  CORS_PROXIES: [
    { url: 'https://corsproxy.io/?url=', type: 'text' },
    { url: 'https://api.allorigins.win/raw?url=', type: 'text' },
    { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'text' },
  ],

  CATEGORIES: {
    'all': '全部',
    'cs.IR': '信息检索',
    'cs.LG': '机器学习',
    'cs.AI': '人工智能',
    'cs.CL': '计算语言学',
    'cs.CV': '计算机视觉',
  },

  SEARCH_TERMS: [
    'recommendation system',
    'recommender system',
    'collaborative filtering',
    'click-through rate',
    'CTR prediction',
    'sequential recommendation',
    'knowledge graph recommendation',
    'graph neural network recommendation',
  ],

  buildQuery(searchText = '', category = 'all', start = 0, maxResults = 10) {
    let query;
    if (searchText.trim()) {
      query = `all:${searchText.trim().replace(/\s+/g, '+')}`;
    } else {
      const terms = this.SEARCH_TERMS.slice(0, 4)
        .map(t => `all:"${t}"`)
        .join('+OR+');
      query = `(${terms})`;
    }
    if (category !== 'all') {
      query = `cat:${category}+AND+${query}`;
    }
    const params = new URLSearchParams({
      search_query: query,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      start: start.toString(),
      max_results: maxResults.toString(),
    });
    return `${this.BASE_URL}?${params.toString()}`;
  },

  parseEntry(entry) {
    const getText = (tag) => {
      const el = entry.querySelector(tag);
      return el ? el.textContent.trim() : '';
    };

    const getAll = (tag) => {
      return Array.from(entry.querySelectorAll(tag)).map(el => el.textContent.trim());
    };

    const links = Array.from(entry.querySelectorAll('link'));
    const pdfLink = links.find(l => l.getAttribute('title') === 'pdf');
    const absLink = links.find(l => l.getAttribute('type') === 'text/html') || links[0];

    const categories = Array.from(entry.querySelectorAll('category'))
      .map(c => c.getAttribute('term'))
      .filter(Boolean);

    const published = getText('published');
    const updated = getText('updated');

    return {
      id: getText('id'),
      title: getText('title').replace(/\s+/g, ' '),
      authors: getAll('author > name'),
      abstract: getText('summary').replace(/\s+/g, ' '),
      published: published ? new Date(published) : null,
      updated: updated ? new Date(updated) : null,
      categories,
      pdfUrl: pdfLink ? pdfLink.getAttribute('href') : '',
      absUrl: absLink ? absLink.getAttribute('href') : '',
    };
  },

  async fetchWithProxy(url) {
    const fetchOne = (target) => {
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const tid = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 12000);
        fetch(target, { signal: controller.signal })
          .then(r => { clearTimeout(tid); return r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)); })
          .then(resolve)
          .catch(e => { clearTimeout(tid); reject(e); });
      });
    };

    const proxyUrls = this.CORS_PROXIES.map(p => fetchOne(p.url + encodeURIComponent(url)));
    try {
      return await Promise.any(proxyUrls);
    } catch {
      return await fetchOne(url);
    }
  },

  async fetchPapers(searchText = '', category = 'all', start = 0, maxResults = 10) {
    const url = this.buildQuery(searchText, category, start, maxResults);
    const xml = await this.fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const totalResults = doc.querySelector('totalResults');
    const total = totalResults ? parseInt(totalResults.textContent) : 0;

    const entries = Array.from(doc.querySelectorAll('entry'));
    const papers = entries.map(e => this.parseEntry(e));

    return { papers, total, start, maxResults };
  },
};

const Translator = {
  CACHE_PREFIX: 'trans_',
  API_URL: 'https://api.mymemory.translated.net/get',

  getCached(text) {
    const key = this.CACHE_PREFIX + this.hashCode(text);
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  },

  setCache(text, translation) {
    const key = this.CACHE_PREFIX + this.hashCode(text);
    try {
      localStorage.setItem(key, JSON.stringify(translation));
    } catch (e) {
      // localStorage full, clear old entries
      this.clearOldCache();
    }
  },

  clearOldCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.CACHE_PREFIX)) keys.push(key);
    }
    keys.slice(0, Math.floor(keys.length / 2)).forEach(k => localStorage.removeItem(k));
  },

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  },

  async translate(text) {
    const cached = this.getCached(text);
    if (cached) return cached;

    const truncated = text.length > 450 ? text.substring(0, 450) + '...' : text;

    try {
      const params = new URLSearchParams({
        q: truncated,
        langpair: 'en|zh-CN',
      });
      const resp = await fetch(`${this.API_URL}?${params.toString()}`);
      const data = await resp.json();

      if (data.responseStatus === 200 && data.responseData) {
        const translated = data.responseData.translatedText;
        this.setCache(text, translated);
        return translated;
      }
      throw new Error('Translation failed');
    } catch (err) {
      console.warn('Translation error:', err);
      return null;
    }
  },
};

/* ---- UI Helpers ---- */
function formatDate(date) {
  if (!date) return '';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getCategoryClass(cat) {
  if (cat.startsWith('cs.IR')) return 'cs-ir';
  if (cat.startsWith('cs.LG')) return 'cs-lg';
  if (cat.startsWith('cs.AI')) return 'cs-ai';
  return '';
}

function createPaperCardHTML(paper, index) {
  const authorsStr = paper.authors.slice(0, 3).join(', ') +
    (paper.authors.length > 3 ? ` 等 ${paper.authors.length} 位作者` : '');

  const tagsHTML = paper.categories.slice(0, 4)
    .map(c => `<span class="tag ${getCategoryClass(c)}">${c}</span>`)
    .join('');

  return `
    <div class="paper-card reveal" style="animation-delay: ${index * 0.05}s">
      <div class="paper-header">
        <h3 class="paper-title">
          <a href="${paper.absUrl}" target="_blank" rel="noopener">${paper.title}</a>
        </h3>
      </div>
      <div class="paper-meta">
        <span>👤 ${authorsStr}</span>
        <span>📅 ${formatDate(paper.published)}</span>
      </div>
      <div class="paper-tags">${tagsHTML}</div>
      <p class="paper-abstract collapsed" id="abs-${index}">${paper.abstract}</p>
      <div id="abs-zh-${index}"></div>
      <div class="paper-actions">
        <button class="btn btn-sm btn-outline" onclick="toggleAbstract(${index})">
          📖 展开摘要
        </button>
        <button class="btn btn-sm btn-translate" onclick="translateAbstract(${index}, this)" id="trans-btn-${index}">
          🌐 翻译为中文
        </button>
        <a class="btn btn-sm btn-outline" href="${paper.pdfUrl}" target="_blank" rel="noopener">
          📄 PDF
        </a>
        <a class="btn btn-sm btn-outline" href="${paper.absUrl}" target="_blank" rel="noopener">
          🔗 arXiv
        </a>
      </div>
    </div>
  `;
}

function toggleAbstract(index) {
  const el = document.getElementById(`abs-${index}`);
  if (!el) return;
  el.classList.toggle('collapsed');
  const btn = el.closest('.paper-card').querySelector('.paper-actions button');
  if (btn) {
    btn.textContent = el.classList.contains('collapsed') ? '📖 展开摘要' : '📖 收起摘要';
  }
}

let currentPapers = [];

async function translateAbstract(index, btnEl) {
  const paper = currentPapers[index];
  if (!paper) return;
  const container = document.getElementById(`abs-zh-${index}`);
  if (!container) return;

  if (container.innerHTML) {
    container.innerHTML = '';
    if (btnEl) btnEl.textContent = '🌐 翻译为中文';
    return;
  }

  container.innerHTML = `
    <div class="translate-loading">
      翻译中 <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>`;
  if (btnEl) btnEl.disabled = true;

  const translation = await Translator.translate(paper.abstract);

  if (translation) {
    container.innerHTML = `<div class="paper-abstract-zh">${translation}</div>`;
    if (btnEl) {
      btnEl.textContent = '🌐 隐藏翻译';
      btnEl.disabled = false;
    }
  } else {
    container.innerHTML = `<div class="paper-abstract-zh" style="border-left-color: var(--accent-pink);">
      ⚠️ 翻译服务暂时不可用，请稍后再试。</div>`;
    if (btnEl) {
      btnEl.textContent = '🌐 重试翻译';
      btnEl.disabled = false;
    }
  }
}

/* ---- Navbar scroll effect ---- */
window.addEventListener('scroll', () => {
  const nav = document.querySelector('.navbar');
  if (nav) {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }
});

/* ---- Mobile nav toggle ---- */
function toggleNav() {
  document.querySelector('.nav-links')?.classList.toggle('open');
}

/* ---- Scroll reveal ---- */
function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

/* ---- Papers page logic ---- */
let currentPage = 0;
let totalResults = 0;
const PAGE_SIZE = 10;

async function loadPapers(page = 0, searchText = '', category = 'all') {
  const listEl = document.getElementById('papers-list');
  const paginationEl = document.getElementById('pagination');
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">正在从 arXiv 获取最新论文...</p>
    </div>`;

  try {
    const result = await ArxivAPI.fetchPapers(searchText, category, page * PAGE_SIZE, PAGE_SIZE);
    currentPapers = result.papers;
    totalResults = result.total;
    currentPage = page;

    if (result.papers.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>没有找到相关论文，试试调整搜索关键词。</p>
        </div>`;
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    const statsEl = document.getElementById('total-count');
    if (statsEl) statsEl.textContent = totalResults.toLocaleString();

    listEl.innerHTML = result.papers.map((p, i) => createPaperCardHTML(p, i)).join('');

    if (paginationEl) {
      const totalPages = Math.ceil(totalResults / PAGE_SIZE);
      paginationEl.innerHTML = `
        <button onclick="changePage(${page - 1})" ${page <= 0 ? 'disabled' : ''}>← 上一页</button>
        <span class="page-info">第 ${page + 1} / ${Math.min(totalPages, 100)} 页</span>
        <button onclick="changePage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>下一页 →</button>
      `;
    }

    setTimeout(initReveal, 100);
  } catch (err) {
    console.error('Failed to fetch papers:', err);
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>获取论文失败，请检查网络连接后重试。</p>
        <button class="btn btn-sm btn-outline" onclick="loadPapers(${page}, '${searchText}', '${category}')" style="margin-top:1rem">
          🔄 重试
        </button>
      </div>`;
  }
}

function changePage(page) {
  if (page < 0) return;
  const searchText = document.getElementById('search-input')?.value || '';
  const category = document.getElementById('category-select')?.value || 'all';
  loadPapers(page, searchText, category);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSearch() {
  const searchText = document.getElementById('search-input')?.value || '';
  const category = document.getElementById('category-select')?.value || 'all';
  loadPapers(0, searchText, category);
}

let searchTimer;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(handleSearch, 600);
}

/* ---- Homepage papers preview ---- */
async function loadPapersPreview() {
  const container = document.getElementById('papers-preview');
  if (!container) return;

  try {
    const result = await ArxivAPI.fetchPapers('', 'all', 0, 6);
    currentPapers = result.papers;

    container.innerHTML = result.papers.map((paper, i) => {
      const authorsStr = paper.authors.slice(0, 2).join(', ');
      const tagsHTML = paper.categories.slice(0, 2)
        .map(c => `<span class="tag ${getCategoryClass(c)}">${c}</span>`)
        .join('');

      return `
        <div class="paper-card reveal" style="animation-delay: ${i * 0.08}s">
          <h3 class="paper-title" style="font-size:1rem; margin-bottom:0.5rem;">
            <a href="${paper.absUrl}" target="_blank" rel="noopener">${paper.title}</a>
          </h3>
          <div class="paper-meta" style="margin-bottom:0.5rem;">
            <span>👤 ${authorsStr}</span>
            <span>📅 ${formatDate(paper.published)}</span>
          </div>
          <div class="paper-tags">${tagsHTML}</div>
          <p class="paper-abstract collapsed" style="-webkit-line-clamp:2; font-size:0.88rem;">${paper.abstract}</p>
        </div>`;
    }).join('');

    setTimeout(initReveal, 200);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; grid-column:1/-1;">
      ⏳ 论文加载中，请稍后刷新页面...</p>`;
  }
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  initReveal();

  if (document.getElementById('papers-preview')) {
    loadPapersPreview();
  }

  if (document.getElementById('papers-list')) {
    loadPapers();
  }
});
