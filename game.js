/* =========================================================
   STAR DRIFTER — 縦スクロール・シューティング
   Vanilla JS + Canvas2D。ライブラリ依存なし。
   ========================================================= */
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // ---- DOM ----
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const hiscoreEl = document.getElementById("hiscore");
  const levelEl = document.getElementById("level");
  const livesEl = document.getElementById("lives");
  const titleScreen = document.getElementById("title-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const finalScoreEl = document.getElementById("final-score");
  const finalHiEl = document.getElementById("final-hi");
  const newRecordEl = document.getElementById("new-record");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");

  // ---- 定数 ----
  const HISCORE_KEY = "stardrifter.hiscore";
  const STATE = { TITLE: 0, PLAY: 1, OVER: 2 };

  // ---- ユーティリティ ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

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
    const blip = (freq, dur, type = "square", gain = 0.06) => {
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
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur);
    };
    return {
      resume: ensure,
      shot: () => blip(880, 0.06, "square", 0.025),
      hit: () => blip(220, 0.12, "sawtooth", 0.05),
      explode: () => blip(120, 0.32, "sawtooth", 0.09),
      power: () => { blip(660, 0.1, "sine", 0.07); setTimeout(() => blip(990, 0.12, "sine", 0.07), 80); },
      bomb: () => blip(80, 0.6, "sawtooth", 0.12),
      playerDie: () => { blip(300, 0.5, "sawtooth", 0.1); setTimeout(() => blip(90, 0.6, "sawtooth", 0.1), 120); },
    };
  })();

  // =========================================================
  //  入力
  // =========================================================
  const input = {
    x: W / 2, y: H - 120, // ポインタ目標位置
    using: "key",         // "key" | "pointer"
    keys: new Set(),
    rapid: false,         // クリック押しっぱなしで連射強化
    bomb: false,
  };

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    input.x = (e.clientX - r.left) * (W / r.width);
    input.y = (e.clientY - r.top) * (H / r.height);
    input.using = "pointer";
  });
  canvas.addEventListener("pointerdown", (e) => {
    Sound.resume();
    if (e.button === 2) input.bomb = true;
    else input.rapid = true;
    const r = canvas.getBoundingClientRect();
    input.x = (e.clientX - r.left) * (W / r.width);
    input.y = (e.clientY - r.top) * (H / r.height);
    input.using = "pointer";
  });
  window.addEventListener("pointerup", () => { input.rapid = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    input.keys.add(e.key.toLowerCase());
    if (e.key === " ") input.bomb = true;
    input.using = "key";
    Sound.resume();
  });
  window.addEventListener("keyup", (e) => input.keys.delete(e.key.toLowerCase()));

  // =========================================================
  //  エンティティ用プール配列
  // =========================================================
  let bullets = [];      // 自機弾
  let enemies = [];
  let enemyBullets = [];
  let particles = [];
  let powerups = [];
  let stars = [];

  // =========================================================
  //  プレイヤー
  // =========================================================
  const player = {
    x: W / 2, y: H - 120, r: 12,
    speed: 6.2,
    power: 1,            // 1..5 ショットレベル
    lives: 3,
    bombs: 3,
    invuln: 0,           // 無敵フレーム
    fireCooldown: 0,
    alive: true,
  };

  function resetPlayer() {
    player.x = W / 2; player.y = H - 120;
    player.power = 1; player.lives = 3; player.bombs = 3;
    player.invuln = 90; player.fireCooldown = 0; player.alive = true;
  }

  // =========================================================
  //  ゲーム状態
  // =========================================================
  const game = {
    state: STATE.TITLE,
    score: 0,
    hiscore: parseInt(localStorage.getItem(HISCORE_KEY) || "0", 10) || 0,
    level: 1,
    spawnTimer: 0,
    spawnInterval: 64,
    bombFlash: 0,
    shake: 0,
    frame: 0,
  };

  function startGame() {
    bullets = []; enemies = []; enemyBullets = []; particles = []; powerups = [];
    resetPlayer();
    game.state = STATE.PLAY;
    game.score = 0; game.level = 1;
    game.spawnTimer = 0; game.spawnInterval = 64;
    game.bombFlash = 0; game.shake = 0; game.frame = 0;
    titleScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    syncHud();
    Sound.resume();
  }

  function gameOver() {
    game.state = STATE.OVER;
    const isRecord = game.score > game.hiscore;
    if (isRecord) {
      game.hiscore = game.score;
      localStorage.setItem(HISCORE_KEY, String(game.hiscore));
    }
    finalScoreEl.textContent = game.score.toLocaleString();
    finalHiEl.textContent = game.hiscore.toLocaleString();
    newRecordEl.classList.toggle("hidden", !isRecord);
    gameoverScreen.classList.remove("hidden");
    hud.classList.add("hidden");
  }

  // =========================================================
  //  星空背景
  // =========================================================
  function initStars() {
    stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: rand(0.4, 2.2), // 速度/サイズ
      });
    }
  }
  function updateStars() {
    for (const s of stars) {
      s.y += s.z * 1.1;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }
  }
  function drawStars() {
    for (const s of stars) {
      const a = clamp(s.z / 2.2, 0.2, 1);
      ctx.fillStyle = `rgba(180,220,255,${a})`;
      ctx.fillRect(s.x, s.y, s.z, s.z);
    }
  }

  // =========================================================
  //  発射 / スポーン
  // =========================================================
  function firePlayer() {
    Sound.shot();
    const lvl = player.power;
    const y = player.y - player.r;
    const shots = [];
    if (lvl === 1) shots.push([0, -10]);
    else if (lvl === 2) shots.push([-5, -10], [5, -10]);
    else if (lvl === 3) shots.push([0, -11], [-7, -9.5], [7, -9.5]);
    else if (lvl === 4) shots.push([-4, -11], [4, -11], [-10, -9], [10, -9]);
    else shots.push([0, -12], [-5, -11], [5, -11], [-11, -9], [11, -9]);
    for (const [vx, vy] of shots) {
      bullets.push({ x: player.x, y, vx, vy, r: 4, dmg: 1 });
    }
  }

  function spawnEnemy() {
    const lv = game.level;
    const roll = Math.random();
    let type;
    if (roll < 0.5) type = "drone";
    else if (roll < 0.78) type = "weaver";
    else if (roll < 0.92) type = "shooter";
    else type = "tank";

    const base = {
      x: rand(40, W - 40), y: -30,
      vx: 0, vy: 1.4 + lv * 0.12,
      r: 16, hp: 2, score: 100, type,
      t: 0, fireT: rand(40, 90),
      hue: 0,
    };
    if (type === "drone") {
      base.hp = 2 + Math.floor(lv / 3); base.r = 14; base.score = 100; base.hue = 200;
    } else if (type === "weaver") {
      base.hp = 3 + Math.floor(lv / 3); base.r = 15; base.score = 150; base.hue = 280;
      base.amp = rand(60, 130); base.baseX = base.x; base.freq = rand(0.02, 0.04);
      base.vy = 1.1 + lv * 0.1;
    } else if (type === "shooter") {
      base.hp = 4 + Math.floor(lv / 2); base.r = 17; base.score = 250; base.hue = 0;
      base.vy = 0.9 + lv * 0.08;
    } else if (type === "tank") {
      base.hp = 14 + lv * 2; base.r = 26; base.score = 600; base.hue = 40;
      base.vy = 0.7 + lv * 0.05;
    }
    enemies.push(base);
  }

  function enemyFire(e) {
    const ang = Math.atan2(player.y - e.y, player.x - e.x);
    const sp = 3 + game.level * 0.15;
    if (e.type === "tank") {
      // 3way
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.28;
        enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 5 });
      }
    } else {
      enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 5 });
    }
  }

  function dropPowerup(x, y) {
    const r = Math.random();
    let kind;
    if (r < 0.6) kind = "power";
    else if (r < 0.85) kind = "bomb";
    else kind = "life";
    powerups.push({ x, y, vy: 1.6, r: 11, kind, t: 0 });
  }

  // =========================================================
  //  エフェクト
  // =========================================================
  function explosion(x, y, color, count = 18, spd = 4) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.5, spd);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(20, 40), maxLife: 40, color, r: rand(1.5, 3.5),
      });
    }
  }

  function useBomb() {
    if (player.bombs <= 0 || !player.alive) return;
    player.bombs--;
    Sound.bomb();
    game.bombFlash = 1;
    game.shake = 14;
    // 画面上の敵を一掃 + 敵弾消去
    for (const e of enemies) {
      explosion(e.x, e.y, `hsl(${e.hue},90%,60%)`, 14, 5);
      game.score += Math.floor(e.score * 0.5);
    }
    enemies = [];
    enemyBullets = [];
    syncHud();
  }

  // =========================================================
  //  更新
  // =========================================================
  function update() {
    game.frame++;
    updateStars();
    if (game.state !== STATE.PLAY) return;

    // --- プレイヤー移動 ---
    if (player.alive) {
      if (input.using === "pointer") {
        player.x += (input.x - player.x) * 0.35;
        player.y += (input.y - player.y) * 0.35;
      } else {
        let dx = 0, dy = 0;
        const k = input.keys;
        if (k.has("arrowleft") || k.has("a")) dx -= 1;
        if (k.has("arrowright") || k.has("d")) dx += 1;
        if (k.has("arrowup") || k.has("w")) dy -= 1;
        if (k.has("arrowdown") || k.has("s")) dy += 1;
        if (dx && dy) { dx *= 0.707; dy *= 0.707; }
        player.x += dx * player.speed;
        player.y += dy * player.speed;
      }
      player.x = clamp(player.x, player.r, W - player.r);
      player.y = clamp(player.y, player.r, H - player.r);

      // --- ショット ---
      player.fireCooldown--;
      if (player.fireCooldown <= 0) {
        firePlayer();
        player.fireCooldown = input.rapid ? 5 : 9;
      }
    }

    if (input.bomb) { useBomb(); input.bomb = false; }
    if (player.invuln > 0) player.invuln--;
    if (game.bombFlash > 0) game.bombFlash -= 0.04;
    if (game.shake > 0) game.shake *= 0.85;

    // --- 自機弾 ---
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy;
      if (b.y < -20 || b.x < -20 || b.x > W + 20) bullets.splice(i, 1);
    }

    // --- スポーン ---
    game.spawnTimer++;
    if (game.spawnTimer >= game.spawnInterval) {
      game.spawnTimer = 0;
      spawnEnemy();
      if (game.level >= 3 && Math.random() < 0.4) spawnEnemy();
    }

    // --- 敵 ---
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.t++;
      if (e.type === "weaver") {
        e.x = e.baseX + Math.sin(e.t * e.freq) * e.amp;
        e.y += e.vy;
      } else {
        e.x += e.vx; e.y += e.vy;
      }
      // 発射
      if (e.type === "shooter" || e.type === "tank") {
        e.fireT--;
        if (e.fireT <= 0 && e.y > 0 && e.y < H * 0.7) {
          enemyFire(e);
          e.fireT = e.type === "tank" ? rand(70, 110) : rand(60, 100);
        }
      }
      if (e.y > H + 40) { enemies.splice(i, 1); continue; }

      // 自機弾との衝突
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
          e.hp -= b.dmg;
          bullets.splice(j, 1);
          explosion(b.x, b.y, "#bfefff", 3, 2);
          Sound.hit();
          if (e.hp <= 0) {
            explosion(e.x, e.y, `hsl(${e.hue},90%,60%)`, e.type === "tank" ? 30 : 16, e.type === "tank" ? 6 : 4);
            Sound.explode();
            game.score += e.score;
            game.shake = Math.max(game.shake, e.type === "tank" ? 8 : 2);
            const dropChance = e.type === "tank" ? 1 : 0.12;
            if (Math.random() < dropChance) dropPowerup(e.x, e.y);
            enemies.splice(i, 1);
            break;
          }
        }
      }
    }

    // --- 敵弾 ---
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy;
      if (b.y > H + 20 || b.y < -20 || b.x < -20 || b.x > W + 20) {
        enemyBullets.splice(i, 1); continue;
      }
      if (player.alive && player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) ** 2) {
        enemyBullets.splice(i, 1);
        hitPlayer();
      }
    }

    // --- 敵本体との接触 ---
    if (player.alive && player.invuln <= 0) {
      for (const e of enemies) {
        if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) ** 2) {
          hitPlayer();
          break;
        }
      }
    }

    // --- パワーアップ ---
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.t++; p.y += p.vy; p.x += Math.sin(p.t * 0.06) * 0.6;
      if (p.y > H + 20) { powerups.splice(i, 1); continue; }
      if (player.alive && dist2(p.x, p.y, player.x, player.y) < (p.r + player.r + 6) ** 2) {
        applyPowerup(p.kind);
        powerups.splice(i, 1);
      }
    }

    // --- パーティクル ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // --- レベルアップ（スコア依存） ---
    const newLevel = 1 + Math.floor(game.score / 2500);
    if (newLevel > game.level) {
      game.level = newLevel;
      game.spawnInterval = Math.max(24, 64 - game.level * 4);
    }

    syncHud();
  }

  function hitPlayer() {
    if (!player.alive || player.invuln > 0) return;
    player.lives--;
    player.power = Math.max(1, player.power - 1);
    player.invuln = 110;
    explosion(player.x, player.y, "#ff6db1", 26, 6);
    Sound.playerDie();
    game.shake = 16;
    if (player.lives < 0) {
      player.alive = false;
      setTimeout(gameOver, 700);
    }
    syncHud();
  }

  function applyPowerup(kind) {
    Sound.power();
    if (kind === "power") {
      player.power = Math.min(5, player.power + 1);
      game.score += 50;
    } else if (kind === "bomb") {
      player.bombs = Math.min(6, player.bombs + 1);
    } else if (kind === "life") {
      player.lives = Math.min(6, player.lives + 1);
    }
    explosion(player.x, player.y - 20, "#ffd84d", 10, 3);
    syncHud();
  }

  // =========================================================
  //  描画
  // =========================================================
  function drawPlayer() {
    if (!player.alive) return;
    // 無敵中は点滅
    if (player.invuln > 0 && Math.floor(game.frame / 4) % 2 === 0) return;
    const { x, y } = player;
    ctx.save();
    ctx.translate(x, y);
    // 噴射
    const flame = 10 + Math.sin(game.frame * 0.5) * 4;
    ctx.fillStyle = "rgba(77,243,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(-5, 8); ctx.lineTo(0, 8 + flame); ctx.lineTo(5, 8);
    ctx.fill();
    // 機体
    ctx.fillStyle = "#dff7ff";
    ctx.strokeStyle = "#4df3ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(12, 12);
    ctx.lineTo(4, 6);
    ctx.lineTo(-4, 6);
    ctx.lineTo(-12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // コックピット
    ctx.fillStyle = "#ff4d9d";
    ctx.beginPath();
    ctx.arc(0, -2, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const col = `hsl(${e.hue},85%,58%)`;
    const dark = `hsl(${e.hue},70%,38%)`;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.fillStyle = dark;
    if (e.type === "drone") {
      ctx.beginPath();
      ctx.moveTo(0, e.r); ctx.lineTo(e.r, -e.r * 0.6);
      ctx.lineTo(-e.r, -e.r * 0.6); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (e.type === "weaver") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + e.t * 0.04;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (e.type === "shooter") {
      ctx.beginPath();
      ctx.rect(-e.r, -e.r * 0.7, e.r * 2, e.r * 1.4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
    } else { // tank
      ctx.beginPath();
      ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.6, 0, Math.PI * 2); ctx.stroke();
      // HPバー
      const ratio = clamp(e.hp / (14 + game.level * 2), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-e.r, -e.r - 8, e.r * 2, 4);
      ctx.fillStyle = "#ff4d9d";
      ctx.fillRect(-e.r, -e.r - 8, e.r * 2 * ratio, 4);
    }
    ctx.restore();
  }

  function drawBullets() {
    // 自機弾
    ctx.fillStyle = "#bfefff";
    ctx.shadowBlur = 8; ctx.shadowColor = "#4df3ff";
    for (const b of bullets) {
      ctx.fillRect(b.x - 1.6, b.y - 7, 3.2, 10);
    }
    ctx.shadowBlur = 0;
    // 敵弾
    for (const b of enemyBullets) {
      ctx.fillStyle = "#ff4d6d";
      ctx.shadowBlur = 8; ctx.shadowColor = "#ff4d6d";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawPowerups() {
    for (const p of powerups) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t * 0.05);
      let col, label;
      if (p.kind === "power") { col = "#4df3ff"; label = "P"; }
      else if (p.kind === "bomb") { col = "#ffd84d"; label = "B"; }
      else { col = "#ff4d9d"; label = "1UP"; }
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        const px = Math.cos(a) * p.r, py = Math.sin(a) * p.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // ラベルは回転させない
      ctx.fillStyle = col;
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, p.x, p.y);
    }
    ctx.textAlign = "left";
  }

  function drawParticles() {
    for (const p of particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // 画面シェイク
    ctx.save();
    if (game.shake > 0.5) {
      ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
    }

    drawStars();

    if (game.state === STATE.PLAY || game.state === STATE.OVER) {
      drawPowerups();
      for (const e of enemies) drawEnemy(e);
      drawBullets();
      drawPlayer();
      drawParticles();
    }

    ctx.restore();

    // ボム発光
    if (game.bombFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(game.bombFlash, 0, 0.8)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // =========================================================
  //  HUD
  // =========================================================
  function syncHud() {
    scoreEl.textContent = game.score.toLocaleString();
    hiscoreEl.textContent = Math.max(game.hiscore, game.score).toLocaleString();
    levelEl.textContent = game.level;
    const n = Math.max(0, player.lives);
    let html = "";
    for (let i = 0; i < n; i++) html += '<span class="life-icon"></span>';
    if (player.bombs > 0) html += `<span style="margin-left:8px;color:#ffd84d;font-size:12px;">💣${player.bombs}</span>`;
    livesEl.innerHTML = html;
  }

  // =========================================================
  //  メインループ
  // =========================================================
  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // =========================================================
  //  起動
  // =========================================================
  function boot() {
    initStars();
    hiscoreEl.textContent = game.hiscore.toLocaleString();
    startBtn.addEventListener("click", startGame);
    retryBtn.addEventListener("click", startGame);
    // タイトル/オーバー画面でスペースやクリックでも開始
    window.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        if (game.state === STATE.TITLE || game.state === STATE.OVER) startGame();
      }
    });
    titleScreen.addEventListener("click", (e) => {
      if (e.target === titleScreen) startGame();
    });
    loop();
  }

  boot();
})();
