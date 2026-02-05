"use strict";

const stage = document.getElementById("stage");
const scoreEl = document.getElementById("score");
const spawnMsEl = document.getElementById("spawnMs");

const goalRed = document.getElementById("goalRed");
const goalBlack = document.getElementById("goalBlack");

const overlay = document.getElementById("overlay");
const overReasonEl = document.getElementById("overReason");
const btnRestart = document.getElementById("btnRestart");
const btnRestart2 = document.getElementById("btnRestart2");

const finalScoreEl = document.getElementById("finalScore");
const backBtn = document.getElementById("backBtn");

// ====== ゲーム状態 ======
let score = 0;
let isGameOver = false;

let spawnTimer = null;
let difficultyTimer = null;
let moveTimer = null;

let spawnMs = 1400;          // 初期出現間隔
const minSpawnMs = 520;      // 最低間隔
let bombIdSeq = 1;

// ====== 移動設定 ======
const bombSize = 74;         // .bomb のサイズと一致させる
const moveTickMs = 16;       // 60fps相当
const wanderEveryMs = 700;   // 方向ゆらぎ頻度
const baseSpeedMin = 0.8;
const baseSpeedMax = 2.6;

// id -> { el, timeoutId, x,y,vx,vy, dragging, lastWanderAt, wanderEvery, maxSpeed }
const activeBombs = new Map();

// ====== ユーティリティ ======
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function setScore(v) {
  score = v;
  scoreEl.textContent = String(score);
}
function setSpawnMs(v) {
  spawnMs = v;
  spawnMsEl.textContent = String(Math.round(spawnMs));
}

function getStageRect() {
  return stage.getBoundingClientRect();
}

// ====== ゲームオーバー ======
function showGameOver(reason) {
  if (isGameOver) return;
  isGameOver = true;

  if (spawnTimer) clearInterval(spawnTimer);
  if (difficultyTimer) clearInterval(difficultyTimer);
  if (moveTimer) clearInterval(moveTimer);

  // 残ってるボムの爆発タイマーを停止（見た目固定）
  for (const [, info] of activeBombs) {
    clearTimeout(info.timeoutId);
    info.el.style.pointerEvents = "none";
  }

  overReasonEl.textContent = reason;
  finalScoreEl.textContent = String(score); 
  overlay.classList.remove("hidden");
}

function hideGameOver() {
  overlay.classList.add("hidden");
}

// ====== リセット ======
function resetGame() {
  // ループ停止
  if (spawnTimer) clearInterval(spawnTimer);
  if (difficultyTimer) clearInterval(difficultyTimer);
  if (moveTimer) clearInterval(moveTimer);

  // 既存ボム削除
  for (const [, info] of activeBombs) {
    clearTimeout(info.timeoutId);
    info.el.remove();
  }
  activeBombs.clear();

  bombIdSeq = 1;
  setScore(0);
  setSpawnMs(1400);
  isGameOver = false;
  hideGameOver();

  startLoops();
}

// ====== ループ開始 ======
function startLoops() {
  // スポーン
  spawnTimer = setInterval(() => {
    if (!isGameOver) spawnBomb();
  }, spawnMs);

  // 難易度：5秒ごとに出現間隔を短く
  difficultyTimer = setInterval(() => {
    if (isGameOver) return;
    const next = Math.max(minSpawnMs, spawnMs - 70);
    if (next !== spawnMs) {
      setSpawnMs(next);
      clearInterval(spawnTimer);
      spawnTimer = setInterval(() => {
        if (!isGameOver) spawnBomb();
      }, spawnMs);
    }
  }, 5000);

  // ボム移動
  moveTimer = setInterval(() => {
    if (isGameOver) return;
    moveBombs();
  }, moveTickMs);
}

// ====== 生成・配置 ======
function createBombElement(type) {
  const el = document.createElement("div");
  el.className = `bomb ${type}`;
  el.dataset.type = type;

  el.setAttribute("aria-label", type === "red" ? "red bomb" : "black bomb");

  // （互換性のため一応入れておく。CSSで非表示になる）
  const fuse = document.createElement("div");
  fuse.className = "fuse";
  fuse.innerHTML = "<i></i>";
  el.appendChild(fuse);

  return el;
}

function placeBomb(el, fromTop) {
  const rect = getStageRect();

  // ゴールに被らない中央ゾーンにスポーン
  const leftSafe = 210;
  const rightSafe = rect.width - 210;

  const x = rand(leftSafe, rightSafe - bombSize);
  const y = fromTop ? 70 : rect.height - 70 - bombSize;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function animateFuse(el, ttlMs) {
  const start = performance.now();
  let blinked = false;

  function tick(now) {
    if (isGameOver) return;

    const t = (now - start) / ttlMs;
    const remain = clamp(1 - t, 0, 1);

    // 残り1/3以下で点滅開始（1回だけclass付与）
    if (!blinked && remain <= 1 / 3) {
      el.classList.add("blink");
      blinked = true;
    }

    if (remain > 0) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function explode(el, reason) {
  el.classList.remove("blink");
  el.classList.add("explode");
  setTimeout(() => el.remove(), 450);
  showGameOver(reason);
}

function spawnBomb() {
  const type = Math.random() < 0.5 ? "red" : "black";
  const fromTop = Math.random() < 0.5;

  const el = createBombElement(type);
  const id = String(bombIdSeq++);
  el.dataset.id = id;

  stage.appendChild(el);
  placeBomb(el, fromTop);

  // ====== ボムごとの制限時間（導火線） ======
  const base = rand(1800, 4500);
  const difficultyFactor = clamp(1 - (1400 - spawnMs) / 1400 * 0.35, 0.65, 1);
  const ttlMs = Math.round(base * difficultyFactor);

  animateFuse(el, ttlMs);

  const timeoutId = setTimeout(() => {
    if (isGameOver) return;
    activeBombs.delete(id);
    explode(el, "放置してしまい、ボムが爆発しました。");
  }, ttlMs);

  // ====== 移動パラメータ ======
  const x0 = parseFloat(el.style.left);
  const y0 = parseFloat(el.style.top);

  const diffBoost = 1 + (1400 - spawnMs) / 1400 * 0.55; // 難易度で速く
  const speed = rand(baseSpeedMin, baseSpeedMax) * diffBoost;

  const ang = rand(0, Math.PI * 2);
  const vx0 = Math.cos(ang) * speed;
  const vy0 = Math.sin(ang) * speed;

  activeBombs.set(id, {
    el,
    timeoutId,
    x: x0,
    y: y0,
    vx: vx0,
    vy: vy0,
    dragging: false,
    lastWanderAt: performance.now(),
    wanderEvery: wanderEveryMs + rand(-200, 200),
    maxSpeed: 4.2 * diffBoost
  });

  enableDrag(el);
}

// ====== 当たり判定 ======
function rectsOverlap(a, b) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function checkDrop(el) {
  const bombRect = el.getBoundingClientRect();
  const redRect = goalRed.getBoundingClientRect();
  const blackRect = goalBlack.getBoundingClientRect();

  const type = el.dataset.type;

  const onRed = rectsOverlap(bombRect, redRect);
  const onBlack = rectsOverlap(bombRect, blackRect);

  if (!onRed && !onBlack) return { dropped: false };

  if (onRed && type === "red") return { dropped: true, ok: true };
  if (onBlack && type === "black") return { dropped: true, ok: true };

  return { dropped: true, ok: false };
}

function handleSuccess(el) {
  const id = el.dataset.id;
  const info = activeBombs.get(id);
  if (info) clearTimeout(info.timeoutId);
  activeBombs.delete(id);

  setScore(score + 10);
  el.classList.remove("blink");
  el.classList.add("explode");
  setTimeout(() => el.remove(), 450);
}

function handleWrong(el) {
  const id = el.dataset.id;
  const info = activeBombs.get(id);
  if (info) clearTimeout(info.timeoutId);
  activeBombs.delete(id);

  explode(el, "違う色のゴールに入れてしまい、爆発しました。");
}

// ====== ボム移動 ======
function moveBombs() {
  const stageRect = getStageRect();

  for (const [, info] of activeBombs) {
    const el = info.el;
    if (!el || info.dragging) continue;

    let x = info.x;
    let y = info.y;
    let vx = info.vx;
    let vy = info.vy;

    const now = performance.now();
    if (now - info.lastWanderAt > info.wanderEvery) {
      info.lastWanderAt = now;

      // 少しだけ方向をブレさせる
      vx += rand(-0.35, 0.35);
      vy += rand(-0.35, 0.35);

      // 速くなりすぎ防止
      const sp = Math.hypot(vx, vy);
      const maxSp = info.maxSpeed;
      if (sp > maxSp) {
        vx = (vx / sp) * maxSp;
        vy = (vy / sp) * maxSp;
      }
    }

    x += vx;
    y += vy;

    // 壁で反射
    if (x <= 0) { x = 0; vx = Math.abs(vx); }
    if (x >= stageRect.width - bombSize) { x = stageRect.width - bombSize; vx = -Math.abs(vx); }

    if (y <= 0) { y = 0; vy = Math.abs(vy); }
    if (y >= stageRect.height - bombSize) { y = stageRect.height - bombSize; vy = -Math.abs(vy); }

    info.x = x;
    info.y = y;
    info.vx = vx;
    info.vy = vy;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
}

// ====== ドラッグ操作（マウス/タッチ両対応） ======
function enableDrag(el) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function onPointerDown(e) {
    if (isGameOver) return;

    dragging = true;
    el.setPointerCapture(e.pointerId);

    const r = el.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;

    el.style.transition = "none";

    const id = el.dataset.id;
    const info = activeBombs.get(id);
    if (info) info.dragging = true;
  }

  function onPointerMove(e) {
    if (!dragging || isGameOver) return;

    const stageRect = getStageRect();
    const x = e.clientX - stageRect.left - offsetX;
    const y = e.clientY - stageRect.top - offsetY;

    const nx = clamp(x, 0, stageRect.width - bombSize);
    const ny = clamp(y, 0, stageRect.height - bombSize);

    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;

    const id = el.dataset.id;
    const info = activeBombs.get(id);
    if (info) {
      info.x = nx;
      info.y = ny;
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;

    const id = el.dataset.id;
    const info = activeBombs.get(id);
    if (info) info.dragging = false;

    const res = checkDrop(el);
    if (res.dropped) {
      if (res.ok) handleSuccess(el);
      else handleWrong(el);
    }
    // 何も入らなければそのまま（時間切れ爆発の可能性あり）
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
}

// ====== UI ======
btnRestart.addEventListener("click", resetGame);
btnRestart2.addEventListener("click", resetGame);

window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key.toLowerCase() === "r") {
    resetGame();
  }
});

// ホームへ戻る
backBtn.addEventListener("click", () => {
  window.location.href = "index.html"; 
});

// 起動
resetGame();
