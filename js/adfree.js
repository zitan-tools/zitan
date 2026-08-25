(() => {
  const STORAGE_KEY = "zitan_ad_free_until";
  const SITE_URL = "https://zitan-tools.github.io/zitan/";
  const SHARE_TEXT =
    "無料で使える神ツール集『Zitan』を見つけた!画像・PDF・音声編集まで、ぜんぶブラウザだけで完結。ファイルが外部に送信されないから安心して使えます。 #Zitanツール";

  const shareBtn = document.getElementById("share-x-btn");
  const statusEl = document.getElementById("ad-free-status");

  function formatRemaining(ms) {
    const totalMin = Math.max(0, Math.ceil(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `あと${h}時間${m}分`;
  }

  function updateStatus() {
    const until = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    const remaining = until - Date.now();
    if (!statusEl) return;
    if (until && remaining > 0) {
      statusEl.textContent = `🎉 シェアありがとうございます!広告オフ中(${formatRemaining(remaining)})`;
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SITE_URL)}`;
      window.open(intentUrl, "_blank", "noopener");
      const until = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem(STORAGE_KEY, String(until));
      updateStatus();
    });
  }

  updateStatus();
  setInterval(updateStatus, 60000);
})();
