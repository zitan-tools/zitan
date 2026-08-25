(() => {
  const STORAGE_KEY = "zitan_ad_free_until";
  const SITE_URL = "https://zitan-tools.github.io/zitan/";
  const SHARE_TEXT =
    "画像圧縮・背景透過・PDF結合・画像文字認識…この辺、全部1つのサイトで無料でできるの知ってた?騙されたと思って1回使ってみて! #Zitanツール";

  const shareBtn = document.getElementById("share-x-btn");

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SITE_URL)}`;
      window.open(intentUrl, "_blank", "noopener");
      const until = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem(STORAGE_KEY, String(until));
    });
  }
})();
