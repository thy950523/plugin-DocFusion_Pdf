/* global DocuParser, DocuPrinter */
const DEFAULT_CONFIG = {
  sidebarSelector: ["aside a", "[class*=sidebar] a", "nav a"],
  contentSelector: [
    ".prose",
    "[class*=prose]",
    "[class*=markdown]",
    "[class*=mdx]",
    "#__next main",
    "main",
    "article",
    ".content",
    "[class*=content]"
  ],
  excludeSelectors: [
    ".ad",
    ".ads",
    ".advertisement",
    ".comments",
    ".comment",
    ".breadcrumb",
    "footer",
    "nav",
  ],
  concurrency: 5,
  requestDelay: 150,
};

const SITE_CONFIGS = {
  "docs.creem.io": {
    sidebarSelector: ["[class*=sidebar] a", "nav a"],
    contentSelector: [
      ".prose",
      "[class*=prose]",
      "[class*=markdown]",
      "[class*=mdx]",
      "[data-docs-content]",
      "#__next main",
      "article",
      ".content",
      "[class*=content]"
    ],
    excludeSelectors: [
      ".ad",
      ".ads",
      ".advertisement",
      ".comments",
      ".comment",
      ".breadcrumb",
      "footer",
      "nav",
    ],
    concurrency: 3,
    requestDelay: 200,
  },
  "doris.apache.org": {
    sidebarSelector: ["aside a", "nav a", "[class*=sidebar] a", "[role=navigation] a"],
    contentSelector: [
      ".prose",
      "[class*=prose]",
      "article",
      "main",
      ".content",
      "[class*=content]",
      "#__next main"
    ],
    excludeSelectors: [
      ".ad",
      ".ads",
      ".advertisement",
      ".comments",
      ".comment",
      ".breadcrumb",
      "footer",
      "nav",
    ],
    concurrency: 3,
    requestDelay: 200,
  },
  "www.remotion.dev": {
    sidebarSelector: [
      "aside a",
      "nav.menu a",
      ".menu__list a",
      "[class*=sidebar] a",
      "[role=navigation] a",
    ],
    contentSelector: [
      ".theme-doc-markdown",
      "[class*=markdown]",
      ".prose",
      "[class*=prose]",
      "article",
      "main",
      ".content",
      "[class*=content]",
    ],
    excludeSelectors: [
      ".ad",
      ".ads",
      ".advertisement",
      ".comments",
      ".comment",
      ".breadcrumb",
      "footer",
      "nav",
    ],
    concurrency: 3,
    requestDelay: 150,
  },
};

const CONCURRENCY = DEFAULT_CONFIG.concurrency;
const MAX_PAGES = 200;

let running = false;
let cancelRequested = false;

function getActiveConfig() {
  const host = location.host;
  return SITE_CONFIGS[host] || DEFAULT_CONFIG;
}

function sendMessageToPopup(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (e) {
    // popup might be closed; ignore
  }
}

function sendProgress(current, total, note) {
  sendMessageToPopup({
    type: "DOCUPRINT_PROGRESS",
    current,
    total,
    note,
  });
}

function collectAnchors(selectors) {
  const list = [];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => list.push(node));
  });
  return list;
}

async function scrollSidebarContainers() {
  const containers = Array.from(
    document.querySelectorAll("aside, nav, [class*=sidebar], [data-sidebar], [role=navigation]")
  );
  for (const el of containers) {
    if (!el || !el.scrollHeight || el.scrollHeight <= el.clientHeight) continue;
    const step = Math.max(120, Math.floor(el.clientHeight / 2));
    for (let pos = 0; pos < el.scrollHeight; pos += step) {
      el.scrollTop = pos;
      // 通过短暂延时给虚拟列表渲染留时间
      // eslint-disable-next-line no-await-in-loop
      await delay(50);
    }
    el.scrollTop = 0;
  }
}

async function expandSidebar(selectors) {
  // 尝试展开折叠的目录节点
  const toggleSelectors = [
    "aside button[aria-expanded]",
    "nav button[aria-expanded]",
    "[class*=sidebar] button[aria-expanded]",
    "aside details summary",
    "nav details summary",
    "[class*=sidebar] details summary",
  ];

  const toggles = [];
  toggleSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      const container = el.closest("aside, nav, [class*=sidebar]");
      if (container) toggles.push(el);
    });
  });

  for (const el of toggles) {
    try {
      if (el.tagName === "SUMMARY") {
        el.click();
      } else if (el.getAttribute("aria-expanded") === "false") {
        el.click();
      }
    } catch (e) {
      // 忽略单个切换失败
    }
  }

  if (toggles.length) {
    await delay(200);
  }
}

function waitForAnchors(selectors, timeout = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (anchors) => {
      if (resolved) return;
      resolved = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(anchors);
    };

    const obs = new MutationObserver(() => {
      const anchors = collectAnchors(selectors);
      if (anchors.length) finish(anchors);
    });

    const timer = setTimeout(() => finish(collectAnchors(selectors)), timeout);
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

    const initial = collectAnchors(selectors);
    if (initial.length) finish(initial);
  });
}

async function extractLinks(config = DEFAULT_CONFIG) {
  const selectors = Array.isArray(config.sidebarSelector)
    ? config.sidebarSelector
    : [config.sidebarSelector];
  await scrollSidebarContainers();
  await expandSidebar(selectors);
  let anchors = collectAnchors(selectors);
  if (!anchors.length) {
    anchors = await waitForAnchors(selectors);
  }
  const seen = new Set();
  const links = [];

  const levels = [];

  function getDepth(node) {
    let depth = 0;
    let current = node.parentElement;
    while (current && current !== document.body) {
      if (current.tagName === "UL" || current.tagName === "OL" || current.tagName === "NAV") {
        depth += 1;
      }
      current = current.parentElement;
    }
    return depth;
  }

  anchors.forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    const absolute = DocuParser.toAbsolute(href, location.href);
    if (!absolute) return;
    const normalized = DocuParser.stripHash(absolute);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const depth = getDepth(a);
    levels.push(depth);
    links.push({
      url: normalized,
      title: a.textContent?.trim() || normalized,
      level: depth,
    });
  });

  if (!seen.has(DocuParser.stripHash(location.href))) {
    levels.push(0);
    links.unshift({
      url: DocuParser.stripHash(location.href),
      title: document.title || "当前页面",
      level: 0,
    });
  }

  const minLevel = levels.length ? Math.min(...levels, 0) : 0;
  const normalized = links.map((item) => ({
    ...item,
    level: Math.max(1, item.level - minLevel + 1),
  }));

  return normalized.slice(0, MAX_PAGES);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await delay(400 * (i + 1));
      }
    }
  }
  throw lastError;
}

async function fetchPage(url, config) {
  const html = await fetchWithRetry(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("h1")?.textContent?.trim() || doc.title || url;
  const contentNode = DocuParser.sanitizeContent(doc, url, config);
  if (!contentNode) throw new Error("未找到正文");
  const styles = DocuParser.collectStyles(doc, url);
  return {
    title,
    url,
    html: contentNode.outerHTML,
    styles,
  };
}

async function crawlAll(urls, config) {
  const results = new Array(urls.length);
  const stylesSet = new Set();
  const concurrency = config.concurrency || CONCURRENCY;
  const delayMs = config.requestDelay || DEFAULT_CONFIG.requestDelay || 0;
  let index = 0;

  async function worker() {
    while (index < urls.length && !cancelRequested) {
      const currentIndex = index++;
      const url = urls[currentIndex].url;
      try {
        const page = await fetchPage(url, config);
        results[currentIndex] = page;
        page.styles.forEach((s) => stylesSet.add(s));
        sendProgress(currentIndex + 1, urls.length, `正在处理 "${page.title}"...`);
      } catch (e) {
        results[currentIndex] = {
          title: `抓取失败`,
          url,
          html: `<div class="docuprint-error">[Error: 此页面抓取失败 - ${url}]</div>`,
          styles: [],
        };
        sendProgress(currentIndex + 1, urls.length, `跳过失败页面：${url}`);
      }
      if (delayMs) {
        await delay(delayMs);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return {
    pages: results,
    styles: Array.from(stylesSet),
  };
}

async function startPipeline() {
  if (running) return { ok: false, reason: "busy" };
  running = true;
  cancelRequested = false;
  sendProgress(0, 1, "开始解析侧边栏链接...");
  const activeConfig = getActiveConfig();
  const links = await extractLinks(activeConfig);
  if (!links.length) {
    sendMessageToPopup({ type: "DOCUPRINT_ERROR", error: "未找到可抓取的链接" });
    running = false;
    return { ok: false, reason: "no-links" };
  }

  const { pages, styles } = await crawlAll(links, activeConfig);
  if (cancelRequested) {
    running = false;
    sendMessageToPopup({ type: "DOCUPRINT_ERROR", error: "已取消抓取" });
    return { ok: false, reason: "cancelled" };
  }

  const slugSeen = new Map();
  const preparedPages = pages.map((page, idx) => {
    const baseSlug = DocuPrinter.slugify(page.title, `chapter-${idx + 1}`);
    const count = slugSeen.get(baseSlug) || 0;
    slugSeen.set(baseSlug, count + 1);
    const uniqueSlug = count ? `${baseSlug}-${count + 1}` : baseSlug;
    return {
      ...page,
      anchorId: uniqueSlug,
      level: links[idx]?.level || 1,
    };
  });

  DocuPrinter.buildPrintPage({
    pages: preparedPages,
    styles,
    siteTitle: document.title,
  });

  sendMessageToPopup({ type: "DOCUPRINT_READY" });
  running = false;
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "DOCUPRINT_START") {
    startPipeline().then(sendResponse);
    return true;
  }
  if (message?.action === "DOCUPRINT_CANCEL") {
    cancelRequested = true;
    sendResponse({ ok: true });
  }
});
