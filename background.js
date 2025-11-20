// Minimal service worker to keep the extension responsive.
chrome.runtime.onInstalled.addListener(() => {
  console.log("DocuPrint extension installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DOCUPRINT_PING") {
    sendResponse({ ok: true });
  }
});
