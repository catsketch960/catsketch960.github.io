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
    'generative recommendation',
    'generative recommender',
    'LLM recommendation',
    'large language model recommendation',
    'diffusion recommendation',
    'generative retrieval recommendation',
  ],

  buildQuery(searchText = '', category = 'all', start = 0, maxResults = 10) {
    let searchQuery;
    if (searchText.trim()) {
      const phrase = searchText.trim().replace(/\s+/g, '+');
      searchQuery = `ti:%22${phrase}%22+OR+abs:%22${phrase}%22`;
    } else {
      const terms = this.SEARCH_TERMS
        .map(t => {
          const phrase = t.replace(/\s+/g, '+');
          return `ti:%22${phrase}%22+OR+abs:%22${phrase}%22`;
        })
        .join('+OR+');
      searchQuery = terms;
    }
    if (category !== 'all') {
      searchQuery = `cat:${category}+AND+(${searchQuery})`;
    }
    return `${this.BASE_URL}?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`;
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
  GOOGLE_URL: 'https://translate.googleapis.com/translate_a/single',
  MYMEMORY_URL: 'https://api.mymemory.translated.net/get',
  CORS_PROXIES: [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url=',
  ],

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

  splitIntoChunks(text, maxLen = 1800) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitAt = -1;
      for (let i = Math.min(maxLen, remaining.length) - 1; i >= maxLen * 0.5; i--) {
        if ('. ? ! ; '.includes(remaining[i] + ' ')) {
          splitAt = i + 1;
          break;
        }
      }
      if (splitAt === -1) {
        const spaceAt = remaining.lastIndexOf(' ', maxLen);
        splitAt = spaceAt > maxLen * 0.3 ? spaceAt + 1 : maxLen;
      }
      chunks.push(remaining.substring(0, splitAt).trim());
      remaining = remaining.substring(splitAt).trim();
    }
    return chunks;
  },

  parseGoogleResponse(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    return data[0]
      .filter(seg => seg && seg[0])
      .map(seg => seg[0])
      .join('');
  },

  async googleTranslateChunk(chunk) {
    const params = new URLSearchParams({
      client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't',
      q: chunk,
    });
    const targetUrl = `${this.GOOGLE_URL}?${params.toString()}`;

    const fetchOne = (url) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      return fetch(url, { signal: controller.signal })
        .then(r => { clearTimeout(tid); return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)); })
        .catch(e => { clearTimeout(tid); throw e; });
    };

    const attempts = this.CORS_PROXIES.map(proxy =>
      fetchOne(proxy + encodeURIComponent(targetUrl))
    );
    attempts.push(fetchOne(targetUrl));

    const data = await Promise.any(attempts);
    const text = this.parseGoogleResponse(data);
    if (!text) throw new Error('Failed to parse Google response');
    return text;
  },

  async myMemoryChunk(chunk) {
    const params = new URLSearchParams({ q: chunk, langpair: 'en|zh-CN' });
    const resp = await fetch(`${this.MYMEMORY_URL}?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.responseStatus === 200 && data.responseData) {
      return data.responseData.translatedText;
    }
    throw new Error('MyMemory translation failed');
  },

  async translateChunk(chunk) {
    try {
      return await this.googleTranslateChunk(chunk);
    } catch (err) {
      console.warn('Google Translate failed, trying MyMemory:', err.message);
      try {
        return await this.myMemoryChunk(chunk);
      } catch (err2) {
        console.warn('MyMemory also failed:', err2.message);
        throw err2;
      }
    }
  },

  async translate(text) {
    const cached = this.getCached(text);
    if (cached) return cached;

    try {
      const chunks = this.splitIntoChunks(text);
      const results = [];
      for (const chunk of chunks) {
        const translated = await this.translateChunk(chunk);
        results.push(translated);
        if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
      }
      const full = results.join('');
      this.setCache(text, full);
      return full;
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

  const industryBadge = paper.industrySource
    ? `<span class="tag industry-tag">🏢 ${paper.industrySource}</span>`
    : '';

  return `
    <div class="paper-card reveal ${paper.industrySource ? 'industry-paper' : ''}" style="animation-delay: ${index * 0.05}s">
      <div class="paper-header">
        <h3 class="paper-title">
          ${industryBadge}
          <a href="${paper.absUrl}" target="_blank" rel="noopener">${paper.title}</a>
        </h3>
        <div class="paper-title-zh" id="title-zh-${index}">
          <span class="translate-loading">翻译中 <span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
        </div>
      </div>
      <div class="paper-meta">
        <span>👤 ${authorsStr}</span>
        <span>📅 ${formatDate(paper.published)}</span>
      </div>
      <div class="paper-tags">${tagsHTML}</div>
      <p class="paper-abstract" id="abs-${index}">${paper.abstract}</p>
      <div class="paper-abstract-zh" id="abs-zh-${index}">
        <span class="translate-loading">翻译中 <span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
      </div>
      <div class="paper-actions">
        <button class="btn btn-sm btn-translate" onclick="retranslate(${index}, this)">
          🌐 翻译
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

let currentPapers = [];

async function autoTranslatePaper(index) {
  const paper = currentPapers[index];
  if (!paper) return;

  const titleContainer = document.getElementById(`title-zh-${index}`);
  const absContainer = document.getElementById(`abs-zh-${index}`);

  const titleTranslation = await Translator.translate(paper.title);
  if (titleContainer) {
    titleContainer.innerHTML = titleTranslation || '<span style="color:var(--text-muted);">标题翻译暂不可用</span>';
  }

  const absTranslation = await Translator.translate(paper.abstract);
  if (absContainer) {
    absContainer.innerHTML = absTranslation || '<span style="color:var(--text-muted);">摘要翻译暂不可用</span>';
  }
}

async function autoTranslateAll() {
  for (let i = 0; i < currentPapers.length; i++) {
    await autoTranslatePaper(i);
    if (i < currentPapers.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function retranslate(index, btnEl) {
  const paper = currentPapers[index];
  if (!paper) return;

  const titleContainer = document.getElementById(`title-zh-${index}`);
  const absContainer = document.getElementById(`abs-zh-${index}`);
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '🌐 翻译中...'; }

  const loadingHTML = '<span class="translate-loading">翻译中 <span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  if (titleContainer) titleContainer.innerHTML = loadingHTML;
  if (absContainer) absContainer.innerHTML = loadingHTML;

  const titleKey = Translator.CACHE_PREFIX + Translator.hashCode(paper.title);
  const absKey = Translator.CACHE_PREFIX + Translator.hashCode(paper.abstract);
  localStorage.removeItem(titleKey);
  localStorage.removeItem(absKey);

  const titleTranslation = await Translator.translate(paper.title);
  if (titleContainer) {
    titleContainer.innerHTML = titleTranslation || '<span style="color:var(--text-muted);">标题翻译暂不可用</span>';
  }

  const absTranslation = await Translator.translate(paper.abstract);
  if (absContainer) {
    absContainer.innerHTML = absTranslation || '<span style="color:var(--text-muted);">摘要翻译暂不可用</span>';
  }

  if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🌐 翻译'; }
}

async function handleTranslateAll(btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '🌐 翻译中...'; }
  const loadingHTML = '<span class="translate-loading">翻译中 <span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  for (let i = 0; i < currentPapers.length; i++) {
    const tc = document.getElementById(`title-zh-${i}`);
    const ac = document.getElementById(`abs-zh-${i}`);
    if (tc && !tc.textContent.trim()) tc.innerHTML = loadingHTML;
    if (ac && !ac.textContent.trim()) ac.innerHTML = loadingHTML;
  }
  await autoTranslateAll();
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🌐 翻译本页'; }
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

/* ---- Local JSON data loader ---- */
let cachedData = null;

async function loadLocalData() {
  if (cachedData) return cachedData;
  try {
    const resp = await fetch('data/papers.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    cachedData = await resp.json();
    return cachedData;
  } catch {
    return null;
  }
}

function showLastUpdated(lastUpdated) {
  const el = document.getElementById('last-updated');
  if (!el || !lastUpdated) return;
  const d = new Date(lastUpdated);
  el.textContent = d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function filterPapers(papers, searchText = '', category = 'all') {
  let filtered = papers;
  if (searchText.trim()) {
    const kw = searchText.trim().toLowerCase();
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(kw) ||
      p.abstract.toLowerCase().includes(kw) ||
      p.authors.some(a => a.toLowerCase().includes(kw))
    );
  }
  if (category !== 'all') {
    filtered = filtered.filter(p => p.categories.includes(category));
  }
  return filtered;
}

function normalizePaper(p) {
  return {
    ...p,
    published: p.published ? new Date(p.published) : null,
    updated: p.updated ? new Date(p.updated) : null,
  };
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
      <p class="loading-text">正在加载论文数据...</p>
    </div>`;

  try {
    const data = await loadLocalData();
    if (!data || !data.papers.length) throw new Error('No local data');

    showLastUpdated(data.lastUpdated);

    const allPapers = data.papers.map(normalizePaper);
    const filtered = filterPapers(allPapers, searchText, category);
    totalResults = filtered.length;
    currentPage = page;

    const start = page * PAGE_SIZE;
    const pagePapers = filtered.slice(start, start + PAGE_SIZE);
    currentPapers = pagePapers;

    if (pagePapers.length === 0) {
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

    listEl.innerHTML = pagePapers.map((p, i) => createPaperCardHTML(p, i)).join('');

    if (paginationEl) {
      const totalPages = Math.ceil(totalResults / PAGE_SIZE);
      paginationEl.innerHTML = `
        <button onclick="changePage(${page - 1})" ${page <= 0 ? 'disabled' : ''}>← 上一页</button>
        <span class="page-info">第 ${page + 1} / ${totalPages} 页</span>
        <button onclick="changePage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>下一页 →</button>
      `;
    }

    setTimeout(initReveal, 100);
    setTimeout(autoTranslateAll, 300);
  } catch (err) {
    console.error('Failed to load papers:', err);
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>论文数据加载失败，请稍后刷新页面。</p>
        <button class="btn btn-sm btn-outline" onclick="loadPapers(${page})" style="margin-top:1rem">
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
    const data = await loadLocalData();
    if (!data || !data.papers.length) throw new Error('No local data');

    showLastUpdated(data.lastUpdated);

    const papers = data.papers.slice(0, 6).map(normalizePaper);
    currentPapers = papers;

    container.innerHTML = papers.map((paper, i) => {
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
