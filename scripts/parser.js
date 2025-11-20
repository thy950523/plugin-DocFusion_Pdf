(function () {
  const DEFAULT_SELECTORS = ["main", "article", ".content"];

  function stripHash(url) {
    try {
      const u = new URL(url, document.baseURI);
      u.hash = "";
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function toAbsolute(link, baseUrl) {
    if (!link) return null;
    try {
      return new URL(link, baseUrl).toString();
    } catch (e) {
      return null;
    }
  }

  function selectContent(doc, selectors = DEFAULT_SELECTORS) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (node) return node.cloneNode(true);
    }
    return null;
  }

  function stripScripts(root) {
    root.querySelectorAll("script, style").forEach((n) => n.remove());
  }

  function removeUnwanted(root, excludeSelectors = []) {
    excludeSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => node.remove());
    });
  }

  function fixImages(root, pageUrl) {
    root.querySelectorAll("img").forEach((img) => {
      if (img.dataset && img.dataset.src) {
        img.src = img.dataset.src;
      }
      const abs = toAbsolute(img.getAttribute("src"), pageUrl);
      if (abs) {
        img.src = abs;
      }
      img.removeAttribute("loading");
    });
  }

  function fixLinks(root, pageUrl) {
    root.querySelectorAll("a").forEach((a) => {
      const abs = toAbsolute(a.getAttribute("href"), pageUrl);
      if (abs) {
        a.href = abs;
      }
    });
  }

  function sanitizeContent(doc, pageUrl, config) {
    const { contentSelector, excludeSelectors } = config;
    const target = selectContent(doc, contentSelector || DEFAULT_SELECTORS);
    if (!target) return null;
    stripScripts(target);
    removeUnwanted(target, excludeSelectors || []);
    fixImages(target, pageUrl);
    fixLinks(target, pageUrl);
    return target;
  }

  function collectStyles(doc, pageUrl) {
    const styles = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = toAbsolute(link.getAttribute("href"), pageUrl);
      if (href) styles.push(href);
    });
    return styles;
  }

  window.DocuParser = {
    stripHash,
    toAbsolute,
    sanitizeContent,
    collectStyles,
  };
})();
