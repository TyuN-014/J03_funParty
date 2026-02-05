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

// ======================
// スキン設定（setting.html の保存を反映）
// ======================
const SKIN_KEY = "bombSkin";          // setting.html と一致させる
const SKIN_VER_KEY = "bombSkinVersion"; // キャッシュ対策用（保存時に Date.now() を入れる想定）

let skinVersion = localStorage.getItem(SKIN_VER_KEY) || "0";
let currentSkinName = localStorage.getItem(SKIN_KEY) || "standard";

/**
 * 画像パスはここだけ自分の構成に合わせて変更！
 * - standard: red/black それぞれ normal+blink の2枚
 * - bomb: 1枚ずつ（点滅はCSS）
 */
const SKINS = {
  standard: {
    blinkMode: "swap", // 画像切替で点滅
    red: {
      normal: "../img/tubothi_mae.png",
      blink: "../img/tubothi_yoko.png",
    },
    black: {
      normal: "../img/simantyu_mae.png",
      blink: "../img/simantyu_yoko.png",
    },
    goal:{
      red:"../img/tubothi_mae.png",
      black:"../img/simantyu_mae.png",
    }
  },
  bomb: {
    blinkMode: "css", // CSS点滅
    red: {
      normal: "../img/red_bomb.png",
      blink: null,
    },
    black: {
      normal: "../img/black_bomb.png",
      blink: null,
    },
    goal:null
  },
};

function getSkin() {
  return SKINS[currentSkinName] || SKINS.standard;
}

function applyGoalSkin() {
  const skin = getSkin();

  const redFrame = goalRed.querySelector(".frame");
  const blackFrame = goalBlack.querySelector(".frame");

  if (!redFrame || !blackFrame) return;

  if (skin.goal) {
    // スタンダード：ゴール画像に差し替え
    redFrame.textContent = "";
    blackFrame.textContent = "";

    redFrame.style.backgroundImage = `url("${imgUrl(skin.goal.red)}")`;
    blackFrame.style.backgroundImage = `url("${imgUrl(skin.goal.black)}")`;

    redFrame.style.backgroundRepeat = "no-repeat";
    redFrame.style.backgroundPosition = "center";
    redFrame.style.backgroundSize = "contain";

    blackFrame.style.backgroundRepeat = "no-repeat";
    blackFrame.style.backgroundPosition = "center";
    blackFrame.style.backgroundSize = "contain";
  } else {
    // 爆弾ver：文字表示に戻す
    redFrame.style.backgroundImage = "";
    blackFrame.style.backgroundImage = "";
    redFrame.textContent = "RED GOAL";
    blackFrame.textContent = "BLACK GOAL";
  }
}

// 画像キャッシュ対策（保存ごとに version を変える）
function imgUrl(path) {
  return `${path}?v=${encodeURIComponent(skinVersion)}`;
}

// ======================
// ゲーム状態
// ======================
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

// id -> { el, timeoutId, x,y,vx,vy, dragging, lastWanderAt, wanderEvery, maxSpeed, blinkIntervalId }
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

// ======================
// 点滅停止（swap / css 両対応）
// ======================
function stopBlink(el) {
  // CSS点滅停止
  el.classList.remove("blink");

  // swap点滅停止
  const id = el.dataset.id;
  const info = activeBombs.get(id);
  if (info?.blinkIntervalId) {
    clearInterval(info.blinkIntervalId);
    info.blinkIntervalId = null;
  }
}

// 爆発の文言
function makeExplodeReason(el, situation) {
  const type = el.dataset.type; // "red" | "black"

  // ===== スタンダード =====
  if (currentSkinName === "standard") {
    if (situation === "timeout") {
      return type === "red"
        ? "坪内先生が爆発しました。放置しやがって"
        : "志摩先生が爆発しました。放置…しましたね";
    }

    if (situation === "wrong") {
      return type === "red"
        ? "坪内先生が爆発しました。違う場所じゃーい"
        : "志摩先生が爆発しました。ここじゃないですよー！";
    }
  }

  // ===== 爆弾ver =====
  if (currentSkinName === "bomb") {
    if (situation === "timeout") {
      return type === "red"
        ? "赤ボムが爆発しました。放置しすぎです。"
        : "黒ボムが爆発しました。放置しすぎです。";
    }

    if (situation === "wrong") {
      return type === "red"
        ? "赤ボムが爆発しました。違う場所に入りました。"
        : "黒ボムが爆発しました。違う場所に入りました。";
    }
  }

  return "爆発しました。";
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
    // swap点滅も止める
    if (info.blinkIntervalId) {
      clearInterval(info.blinkIntervalId);
      info.blinkIntervalId = null;
    }
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
    if (info.blinkIntervalId) clearInterval(info.blinkIntervalId);
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

  // 画像表示（img）
  const img = document.createElement("img");
  img.alt = type === "red" ? "red bomb" : "black bomb";
  img.draggable = false;

  const skin = getSkin();
  img.src = imgUrl(skin[type].normal);

  el.appendChild(img);

  // fuse DOMは不要（タイマー表示しない）なので作らない
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

/**
 * 残り時間が1/3になったら点滅
 * - standard: 画像2枚の切替（swap）
 * - bomb: CSS点滅（.blink）
 */
function animateFuse(el, ttlMs) {
  const start = performance.now();
  let startedBlink = false;

  function startBlink() {
    if (startedBlink) return;
    startedBlink = true;

    const type = el.dataset.type;
    const img = el.querySelector("img");
    const skin = getSkin();

    if (skin.blinkMode === "swap") {
      const a = imgUrl(skin[type].normal);
      const b = imgUrl(skin[type].blink);

      // 安全策：blink画像が未設定ならCSSにフォールバック
      if (!skin[type].blink) {
        el.classList.add("blink");
        return;
      }

      let on = false;
      const intervalId = setInterval(() => {
        if (isGameOver || !el.isConnected) {
          clearInterval(intervalId);
          return;
        }
        on = !on;
        img.src = on ? b : a;
      }, 120);

      const id = el.dataset.id;
      const info = activeBombs.get(id);
      if (info) info.blinkIntervalId = intervalId;
    } else {
      el.classList.add("blink");
    }
  }

  function tick(now) {
    if (isGameOver) return;

    const t = (now - start) / ttlMs;
    const remain = clamp(1 - t, 0, 1);

    if (!startedBlink && remain <= 1 / 3) startBlink();
    if (remain > 0) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function explode(el, reason) {
  stopBlink(el);
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

  // ====== ボムごとの制限時間 ======
  const base = rand(1800, 4500);
  const difficultyFactor = clamp(1 - (1400 - spawnMs) / 1400 * 0.35, 0.65, 1);
  const ttlMs = Math.round(base * difficultyFactor);

  // activeBombs に先に登録（animateFuseのswap点滅で intervalId を入れられるように）
  const x0 = parseFloat(el.style.left);
  const y0 = parseFloat(el.style.top);

  const diffBoost = 1 + (1400 - spawnMs) / 1400 * 0.55;
  const speed = rand(baseSpeedMin, baseSpeedMax) * diffBoost;

  const ang = rand(0, Math.PI * 2);
  const vx0 = Math.cos(ang) * speed;
  const vy0 = Math.sin(ang) * speed;

  // 先登録
  activeBombs.set(id, {
    el,
    timeoutId: null,
    x: x0,
    y: y0,
    vx: vx0,
    vy: vy0,
    dragging: false,
    lastWanderAt: performance.now(),
    wanderEvery: wanderEveryMs + rand(-200, 200),
    maxSpeed: 4.2 * diffBoost,
    blinkIntervalId: null,
  });

  animateFuse(el, ttlMs);

  const timeoutId = setTimeout(() => {
  if (isGameOver) return;
  activeBombs.delete(id);
  explode(el, makeExplodeReason(el, "timeout"));
}, ttlMs);


  // timeoutId を反映
  const info = activeBombs.get(id);
  if (info) info.timeoutId = timeoutId;

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
  stopBlink(el);

  const id = el.dataset.id;
  const info = activeBombs.get(id);
  if (info) clearTimeout(info.timeoutId);
  activeBombs.delete(id);

  setScore(score + 10);
  el.classList.add("explode");
  setTimeout(() => el.remove(), 450);
}

function handleWrong(el) {
  stopBlink(el);

  const id = el.dataset.id;
  const info = activeBombs.get(id);
  if (info) clearTimeout(info.timeoutId);
  activeBombs.delete(id);

  explode(el, makeExplodeReason(el, "wrong"));
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

      vx += rand(-0.35, 0.35);
      vy += rand(-0.35, 0.35);

      const sp = Math.hypot(vx, vy);
      const maxSp = info.maxSpeed;
      if (sp > maxSp) {
        vx = (vx / sp) * maxSp;
        vy = (vy / sp) * maxSp;
      }
    }

    x += vx;
    y += vy;

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

// （任意）別タブで設定を変えたら即反映したい場合
window.addEventListener("storage", (e) => {
  if (e.key === SKIN_KEY || e.key === SKIN_VER_KEY) {
    currentSkinName = localStorage.getItem(SKIN_KEY) || "standard";
    skinVersion = localStorage.getItem(SKIN_VER_KEY) || "0";

    // 既存ボムの画像も更新
    const skin = getSkin();
    for (const [, info] of activeBombs) {
      stopBlink(info.el);
      const type = info.el.dataset.type;
      const img = info.el.querySelector("img");
      if (img) img.src = imgUrl(skin[type].normal);
    }

    applyGoalSkin();
  }
});

applyGoalSkin();

// 起動
resetGame();