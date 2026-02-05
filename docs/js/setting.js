const KEY = "bombSkin";
const VER = "bombSkinVersion";

const radios = document.querySelectorAll('input[name="mode"]');
const saveLink = document.querySelector(".save-btn");

// 復元
const saved = localStorage.getItem(KEY) || "standard";
radios.forEach(r => (r.checked = (r.value === saved)));

saveLink.addEventListener("click", (e) => {
  e.preventDefault(); // 遷移しない

  const selected = [...radios].find(r => r.checked)?.value || "standard";
  localStorage.setItem(KEY, selected);

  // ★画像キャッシュ対策：保存するたびに更新番号を変える
  localStorage.setItem(VER, String(Date.now()));

  // UIフィードバック（任意）
  saveLink.textContent = "保存しました";
  setTimeout(() => (saveLink.textContent = "保存"), 1200);
});