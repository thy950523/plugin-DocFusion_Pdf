const startBtn = document.getElementById("startBtn");
const cancelBtn = document.getElementById("cancelBtn");
const statusText = document.getElementById("statusText");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");

let running = false;

function setRunningState() {
  running = true;
  statusText.textContent = "开始抓取...";
  progressContainer.setAttribute("aria-hidden", "false");
  updateProgress(0, 1);
  startBtn.disabled = true;
  cancelBtn.disabled = false;
}

function setIdleState() {
  running = false;
  statusText.textContent = "点击开始抓取";
  progressContainer.setAttribute("aria-hidden", "true");
  startBtn.disabled = false;
  cancelBtn.disabled = true;
}

function setReadyState() {
  running = false;
  statusText.textContent = "✅ 准备就绪，打印窗口已打开";
  startBtn.disabled = false;
  cancelBtn.disabled = true;
}

function updateProgress(current, total, note = "") {
  const percent = total ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = `${percent}%`;
  statusText.textContent = note || `正在处理 ${current}/${total} ...`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

startBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  setRunningState();
  chrome.tabs.sendMessage(tab.id, { action: "DOCUPRINT_START" }, (response) => {
    if (chrome.runtime.lastError) {
      statusText.textContent = "无法连接到页面，请刷新后重试。";
      setIdleState();
      return;
    }
    if (response?.ok) {
      statusText.textContent = "准备就绪，开始抓取...";
    }
  });
});

cancelBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: "DOCUPRINT_CANCEL" });
  statusText.textContent = "已发送取消请求";
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DOCUPRINT_PROGRESS") {
    updateProgress(message.current, message.total, message.note);
    return;
  }

  if (message?.type === "DOCUPRINT_READY") {
    setReadyState();
    return;
  }

  if (message?.type === "DOCUPRINT_ERROR") {
    statusText.textContent = message.error || "发生错误，请重试。";
    setIdleState();
  }
});

setIdleState();
