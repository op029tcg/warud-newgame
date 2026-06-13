/* =========================================================
   TRION ARENA — ワールドトリガー風 見下ろし型アリーナ戦闘
   ボーダー隊員としてトリガーを駆使し近界民を殲滅するランク戦シミュレーター。
   Vanilla JS + Canvas2D。ライブラリ依存なし。
   ========================================================= */
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 900
  const H = canvas.height;  // 600

  // ---- DOM ----
  const hud = document.getElementById("hud");
  const hpBar = document.getElementById("hp-bar");
  const trionBar = document.getElementById("trion-bar");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const rankEl = document.getElementById("rank");
  const slotsEl = document.getElementById("trigger-slots");
  const titleScreen = document.getElementById("title-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const finalScoreEl = document.getElementById("final-score");
  const finalWaveEl = document.getElementById("final-wave");
  const finalRankEl = document.getElementById("final-rank");
  const newRecordEl = document.getElementById("new-record");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");

  // ---- 定数 ----
  const HISCORE_KEY = "trionarena.hiscore";
  const STATE = { TITLE: 0, PLAY: 1, OVER: 2 };
  const TAU = Math.PI * 2;

  // ランク閾値
  const RANKS = [
    { name: "S", min: 18000 },
    { name: "A", min: 8000 },
    { name: "B", min: 3000 },
    { name: "C", min: 0 },
  ];
  function rankFor(score) {
    for (const r of RANKS) if (score >= r.min) return r.name;
    return "C";
  }

  // ---- ユーティリティ ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const len = (x, y) => Math.hypot(x, y);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  // 角度差（-PI..PI）
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  // =========================================================
  //  トリガー定義
  // =========================================================
  const TRIGGERS = [
    { id: "kogetsu",  key: "1", name: "弧月",       pos: "アタッカー", color: "#7fd0ff" },
    { id: "asteroid", key: "2", name: "アステロイド", pos: "ガンナー",   color: "#9affc8" },
    { id: "ibis",     key: "3", name: "アイビス",     pos: "スナイパー", color: "#ffcf6f" },
    { id: "meteora",  key: "4", name: "メテオラ",     pos: "ガンナー",   color: "#ff9d6f" },
  ];

  // =========================================================
  //  障害物（市街地のビル＝遮蔽）
  // =========================================================
  const OBSTACLES = [
    { x: 175, y: 110, w: 95, h: 95 },
    { x: 630, y: 110, w: 95, h: 95 },
    { x: 175, y: 395, w: 95, h: 95 },
    { x: 630, y: 395, w: 95, h: 95 },
    { x: 402, y: 252, w: 96, h: 96 },
  ];

  function circleHitsRect(cx, cy, r, rc) {
    const nx = clamp(cx, rc.x, rc.x + rc.w);
    const ny = clamp(cy, rc.y, rc.y + rc.h);
    return dist2(cx, cy, nx, ny) < r * r;
  }
  function circleHitsAnyObstacle(cx, cy, r) {
    for (const o of OBSTACLES) if (circleHitsRect(cx, cy, r, o)) return true;
    return false;
  }
  function pointInAnyObstacle(px, py) {
    for (const o of OBSTACLES)
      if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) return true;
    return false;
  }

  // =========================================================
  //  サウンド（WebAudioで軽量に効果音生成）
  // =========================================================
  const Sound = (() => {
    let ac = null;
    const ensure = () => {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { ac = null; }
      }
      if (ac && ac.state === "suspended") ac.resume();
      return ac;
    };
    const tone = (freq, dur, type = "square", gain = 0.05, slideTo = null) => {
      const a = ensure();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(a.destination);
      const t = a.currentTime;
      o.start(t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur);
    };
    return {
      resume: ensure,
      slash: () => tone(680, 0.12, "sawtooth", 0.05, 240),
      shot: () => tone(900, 0.05, "square", 0.022, 500),
      snipe: () => tone(1400, 0.25, "sawtooth", 0.07, 200),
      charge: () => tone(300, 0.08, "sine", 0.02, 600),
      meteor: () => tone(180, 0.4, "square", 0.06, 60),
      hit: () => tone(240, 0.08, "square", 0.035, 120),
      kill: () => tone(140, 0.3, "sawtooth", 0.08, 50),
      shield: () => tone(520, 0.1, "sine", 0.05),
      dash: () => tone(420, 0.12, "triangle", 0.05, 760),
      enemyShot: () => tone(330, 0.1, "square", 0.03, 160),
      hurt: () => tone(200, 0.2, "sawtooth", 0.07, 80),
      bailout: () => { tone(400, 0.5, "sawtooth", 0.1, 90); setTimeout(() => tone(120, 0.6, "sawtooth", 0.1, 40), 140); },
      wave: () => { tone(523, 0.12, "sine", 0.06); setTimeout(() => tone(784, 0.18, "sine", 0.06), 110); },
    };
  })();

  // =========================================================
  //  入力
  // =========================================================
  const input = {
    aimX: W / 2, aimY: H / 2 - 100,
    keys: new Set(),
    fireDown: false,
    firePressed: false,
    fireReleased: false,
    shield: false,
    dashPressed: false,
    switchTo: -1,
  };

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height),
    };
  }
  canvas.addEventListener("pointermove", (e) => {
    const p = canvasPos(e);
    input.aimX = p.x; input.aimY = p.y;
  });
  canvas.addEventListener("pointerdown", (e) => {
    Sound.resume();
    const p = canvasPos(e);
    input.aimX = p.x; input.aimY = p.y;
    if (e.button === 2) { input.shield = true; }
    else { input.fireDown = true; input.firePressed = true; }
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 2) input.shield = false;
    else if (input.fireDown) { input.fireDown = false; input.fireReleased = true; }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    input.keys.add(k);
    if (k === " ") input.dashPressed = true;
    if (k === "shift") input.shield = true;
    if (k >= "1" && k <= "4") input.switchTo = parseInt(k, 10) - 1;
    if ((k === "enter" || k === " ") && game.state !== STATE.PLAY) {
      // タイトル/オーバー画面で開始
    }
    Sound.resume();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    input.keys.delete(k);
    if (k === "shift") input.shield = false;
  });

  // =========================================================
  //  エンティティ配列
  // =========================================================
  let bullets = [];       // 自機弾
  let enemyBullets = [];
  let enemies = [];
  let particles = [];
  let swings = [];        // 近接斬撃エフェクト＆当たり
  let spawnMarks = [];    // 出現予告
  let floaters = [];      // ダメージ/スコア表示

  // =========================================================
  //  プレイヤー
  // =========================================================
  const player = {
    x: W / 2, y: H / 2, r: 13,
    angle: -Math.PI / 2,
    speed: 3.4,
    hp: 100, maxHp: 100,
    trion: 1000, maxTrion: 1000, trionRegen: 1.6,
    trigger: 0,
    fireCd: 0,
    charge: 0, charging: false,
    dashCd: 0, dashTime: 0, dashVx: 0, dashVy: 0,
    invuln: 0,
    shieldActive: false,
    hitFlash: 0,
    alive: true,
  };

  function resetPlayer() {
    player.x = W / 2; player.y = H / 2;
    player.angle = -Math.PI / 2;
    player.hp = player.maxHp;
    player.trion = player.maxTrion;
    player.trigger = 0;
    player.fireCd = 0; player.charge = 0; player.charging = false;
    player.dashCd = 0; player.dashTime = 0;
    player.invuln = 60; player.shieldActive = false; player.hitFlash = 0;
    player.alive = true;
  }

  // =========================================================
  //  ゲーム状態
  // =========================================================
  const game = {
    state: STATE.TITLE,
    score: 0,
    hiscore: parseInt(localStorage.getItem(HISCORE_KEY) || "0", 10) || 0,
    wave: 0,
    spawnQueue: [],
    spawnTimer: 0,
    spawnInterval: 38,
    intermission: 0,
    banner: "", bannerTimer: 0,
    shake: 0,
    frame: 0,
  };

  function startGame() {
    bullets = []; enemyBullets = []; enemies = [];
    particles = []; swings = []; spawnMarks = []; floaters = [];
    resetPlayer();
    game.state = STATE.PLAY;
    game.score = 0; game.wave = 0;
    game.spawnQueue = []; game.spawnTimer = 0; game.spawnInterval = 38;
    game.intermission = 60; game.banner = ""; game.bannerTimer = 0;
    game.shake = 0; game.frame = 0;
    titleScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    buildSlots();
    syncHud();
    Sound.resume();
  }

  function bailOut() {
    game.state = STATE.OVER;
    Sound.bailout();
    const rank = rankFor(game.score);
    const isRecord = game.score > game.hiscore;
    if (isRecord) {
      game.hiscore = game.score;
      localStorage.setItem(HISCORE_KEY, String(game.hiscore));
    }
    finalScoreEl.textContent = game.score.toLocaleString();
    finalWaveEl.textContent = game.wave;
    finalRankEl.textContent = rank;
    newRecordEl.classList.toggle("hidden", !isRecord);
    gameoverScreen.classList.remove("hidden");
    hud.classList.add("hidden");
  }

  // =========================================================
  //  ウェーブ管理
  // =========================================================
  function buildWave(n) {
    const list = [];
    if (n % 5 === 0) {
      // ボスウェーブ
      list.push("boss");
      for (let i = 0; i < 3; i++) list.push("marmod");
      for (let i = 0; i < 2; i++) list.push("bamster");
    } else {
      const marmod = 3 + Math.floor(n / 2);
      const bamster = Math.floor(n / 2);
      const rabbit = Math.floor((n - 1) / 3);
      for (let i = 0; i < marmod; i++) list.push("marmod");
      for (let i = 0; i < bamster; i++) list.push("bamster");
      for (let i = 0; i < rabbit; i++) list.push("rabbit");
    }
    // シャッフル
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function startWave() {
    game.wave++;
    game.spawnQueue = buildWave(game.wave);
    game.spawnInterval = Math.max(18, 40 - game.wave);
    game.spawnTimer = 20;
    game.banner = game.wave % 5 === 0 ? `WAVE ${game.wave}  ―  ボス出現` : `WAVE ${game.wave}`;
    game.bannerTimer = 120;
    Sound.wave();
  }

  function edgeSpawnPos() {
    const side = Math.floor(rand(0, 4));
    const m = 30;
    if (side === 0) return { x: rand(m, W - m), y: -20 };
    if (side === 1) return { x: W + 20, y: rand(m, H - m) };
    if (side === 2) return { x: rand(m, W - m), y: H + 20 };
    return { x: -20, y: rand(m, H - m) };
  }

  function spawnEnemy(type) {
    const p = edgeSpawnPos();
    const lv = game.wave;
    const base = {
      x: p.x, y: p.y, vx: 0, vy: 0, type,
      t: Math.floor(rand(0, 60)), fireT: rand(50, 110),
      knock: 0, hitFlash: 0, telegraph: 0,
    };
    if (type === "marmod") {
      Object.assign(base, { r: 13, hp: 6 + lv, maxHp: 6 + lv, speed: 1.9 + lv * 0.04, score: 100, dmg: 8 });
    } else if (type === "bamster") {
      Object.assign(base, { r: 16, hp: 12 + lv * 1.5, maxHp: 12 + lv * 1.5, speed: 1.2, score: 160, dmg: 10, range: 240 });
    } else if (type === "rabbit") {
      Object.assign(base, { r: 24, hp: 40 + lv * 4, maxHp: 40 + lv * 4, speed: 0.95, score: 420, dmg: 20 });
    } else if (type === "boss") {
      Object.assign(base, { r: 42, hp: 380 + lv * 40, maxHp: 380 + lv * 40, speed: 0.8, score: 2500, dmg: 26, phase: 0, atkT: 120 });
    }
    enemies.push(base);
  }

  // =========================================================
  //  エフェクト
  // =========================================================
  function burst(x, y, color, count = 12, spd = 3.5, life = 32) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(0.4, spd);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), maxLife: life, color, r: rand(1.5, 3.5) });
    }
  }
  function floatText(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 46 });
  }

  // =========================================================
  //  ダメージ適用（敵へ）
  // =========================================================
  function damageEnemy(e, dmg, hx, hy, fromColor) {
    e.hp -= dmg;
    e.hitFlash = 6;
    burst(hx, hy, fromColor || "#bfefff", 4, 2.2, 20);
    Sound.hit();
    if (e.hp <= 0) {
      killEnemy(e);
    }
  }
  function killEnemy(e) {
    e.dead = true;
    const big = e.type === "boss";
    burst(e.x, e.y, e.type === "boss" ? "#ff7b8a" : "#ff4d5e", big ? 50 : 18, big ? 7 : 4, big ? 50 : 34);
    Sound.kill();
    game.score += e.score;
    game.shake = Math.max(game.shake, big ? 16 : e.type === "rabbit" ? 6 : 2);
    floatText(e.x, e.y - e.r, "+" + e.score, "#ffd84d");
  }

  // =========================================================
  //  プレイヤー被弾
  // =========================================================
  function hurtPlayer(dmg, srcX, srcY) {
    if (!player.alive || player.invuln > 0) return;
    // シールド判定：正面からの攻撃をブロック
    if (player.shieldActive && player.trion > 0) {
      const toSrc = Math.atan2(srcY - player.y, srcX - player.x);
      if (Math.abs(angDiff(toSrc, player.angle)) < 1.0) {
        player.trion = Math.max(0, player.trion - dmg * 4);
        burst(player.x + Math.cos(toSrc) * player.r, player.y + Math.sin(toSrc) * player.r, "#7fd0ff", 6, 3, 18);
        Sound.shield();
        return; // 無効化
      }
    }
    player.hp -= dmg;
    player.invuln = 40;
    player.hitFlash = 10;
    player.charging = false; player.charge = 0;
    Sound.hurt();
    game.shake = Math.max(game.shake, 8);
    burst(player.x, player.y, "#ff6db1", 14, 4, 30);
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      burst(player.x, player.y, "#9affff", 40, 6, 50);
      setTimeout(bailOut, 800);
    }
  }

  // =========================================================
  //  トリガー発動
  // =========================================================
  function spawnBullet(opts) { bullets.push(Object.assign({ r: 4, dmg: 1, pierce: false, life: 120, hits: null }, opts)); }

  function fireKogetsu() {
    if (player.fireCd > 0) return;
    const cost = 28;
    if (player.trion < cost) return;
    player.trion -= cost;
    player.fireCd = 20;
    swings.push({ x: player.x, y: player.y, angle: player.angle, life: 10, maxLife: 10, range: 64, arc: 1.1, hits: new Set() });
    Sound.slash();
  }

  function fireAsteroid() {
    if (player.fireCd > 0) return;
    const cost = 10;
    if (player.trion < cost) return;
    player.trion -= cost;
    player.fireCd = 6;
    const spread = rand(-0.06, 0.06);
    const a = player.angle + spread;
    const sp = 11;
    spawnBullet({ x: player.x + Math.cos(player.angle) * player.r, y: player.y + Math.sin(player.angle) * player.r,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 4, dmg: 4, color: "#9affc8", life: 70 });
    Sound.shot();
  }

  function releaseIbis() {
    const c = player.charge; // 0..1
    player.charging = false; player.charge = 0;
    const cost = 40 + Math.floor(c * 80);
    if (player.trion < 30) return;
    player.trion = Math.max(0, player.trion - cost);
    const dmg = 18 + c * 60;
    const sp = 18;
    const a = player.angle;
    spawnBullet({ x: player.x + Math.cos(a) * player.r, y: player.y + Math.sin(a) * player.r,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 5 + c * 4, dmg, color: "#ffcf6f", life: 90, pierce: true, hits: new Set(), trail: true });
    player.fireCd = 24;
    Sound.snipe();
    game.shake = Math.max(game.shake, 4 + c * 4);
  }

  function fireMeteora() {
    if (player.fireCd > 0) return;
    const cost = 70;
    if (player.trion < cost) return;
    player.trion -= cost;
    player.fireCd = 40;
    const a = player.angle;
    const sp = 7;
    spawnBullet({ x: player.x + Math.cos(a) * player.r, y: player.y + Math.sin(a) * player.r,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 7, dmg: 8, color: "#ff9d6f", life: 80, explode: 70 });
    Sound.meteor();
  }

  function explodeMeteora(x, y, dmg) {
    const radius = 88;
    burst(x, y, "#ffb27f", 30, 6, 40);
    Sound.kill();
    game.shake = Math.max(game.shake, 8);
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist2(e.x, e.y, x, y) < (radius + e.r) ** 2) {
        damageEnemy(e, dmg, e.x, e.y, "#ffb27f");
      }
    }
    // 衝撃波リング
    particles.push({ ring: true, x, y, r: 6, maxR: radius, life: 18, maxLife: 18, color: "#ffd2a8" });
  }

  function doDash() {
    if (player.dashCd > 0 || player.dashTime > 0) return;
    const cost = 60;
    if (player.trion < cost) return;
    // 移動方向、無ければ照準方向
    let dx = 0, dy = 0;
    const k = input.keys;
    if (k.has("arrowleft") || k.has("a")) dx -= 1;
    if (k.has("arrowright") || k.has("d")) dx += 1;
    if (k.has("arrowup") || k.has("w")) dy -= 1;
    if (k.has("arrowdown") || k.has("s")) dy += 1;
    if (dx === 0 && dy === 0) { dx = Math.cos(player.angle); dy = Math.sin(player.angle); }
    const l = len(dx, dy) || 1;
    player.trion -= cost;
    player.dashVx = (dx / l) * 9.5;
    player.dashVy = (dy / l) * 9.5;
    player.dashTime = 9;
    player.dashCd = 40;
    player.invuln = Math.max(player.invuln, 12);
    Sound.dash();
    burst(player.x, player.y, "#7fd0ff", 10, 3, 22);
  }

  // =========================================================
  //  更新
  // =========================================================
  function update() {
    game.frame++;
    if (game.state !== STATE.PLAY) { input.firePressed = false; input.fireReleased = false; input.dashPressed = false; input.switchTo = -1; return; }

    // --- トリガー切替 ---
    if (input.switchTo >= 0 && input.switchTo < TRIGGERS.length) {
      if (input.switchTo !== player.trigger) {
        player.trigger = input.switchTo;
        player.charging = false; player.charge = 0; player.fireCd = 4;
        updateSlots();
      }
      input.switchTo = -1;
    }

    if (player.alive) updatePlayer();

    // --- バナー/インターミッション ---
    if (game.bannerTimer > 0) game.bannerTimer--;
    if (game.shake > 0.4) game.shake *= 0.86; else game.shake = 0;

    // --- ウェーブ進行 ---
    if (game.intermission > 0) {
      game.intermission--;
      if (game.intermission === 0) startWave();
    } else {
      // スポーンキュー消化
      if (game.spawnQueue.length > 0) {
        game.spawnTimer--;
        if (game.spawnTimer <= 0) {
          const type = game.spawnQueue.shift();
          spawnEnemy(type);
          game.spawnTimer = game.spawnInterval;
        }
      } else if (enemies.length === 0) {
        // ウェーブクリア
        game.banner = "WAVE CLEAR";
        game.bannerTimer = 90;
        game.intermission = 130;
        // クリアボーナス & 小回復
        game.score += 200 + game.wave * 50;
        player.hp = Math.min(player.maxHp, player.hp + 12);
      }
    }

    updateEnemies();
    updateBullets();
    updateSwings();
    updateParticles();

    // エッジフラグ消化
    input.firePressed = false;
    input.fireReleased = false;
    input.dashPressed = false;

    syncHud();
  }

  function updatePlayer() {
    // 照準
    player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);

    // シールド
    player.shieldActive = input.shield && player.trion > 0;
    if (player.shieldActive) player.trion = Math.max(0, player.trion - 1.2);

    // 移動
    let mvx = 0, mvy = 0;
    if (player.dashTime > 0) {
      mvx = player.dashVx; mvy = player.dashVy;
      player.dashTime--;
    } else {
      let dx = 0, dy = 0;
      const k = input.keys;
      if (k.has("arrowleft") || k.has("a")) dx -= 1;
      if (k.has("arrowright") || k.has("d")) dx += 1;
      if (k.has("arrowup") || k.has("w")) dy -= 1;
      if (k.has("arrowdown") || k.has("s")) dy += 1;
      const l = len(dx, dy);
      if (l > 0) {
        let sp = player.speed;
        if (player.shieldActive) sp *= 0.55;
        if (player.charging) sp *= 0.5;
        mvx = (dx / l) * sp; mvy = (dy / l) * sp;
      }
    }
    // 障害物・壁との衝突（軸分離）
    let nx = player.x + mvx;
    if (!circleHitsAnyObstacle(nx, player.y, player.r)) player.x = nx;
    let ny = player.y + mvy;
    if (!circleHitsAnyObstacle(player.x, ny, player.r)) player.y = ny;
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);

    // ダッシュ
    if (input.dashPressed) doDash();
    if (player.dashCd > 0) player.dashCd--;

    // 攻撃
    const trg = TRIGGERS[player.trigger].id;
    if (player.fireCd > 0) player.fireCd--;

    if (trg === "ibis") {
      // チャージ式
      if (input.fireDown && !player.shieldActive) {
        if (!player.charging) { player.charging = true; player.charge = 0; }
        if (player.charge < 1) {
          player.charge = Math.min(1, player.charge + 1 / 55);
          if (game.frame % 8 === 0) Sound.charge();
        }
      }
      if (input.fireReleased && player.charging) releaseIbis();
    } else {
      player.charging = false; player.charge = 0;
      if (input.fireDown && !player.shieldActive) {
        if (trg === "kogetsu") fireKogetsu();
        else if (trg === "asteroid") fireAsteroid();
        else if (trg === "meteora") fireMeteora();
      }
    }

    // トリオン回復（シールド/チャージ中は控えめ）
    if (!player.shieldActive) {
      const regen = player.charging ? player.trionRegen * 0.3 : player.trionRegen;
      player.trion = Math.min(player.maxTrion, player.trion + regen);
    }

    if (player.invuln > 0) player.invuln--;
    if (player.hitFlash > 0) player.hitFlash--;
  }

  function moveEnemyWithCollision(e, mvx, mvy) {
    let nx = e.x + mvx;
    if (!circleHitsAnyObstacle(nx, e.y, e.r)) e.x = nx;
    else e.x += mvx * 0.0; // ブロック
    let ny = e.y + mvy;
    if (!circleHitsAnyObstacle(e.x, ny, e.r)) e.y = ny;
    e.x = clamp(e.x, -40, W + 40);
    e.y = clamp(e.y, -40, H + 40);
  }

  function updateEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) { enemies.splice(i, 1); continue; }
      e.t++;
      if (e.hitFlash > 0) e.hitFlash--;
      const toP = Math.atan2(player.y - e.y, player.x - e.x);
      const dP = len(player.x - e.x, player.y - e.y);

      // ノックバック減衰
      if (e.knock > 0) {
        moveEnemyWithCollision(e, Math.cos(e.knockA) * e.knock, Math.sin(e.knockA) * e.knock);
        e.knock *= 0.8;
        if (e.knock < 0.3) e.knock = 0;
      }

      if (e.type === "marmod") {
        moveEnemyWithCollision(e, Math.cos(toP) * e.speed, Math.sin(toP) * e.speed);
        if (player.alive && dP < e.r + player.r + 2) {
          hurtPlayer(e.dmg, e.x, e.y);
          e.knock = 6; e.knockA = toP + Math.PI;
        }
      } else if (e.type === "bamster") {
        // 一定距離を保ちつつ射撃
        let move = 0;
        if (dP > e.range + 30) move = e.speed;
        else if (dP < e.range - 60) move = -e.speed;
        moveEnemyWithCollision(e, Math.cos(toP) * move, Math.sin(toP) * move);
        e.fireT--;
        if (e.fireT <= 0 && dP < e.range + 80 && e.y > -10 && e.y < H + 10) {
          enemyFire(e.x, e.y, toP, 3.4, 10);
          e.fireT = rand(70, 110);
        }
      } else if (e.type === "rabbit") {
        moveEnemyWithCollision(e, Math.cos(toP) * e.speed, Math.sin(toP) * e.speed);
        if (player.alive && dP < e.r + player.r + 4) {
          if (e.telegraph <= 0) e.telegraph = 18;
        }
        if (e.telegraph > 0) {
          e.telegraph--;
          if (e.telegraph === 0 && dP < e.r + player.r + 30) {
            hurtPlayer(e.dmg, e.x, e.y);
            game.shake = Math.max(game.shake, 6);
          }
        }
      } else if (e.type === "boss") {
        updateBoss(e, toP, dP);
      }

      // 自機弾との衝突
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (b.hits && b.hits.has(e)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
          if (b.explode) {
            explodeMeteora(b.x, b.y, b.explode);
            bullets.splice(j, 1);
            continue;
          }
          damageEnemy(e, b.dmg, b.x, b.y, b.color);
          if (e.type !== "boss") { e.knock = Math.min(8, b.dmg * 0.4); e.knockA = Math.atan2(b.vy, b.vx); }
          if (b.pierce) { if (b.hits) b.hits.add(e); }
          else bullets.splice(j, 1);
          if (e.dead) break;
        }
      }
    }
  }

  function updateBoss(e, toP, dP) {
    e.atkT--;
    if (e.atkT <= 0) {
      // 攻撃選択
      const mode = Math.floor(rand(0, 3));
      if (mode === 0) {
        // 放射状弾幕
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a = (TAU / n) * i + rand(-0.05, 0.05);
          enemyFire(e.x, e.y, a, 3.2, 12);
        }
        Sound.meteor();
        e.atkT = 110;
      } else if (mode === 1) {
        // 3連射（自機狙い）
        e.burst = 3; e.burstA = toP; e.atkT = 90;
      } else {
        // 突進
        e.charging = true; e.chargeA = toP; e.chargeT = 36; e.atkT = 130;
      }
    }
    if (e.burst > 0 && game.frame % 8 === 0) {
      enemyFire(e.x, e.y, toP, 4, 12);
      e.burst--;
    }
    if (e.charging) {
      e.chargeT--;
      moveEnemyWithCollision(e, Math.cos(e.chargeA) * 5.2, Math.sin(e.chargeA) * 5.2);
      if (e.chargeT <= 0) e.charging = false;
    } else {
      moveEnemyWithCollision(e, Math.cos(toP) * e.speed, Math.sin(toP) * e.speed);
    }
    if (player.alive && dP < e.r + player.r + 2) {
      hurtPlayer(e.dmg, e.x, e.y);
    }
  }

  function enemyFire(x, y, angle, sp, dmg) {
    enemyBullets.push({ x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp, r: 6, dmg, life: 180 });
    Sound.enemyShot();
  }

  function updateBullets() {
    // 自機弾
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.trail && game.frame % 2 === 0) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 10, maxLife: 10, color: b.color, r: b.r * 0.6 });
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
        if (b.explode) explodeMeteora(b.x, b.y, b.explode);
        bullets.splice(i, 1); continue;
      }
      if (pointInAnyObstacle(b.x, b.y)) {
        if (b.explode) explodeMeteora(b.x, b.y, b.explode);
        else burst(b.x, b.y, b.color, 3, 1.5, 12);
        if (!b.pierce) { bullets.splice(i, 1); continue; }
      }
    }
    // 敵弾
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) { enemyBullets.splice(i, 1); continue; }
      if (pointInAnyObstacle(b.x, b.y)) { burst(b.x, b.y, "#ff8a8a", 3, 1.5, 12); enemyBullets.splice(i, 1); continue; }
      if (player.alive && dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) ** 2) {
        const before = player.hp;
        hurtPlayer(b.dmg, b.x, b.y);
        // シールドブロックでも弾は消す
        enemyBullets.splice(i, 1);
      }
    }
  }

  function updateSwings() {
    for (let i = swings.length - 1; i >= 0; i--) {
      const s = swings[i];
      s.life--;
      // 追従（プレイヤー位置に）
      s.x = player.x; s.y = player.y;
      // 当たり判定（発生中の最初の数フレーム）
      if (s.life > s.maxLife - 7) {
        for (const e of enemies) {
          if (e.dead || s.hits.has(e)) continue;
          const d = len(e.x - s.x, e.y - s.y);
          if (d < s.range + e.r) {
            const a = Math.atan2(e.y - s.y, e.x - s.x);
            if (Math.abs(angDiff(a, s.angle)) < s.arc) {
              s.hits.add(e);
              damageEnemy(e, 14, e.x, e.y, "#bfefff");
              if (e.type !== "boss") { e.knock = 7; e.knockA = a; }
            }
          }
        }
      }
      if (s.life <= 0) swings.splice(i, 1);
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.ring) {
        p.r += (p.maxR - p.r) * 0.3; p.life--;
        if (p.life <= 0) particles.splice(i, 1);
        continue;
      }
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.y -= 0.6; f.life--;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }

  // =========================================================
  //  描画
  // =========================================================
  function drawGrid() {
    ctx.fillStyle = "#070d18";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(47,180,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 45) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 45) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // 外周ライン
    ctx.strokeStyle = "rgba(47,180,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  function drawObstacles() {
    for (const o of OBSTACLES) {
      ctx.fillStyle = "#0e1a2c";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "rgba(47,180,255,0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "rgba(47,180,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o.x + 12, o.y); ctx.lineTo(o.x + 12, o.y + o.h);
      ctx.moveTo(o.x, o.y + 12); ctx.lineTo(o.x + o.w, o.y + 12);
      ctx.stroke();
    }
  }

  function drawSpawnMarks() {
    // スポーンキューがある間、近く出現する縁を薄く光らせる（簡易）
  }

  function drawPlayer() {
    if (!player.alive) return;
    if (player.invuln > 0 && Math.floor(game.frame / 4) % 2 === 0 && player.dashTime <= 0) {
      // 点滅（ダッシュ中は表示）
    }
    const { x, y, angle } = player;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // 機体（三角）
    const flash = player.hitFlash > 0;
    ctx.fillStyle = flash ? "#ffffff" : "#dff7ff";
    ctx.strokeStyle = TRIGGERS[player.trigger].color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // コア
    ctx.fillStyle = "#2fb4ff";
    ctx.beginPath(); ctx.arc(-1, 0, 4, 0, TAU); ctx.fill();
    ctx.restore();

    // 弧月の刀身（構え）
    if (TRIGGERS[player.trigger].id === "kogetsu") {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(angle);
      ctx.strokeStyle = "rgba(127,208,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(34, -10); ctx.stroke();
      ctx.restore();
    }

    // チャージ表示（アイビス）
    if (player.charging) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = `rgba(255,207,111,${0.4 + player.charge * 0.6})`;
      ctx.lineWidth = 2 + player.charge * 3;
      ctx.beginPath(); ctx.arc(0, 0, player.r + 8, 0, TAU * player.charge); ctx.stroke();
      // 照準ライン
      ctx.strokeStyle = `rgba(255,207,111,${0.2 + player.charge * 0.4})`;
      ctx.lineWidth = 1 + player.charge * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (player.r + 6), Math.sin(angle) * (player.r + 6));
      ctx.lineTo(Math.cos(angle) * 600, Math.sin(angle) * 600);
      ctx.stroke();
      ctx.restore();
    }

    // シールド
    if (player.shieldActive) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = "rgba(127,208,255,0.85)";
      ctx.fillStyle = "rgba(47,180,255,0.18)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, player.r + 12, angle - 1.0, angle + 1.0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, player.r + 12, angle - 1.0, angle + 1.0);
      ctx.arc(0, 0, player.r + 4, angle + 1.0, angle - 1.0, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawSwings() {
    for (const s of swings) {
      const t = s.life / s.maxLife;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.strokeStyle = `rgba(190,239,255,${t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s.range, -s.arc, s.arc);
      ctx.stroke();
      // 斬撃の白い弧
      ctx.fillStyle = `rgba(255,255,255,${t * 0.35})`;
      ctx.beginPath();
      ctx.arc(0, 0, s.range, -s.arc, s.arc);
      ctx.arc(0, 0, s.range * 0.4, s.arc, -s.arc, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const flash = e.hitFlash > 0;
    if (e.type === "marmod") {
      ctx.rotate(e.t * 0.05);
      ctx.fillStyle = flash ? "#fff" : "#3a1420";
      ctx.strokeStyle = "#ff4d5e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (TAU / 3) * i;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff4d5e";
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
    } else if (e.type === "bamster") {
      ctx.fillStyle = flash ? "#fff" : "#3a1a14";
      ctx.strokeStyle = "#ff7a4d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(-e.r, -e.r * 0.8, e.r * 2, e.r * 1.6);
      ctx.fill(); ctx.stroke();
      // 砲口（自機方向）
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.rotate(a);
      ctx.fillStyle = "#ff7a4d";
      ctx.fillRect(e.r * 0.4, -3, e.r, 6);
    } else if (e.type === "rabbit") {
      const tele = e.telegraph > 0;
      ctx.fillStyle = flash ? "#fff" : tele ? "#5a1020" : "#2a0e1a";
      ctx.strokeStyle = tele ? "#ffd84d" : "#ff4d5e";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill(); ctx.stroke();
      // 脚
      ctx.strokeStyle = tele ? "#ffd84d" : "#ff4d5e";
      ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const a = (TAU / 4) * i + e.t * 0.02;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
        ctx.lineTo(Math.cos(a) * (e.r + 12), Math.sin(a) * (e.r + 12));
        ctx.stroke();
      }
      ctx.fillStyle = tele ? "#ffd84d" : "#ff4d5e";
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    } else if (e.type === "boss") {
      const chg = e.charging;
      ctx.fillStyle = flash ? "#fff" : "#3a0a16";
      ctx.strokeStyle = chg ? "#ffd84d" : "#ff4d5e";
      ctx.lineWidth = 4;
      ctx.rotate(e.t * 0.01);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (TAU / 6) * i;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,77,94,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.6, 0, TAU); ctx.stroke();
      ctx.fillStyle = chg ? "#ffd84d" : "#ff4d5e";
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // HPバー（ザコは小さく、ボスは別途上部）
    if (e.type !== "boss" && e.hp < e.maxHp) {
      const w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x - e.r, e.y - e.r - 9, w, 4);
      ctx.fillStyle = "#ff4d5e";
      ctx.fillRect(e.x - e.r, e.y - e.r - 9, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  function drawBullets() {
    // 自機弾
    for (const b of bullets) {
      ctx.fillStyle = b.color;
      ctx.shadowBlur = 10; ctx.shadowColor = b.color;
      if (b.explode) {
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,210,150,0.6)";
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, TAU); ctx.stroke();
      } else if (b.pierce) {
        // ライン状（スナイプ）
        const a = Math.atan2(b.vy, b.vx);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        ctx.fillRect(-14, -b.r * 0.5, 28, b.r);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    // 敵弾
    for (const b of enemyBullets) {
      ctx.fillStyle = "#ff5a6a";
      ctx.shadowBlur = 8; ctx.shadowColor = "#ff5a6a";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of particles) {
      if (p.ring) {
        const a = p.life / p.maxLife;
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
        continue;
      }
      const a = p.life / p.maxLife;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 2) * a + 0.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // フロートテキスト
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / 30, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function drawAimCursor() {
    if (game.state !== STATE.PLAY) return;
    ctx.strokeStyle = "rgba(127,208,255,0.7)";
    ctx.lineWidth = 1.5;
    const x = input.aimX, y = input.aimY;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, y); ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y); ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 14);
    ctx.stroke();
  }

  function drawBossBar() {
    const boss = enemies.find((e) => e.type === "boss" && !e.dead);
    if (!boss) return;
    const w = 460, x = (W - w) / 2, y = H - 38;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - 2, y - 2, w + 4, 16);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = "#ff4d5e";
    ctx.fillRect(x, y, w * clamp(boss.hp / boss.maxHp, 0, 1), 12);
    ctx.fillStyle = "#ffb3bb";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("近界民・大型トリオン兵", W / 2, y - 8);
    ctx.textAlign = "left";
  }

  function drawBanner() {
    if (game.bannerTimer <= 0) return;
    const a = clamp(game.bannerTimer / 40, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = "#dff7ff";
    ctx.font = "bold 38px system-ui";
    ctx.textAlign = "center";
    ctx.shadowBlur = 16; ctx.shadowColor = "#2fb4ff";
    ctx.fillText(game.banner, W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function render() {
    ctx.save();
    if (game.shake > 0.4) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));

    drawGrid();
    drawObstacles();

    if (game.state === STATE.PLAY || game.state === STATE.OVER) {
      drawSwings();
      for (const e of enemies) drawEnemy(e);
      drawBullets();
      drawPlayer();
      drawParticles();
    }

    ctx.restore();

    drawBossBar();
    drawBanner();
    drawAimCursor();

    // 被弾時の赤フラッシュ縁
    if (player.hitFlash > 0 && player.alive) {
      ctx.fillStyle = `rgba(255,40,70,${player.hitFlash / 10 * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // =========================================================
  //  HUD
  // =========================================================
  function buildSlots() {
    slotsEl.innerHTML = TRIGGERS.map((t, i) =>
      `<div class="slot${i === player.trigger ? " active" : ""}" data-i="${i}">
         <span class="key">${t.key}</span>
         <div class="name" style="color:${t.color}">${t.name}</div>
         <div class="pos">${t.pos}</div>
       </div>`).join("");
  }
  function updateSlots() {
    const nodes = slotsEl.querySelectorAll(".slot");
    nodes.forEach((n, i) => n.classList.toggle("active", i === player.trigger));
  }
  function syncHud() {
    hpBar.style.width = clamp(player.hp / player.maxHp * 100, 0, 100) + "%";
    trionBar.style.width = clamp(player.trion / player.maxTrion * 100, 0, 100) + "%";
    scoreEl.textContent = game.score.toLocaleString();
    waveEl.textContent = game.wave;
    rankEl.textContent = rankFor(game.score);
  }

  // =========================================================
  //  メインループ
  // =========================================================
  let lastTime = 0, acc = 0;
  const STEP = 1000 / 60;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!lastTime) lastTime = now;
    acc += now - lastTime;
    lastTime = now;
    if (acc > 200) acc = 200; // スパイク抑制
    let steps = 0;
    while (acc >= STEP && steps < 5) { update(); acc -= STEP; steps++; }
    render();
  }

  // =========================================================
  //  起動
  // =========================================================
  function boot() {
    startBtn.addEventListener("click", startGame);
    retryBtn.addEventListener("click", startGame);
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if ((k === "enter") && game.state !== STATE.PLAY) startGame();
    });
    titleScreen.addEventListener("click", (e) => { if (e.target === titleScreen) startGame(); });
    requestAnimationFrame(loop);
  }

  boot();
})();
