/* global DocuParser, DocuPrinter */
const DEFAULT_CONFIG = {
  sidebarSelector: "aside a",
  contentSelector: ["main", "article", ".content"],
  excludeSelectors: [".ad", ".ads", ".advertisement", ".comments", ".comment", ".breadcrumb"],
};

const CONCURRENCY = 5;
const MAX_PAGES = 200;

let running = false;
let cancelRequested = false;

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

function extractLinks(config = DEFAULT_CONFIG) {
  const anchors = Array.from(document.querySelectorAll(config.sidebarSelector));
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

async function fetchPage(url, config) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title ||
    url;
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
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
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
  const links = extractLinks(DEFAULT_CONFIG);
  if (!links.length) {
    sendMessageToPopup({ type: "DOCUPRINT_ERROR", error: "未找到可抓取的链接" });
    running = false;
    return { ok: false, reason: "no-links" };
  }

  const { pages, styles } = await crawlAll(links, DEFAULT_CONFIG);
  if (cancelRequested) {
    running = false;
    sendMessageToPopup({ type: "DOCUPRINT_ERROR", error: "已取消抓取" });
    return { ok: false, reason: "cancelled" };
  }

  const preparedPages = pages.map((page, idx) => ({
    ...page,
    anchorId: DocuPrinter.slugify(page.title, `chapter-${idx + 1}`),
    level: links[idx]?.level || 1,
  }));

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
