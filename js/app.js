// カテゴリ切り替え・ツール一覧⇔個別ツールの表示切り替え

const toolDetail = document.getElementById("tool-detail");
const toolPanels = document.querySelectorAll(".tool-panel");
const categoryPanels = document.querySelectorAll(".category-panel");

document.querySelectorAll(".category-btn[data-category]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".category-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    categoryPanels.forEach((p) => p.classList.remove("active"));
    document.getElementById(`category-${btn.dataset.category}`).classList.add("active");
    toolDetail.classList.add("hidden");
  });
});

document.querySelectorAll(".tool-card").forEach((card) => {
  card.addEventListener("click", () => {
    const toolId = card.dataset.tool;
    document.querySelectorAll(".category-panel").forEach((p) => p.classList.remove("active"));
    toolDetail.classList.remove("hidden");
    toolPanels.forEach((p) => p.classList.remove("active"));
    document.getElementById(toolId).classList.add("active");
  });
});

document.getElementById("tool-back").addEventListener("click", () => {
  toolDetail.classList.add("hidden");
  document.querySelector(".category-btn.active").click();
});

const brandHome = document.getElementById("brand-home");
function goToHome() {
  document.querySelector(".category-btn[data-category]").click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
brandHome.addEventListener("click", goToHome);
brandHome.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    goToHome();
  }
});
