(function () {
  function slugify(text, fallback) {
    if (!text) return fallback;
    return text
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "") || fallback;
  }

  function buildStylesheetLinks(links) {
    return (links || [])
      .map((href) => `<link rel="stylesheet" href="${href}">`)
      .join("\n");
  }

  function buildNestedToc(pages) {
    let currentLevel = 1;
    let html = '<ul class="toc-list level-1">';

    const openToLevel = (target) => {
      while (currentLevel < target) {
        currentLevel += 1;
        html += `<ul class="level-${currentLevel}">`;
      }
    };

    const closeToLevel = (target) => {
      while (currentLevel > target) {
        html += "</ul>";
        currentLevel -= 1;
      }
    };

    pages.forEach((page) => {
      const level = Math.max(1, page.level || 1);
      if (level > currentLevel) {
        openToLevel(level);
      } else if (level < currentLevel) {
        closeToLevel(level);
      }
      html += `<li><a href="#${page.anchorId}">${page.title || page.url}</a></li>`;
    });

    closeToLevel(1);
    html += "</ul>";
    return html;
  }

  function buildToc(pages) {
    const nested = buildNestedToc(pages);
    return `<section class="toc-container">
  <h1>目录</h1>
  ${nested}
</section>`;
  }

  function buildChapters(pages) {
    return pages
      .map(
        (page) => `<section id="${page.anchorId}" class="chapter-wrapper">
  <h1>${page.title || page.url}</h1>
  ${page.html}
</section>`
      )
      .join("\n");
  }

  function buildPrintPage({ pages, styles, siteTitle }) {
    const styleLinks = buildStylesheetLinks(styles);
    const toc = buildToc(pages);
    const chapters = buildChapters(pages);
    const today = new Date().toISOString().split("T")[0];

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteTitle || "Document"} - DocuPrint</title>
  ${styleLinks}
  <style>
    body {
      margin: 0 auto;
      padding: 24px;
      max-width: 1080px;
      background: #f9fafb;
      color: #0f172a;
      font-family: "Noto Serif SC", "Segoe UI", system-ui, -apple-system, sans-serif;
      line-height: 1.6;
    }
    a { color: #0f172a; }
    h1, h2, h3 { color: #0f172a; }
    .cover {
      padding: 80px 0 40px;
      text-align: center;
    }
    .cover h1 { font-size: 36px; margin: 0 0 12px; }
    .cover p { margin: 0; color: #475569; }
    .toc-container { margin: 40px 0; }
    .toc-container ul { list-style: none; padding-left: 0; margin: 0; }
    .toc-container li { margin: 6px 0; }
    .toc-container ul ul { margin-left: 12px; border-left: 1px solid #e2e8f0; padding-left: 12px; }
    .toc-container a { text-decoration: none; }
    .chapter-wrapper { margin: 60px 0; }
    .chapter-wrapper h1 { border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    pre, code { font-family: "JetBrains Mono", Monaco, Consolas, monospace; }
    img { max-width: 100%; height: auto; }
    .docuprint-error { padding: 12px; border: 1px solid #fecdd3; background: #fff4f2; color: #9f1239; }
    @media print {
      @page { size: A4; margin: 20mm; }
      body { background: white; color: #000; max-width: none; width: auto; margin: 0 auto; }
      a { text-decoration: none; color: #000; }
      .chapter-wrapper { page-break-after: always; }
      h1, h2, h3 { page-break-after: avoid; }
      pre, img, blockquote { page-break-inside: avoid; }
      .toc-container { page-break-after: always; }
    }
  </style>
</head>
<body>
  <section class="cover">
    <h1>${siteTitle || "文档合集"}</h1>
    <p>生成日期：${today}</p>
  </section>
  ${toc}
  ${chapters}
  <script>
    (function() {
      function waitImages() {
        const promises = Array.from(document.images).map((img) => {
          if (img.complete && img.naturalWidth) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        });
        return Promise.all(promises);
      }
      window.addEventListener('load', async () => {
        await waitImages();
        setTimeout(() => window.print(), 1000);
      });
    })();
  </script>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以完成打印。");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  window.DocuPrinter = {
    buildPrintPage,
    slugify,
  };
})();
