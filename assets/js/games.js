(function () {
  "use strict";

  /* ═══════════ MINI GAMES LAUNCHER ═══════════ */
  var launcherBtn = document.getElementById("gameLauncherBtn");
  var gamesModal = document.getElementById("gamesModal");
  var gamesClose = document.getElementById("gamesClose");
  var wpmModal = document.getElementById("wpmModal");
  var bbModal = document.getElementById("bbModal");
  var bbClose = document.getElementById("bbClose");

  function openGames() { if (gamesModal) gamesModal.classList.add("open"); }
  function closeGames() { if (gamesModal) gamesModal.classList.remove("open"); }

  if (launcherBtn) launcherBtn.addEventListener("click", openGames);
  if (gamesClose) gamesClose.addEventListener("click", closeGames);
  if (gamesModal)
    gamesModal.addEventListener("click", function (e) {
      if (e.target === gamesModal) closeGames();
    });

  var brickMode = "classic";

  function openBrick(mode) {
    brickMode = mode || brickMode;
    if (bbModal) {
      bbModal.classList.add("open");
      Brick.init(brickMode);
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll(".game-pick"), function (pk) {
    pk.addEventListener("click", function () {
      var g = pk.dataset.game;
      var label = pk.querySelector("b");
      if (label) label.textContent = "Opening…";
      closeGames();
      setTimeout(function () {
        if (label) label.textContent = g === "wpm" ? "Beat My WPM" : "Brick Breaker";
        if (g === "wpm") {
          if (wpmModal) {
            wpmModal.classList.add("open");
            var ti = document.getElementById("typInput");
            if (ti) ti.focus();
          }
        } else if (g === "brick") {
          openBrick(brickMode);
        }
      }, 180);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".bb-mode-chip"), function (chip) {
    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      Array.prototype.forEach.call(document.querySelectorAll(".bb-mode-chip"), function (o) {
        o.classList.remove("active");
      });
      chip.classList.add("active");
      brickMode = chip.dataset.mode;
      openBrick(brickMode);
    });
  });

  if (bbClose)
    bbClose.addEventListener("click", function () {
      bbModal.classList.remove("open");
      Brick.destroy();
    });
  if (bbModal)
    bbModal.addEventListener("click", function (e) {
      if (e.target === bbModal) {
        bbModal.classList.remove("open");
        Brick.destroy();
      }
    });

  /* ═══════════ BRICK BREAKER (ENDLESS) ═══════════ */
  var Brick = (function () {
    var W = 760, H = 560;
    var COLS = 10;
    var MARGIN = 20;
    var GAP = 4;
    var BRICK_H = 22;
    var UNIT_H = 30; // brickH + vertical gap
    var PAD_W = 112, PAD_H = 14;
    var BALL_R = 7;
    var ROWS = 10; // jumlah baris per wave
    var START_Y = 22; // posisi baris paling atas
    var MAX_BALLS = 12;
    var PORTRAIT = false;
    var mode = "classic";

    function padY() { return H - 42; }

    function applyLayout() {
      PORTRAIT = window.matchMedia("(max-width: 768px)").matches;
      if (PORTRAIT) {
        W = 480; H = 800; COLS = 8; ROWS = 20; // potrait: panjang ke bawah, penuh layar
      } else {
        W = 760; H = 560; COLS = 10; ROWS = 10;
      }
    }

    var cv, ctx, scoreEl, bestEl, comboEl, livesEl, waveEl, modeEl, overEl, overTitle, overText, restartBtn, recallBtn;
    var dpr = 1;

    var running = false, raf = null, lastTs = 0, bound = false;
    var keys = { left: false, right: false };

    // Game state
    var field = [];
    var wave = 0, alive = 0, pendingWave = false;
    var balls = [];
    var px, state; // 'serve' | 'play' | 'over'
    var lives, score, combo, comboTic, gameTime, bricksDone;
    var powerups = [];
    var slowT = 0, prevSlow = 0;
    var particles = [], floaters = [], trails = [];
    var shakeT = 0, shakeAmp = 0;

    var PU = [
      { t: "life", ch: "♥", color: "#fa6060" },
      { t: "multi", ch: "5", color: "#c9a96e" },
      { t: "slow", ch: "⇣", color: "#60a5fa" }
    ];

    // Audio
    var actx = null;
    function beep(freq, dur, type, vol) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === "suspended") actx.resume();
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = type || "square";
        o.frequency.value = freq;
        g.gain.value = vol || 0.03;
        o.connect(g); g.connect(actx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
        o.stop(actx.currentTime + dur);
      } catch (e) {}
    }

    function brickW() {
      return (W - MARGIN * 2 - (COLS - 1) * GAP) / COLS;
    }
    function mult() {
      return Math.min(6, 1 + Math.floor(combo / 4));
    }
    function best() {
      try { return parseInt(localStorage.getItem("iano-brick-best") || "0", 10) || 0; }
      catch (e) { return 0; }
    }
    function speedScale() {
      return slowT > 0 ? 0.62 : 1;
    }

    function makeRow(d) {
      var cells = new Array(COLS);
      var holeChance = 0.09;
      for (var c = 0; c < COLS; c++) {
        if (Math.random() < holeChance) { cells[c] = null; continue; }
        var hp;
        if (mode === "numbered") {
          hp = Math.min(8, 3 + Math.floor(Math.random() * 3) + Math.min(wave, 2));
        } else {
          hp = 1;
          var p = Math.random();
          if (p < 0.5) hp = 1;
          else if (p < 0.8) hp = 2;
          else hp = 3;
          if (d > 0.35 && Math.random() < 0.35) hp = Math.max(hp, 2);
          if (d > 0.7 && Math.random() < 0.35) hp = 3;
        }
        cells[c] = { hp: hp, max: hp, gold: false };
      }
      if (Math.random() < 0.05) {
        var gc = Math.floor(Math.random() * COLS);
        cells[gc] = { hp: 1, max: 1, gold: true };
      }
      return { cells: cells };
    }

    function shift() {
      return Math.min(wave, 2) * 18; // makin banyak wave, makin turun dikit (jarak lebih lega ke slider)
    }
    function rowY(i) {
      return START_Y + shift() + i * UNIT_H;
    }

    function buildField() {
      field = [];
      alive = 0;
      var d = Math.min(1, gameTime / 90 + wave * 0.08);
      for (var i = 0; i < ROWS; i++) {
        var row = makeRow(d);
        field.push(row);
        for (var c = 0; c < COLS; c++) if (row.cells[c]) alive++;
      }
    }

    function setupCanvas() {
      cv = document.getElementById("bbCanvas");
      if (!cv) return;
      applyLayout();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.aspectRatio = W + " / " + H;
      ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    }

    function serveBall() {
      balls = [{ x: px, y: padY() - BALL_R - 3, vx: 0, vy: 0 }];
    }

    function reset() {
      wave = 0;
      pendingWave = false;
      buildField();
      lives = 3;
      score = 0;
      combo = 0;
      comboTic = 0;
      gameTime = 0;
      bricksDone = 0;
      powerups = [];
      slowT = 0;
      prevSlow = 0;
      particles = [];
      floaters = [];
      trails = [];
      shakeT = 0;
      px = W / 2;
      serveBall();
      state = "serve";
      updateHud();
      if (overEl) overEl.classList.remove("show");
    }

    function updateHud() {
      if (scoreEl) scoreEl.textContent = score;
      if (bestEl) bestEl.textContent = Math.max(score, best());
      if (comboEl) {
        comboEl.textContent = "x" + mult();
        comboEl.style.color = combo >= 4 ? "var(--green)" : "";
      }
      if (waveEl) waveEl.textContent = wave + 1;
      if (modeEl) modeEl.textContent = mode === "numbered" ? "Numbered" : "Classic";
      if (livesEl) {
        livesEl.textContent = "";
        for (var i = 0; i < lives; i++) livesEl.textContent += "♥";
        for (var j = lives; j < 5; j++) livesEl.textContent += "♡";
      }
    }

    function addParticles(x, y, color, n) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 180;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
          life: 0.4 + Math.random() * 0.4,
          t: 0, r: 2 + Math.random() * 3,
          color: color
        });
      }
    }

    function addFloater(x, y, text, color) {
      floaters.push({ x: x, y: y, t: 0, text: text, color: color || "#c9a96e" });
    }

    function looseLife() {
      lives--;
      shakeT = 0.3;
      shakeAmp = 7;
      beep(110, 0.4, "sawtooth", 0.05);
      updateHud();
      if (lives <= 0) {
        gameOver();
      } else {
        serveBall();
        state = "serve";
        powerups = [];
        addFloater(W / 2, H / 2 - 40, "Bola jatuh! -1 nyawa", "#fa6060");
      }
    }

    function gameOver() {
      state = "over";
      beep(200, 0.25, "sawtooth", 0.05);
      setTimeout(function () { beep(140, 0.4, "sawtooth", 0.05); }, 180);
      var b = best();
      var newBest = score > b;
      try {
        if (newBest) localStorage.setItem("iano-brick-best", String(score));
      } catch (e) {}
      if (overEl) overEl.classList.add("show");
      if (overTitle) overTitle.textContent = "Game Over";
      if (overText) overText.textContent = "Score akhir: " + score + (newBest ? " — Rekor baru! 🏆" : "");
      comboTic = 0;
    }

    function ballSpeed() {
      return Math.min(640, 430 + gameTime * 1.1 + bricksDone * 0.3) * speedScale();
    }

    function recallBalls() {
      if (state !== "play" || !balls.length) return;
      var sp = ballSpeed();
      var n = balls.length;
      var maxAng = Math.min(0.9, 0.5 + n * 0.05);
      for (var i = 0; i < n; i++) {
        var a = (n === 1) ? (Math.random() * 0.4 - 0.2) : (-maxAng + (2 * maxAng * i) / (n - 1));
        balls[i].x = px + (i - (n - 1) / 2) * 14;
        balls[i].y = padY() - BALL_R - 2;
        balls[i].vx = Math.sin(a) * sp;
        balls[i].vy = -Math.cos(a) * sp;
      }
      addFloater(W / 2, H / 2 - 60, "BOLA DITARIK!", "#e8c98d");
      beep(560, 0.08, "square", 0.04);
    }

    function launch() {
      if (state !== "serve" || !balls.length) return;
      var a = (Math.random() * 2 - 1) * 0.9;
      var sp = ballSpeed();
      balls[0].vx = Math.sin(a) * sp;
      balls[0].vy = -Math.cos(a) * sp;
      state = "play";
      beep(520, 0.08, "square", 0.03);
    }

    function spawnPowerup(x, y) {
      if (Math.random() > 0.15) return;
      var r = Math.random(), type = PU[0].t;
      if (r < 0.35) type = PU[0].t;
      else if (r < 0.7) type = PU[1].t;
      else type = PU[2].t;
      powerups.push({ x: x, y: y, type: type, vy: 150 });
    }

    function applyPowerup(pu) {
      var info = null;
      for (var i = 0; i < PU.length; i++) if (PU[i].t === pu.type) info = PU[i];
      if (pu.type === "life") {
        lives = Math.min(5, lives + 1);
        addFloater(pu.x, pu.y - 12, "+1 ♥", "#fa6060");
        beep(700, 0.15, "square", 0.04);
        addParticles(pu.x, pu.y, "#fa6060", 14);
      } else if (pu.type === "multi") {
        var n = Math.min(5, MAX_BALLS - balls.length);
        if (n > 0) {
          var sp = ballSpeed();
          var srcs = balls.slice(); // pecah dari bola yang lagi jalan, bukan dari paddle
          for (var k = 0; k < n; k++) {
            var src = srcs[k % srcs.length];
            var a = Math.random() * Math.PI * 2;
            balls.push({
              x: src.x, y: src.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp
            });
          }
          addFloater(pu.x, pu.y - 12, "+5 BOLA", "#c9a96e");
          beep(520, 0.12, "square", 0.04);
          addParticles(pu.x, pu.y, "#c9a96e", 16);
        } else {
          addFloater(pu.x, pu.y - 12, "BOLA MAX " + MAX_BALLS, "#60a5fa");
          beep(300, 0.08, "square", 0.03);
        }
      } else if (pu.type === "slow") {
        if (slowT <= 0) { // baru apply slow kalau belum aktif, biar gak ke-stack
          prevSlow = 1;
          for (var m = 0; m < balls.length; m++) { balls[m].vx *= 0.62; balls[m].vy *= 0.62; }
        }
        slowT = 6; // reset/refresh timer
        addFloater(pu.x, pu.y - 12, "BOLA LAMBAT", "#60a5fa");
        beep(340, 0.15, "square", 0.04);
        addParticles(pu.x, pu.y, "#60a5fa", 16);
      }
      updateHud();
    }

    function update(dt) {
      gameTime += dt;

      // Wave baru: field sebelumnya habis semua -> turun beberapa baris, spawn lagi
      if (pendingWave) {
        pendingWave = false;
        wave++;
        buildField();
        addFloater(W / 2, H / 2 - 30, "WAVE " + (wave + 1), "#e8c98d");
        beep(660, 0.1, "square", 0.03);
        updateHud();
      }

      // Durasi slow
      if (slowT > 0) {
        slowT -= dt;
        if (slowT <= 0) {
          for (var m = 0; m < balls.length; m++) { balls[m].vx /= 0.62; balls[m].vy /= 0.62; }
          prevSlow = 0;
        }
      }

      // Combo decay
      comboTic += dt;
      if (comboTic > 3 && combo > 0) { combo = 0; updateHud(); }

      // Keyboard paddle
      var kd = 0;
      if (keys.left) kd -= 1;
      if (keys.right) kd += 1;
      if (kd) px += kd * 640 * dt;
      px = Math.max(PAD_W / 2 + 8, Math.min(W - PAD_W / 2 - 8, px));

      if (state === "serve") {
        if (balls.length) { balls[0].x = px; balls[0].y = padY() - BALL_R - 3; }
      } else if (state === "play") {
        for (var i = balls.length - 1; i >= 0; i--) {
          if (!moveBall(balls[i], dt)) balls.splice(i, 1);
        }
        if (!balls.length) { looseLife(); }
      }

      // Trail
      if (state === "play") {
        for (var t2 = 0; t2 < balls.length; t2++) {
          trails.push({ x: balls[t2].x, y: balls[t2].y });
        }
        while (trails.length > 24) trails.shift();
      } else {
        trails = [];
      }

      // Powerups jatuh + tangkapan
      for (var p = powerups.length - 1; p >= 0; p--) {
        var pu = powerups[p];
        pu.y += pu.vy * dt;
        if (pu.y >= padY() && pu.y <= padY() + PAD_H + 12 &&
          pu.x >= px - PAD_W / 2 - 12 && pu.x <= px + PAD_W / 2 + 12) {
          applyPowerup(pu);
          powerups.splice(p, 1);
        } else if (pu.y > H + 20) {
          powerups.splice(p, 1);
        }
      }

      // Partikel
      for (var q = particles.length - 1; q >= 0; q--) {
        var pt = particles[q];
        pt.t += dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += 420 * dt;
        if (pt.t >= pt.life) particles.splice(q, 1);
      }
      for (var f = floaters.length - 1; f >= 0; f--) {
        var fl = floaters[f];
        fl.t += dt;
        fl.y -= 40 * dt;
        if (fl.t > 1) floaters.splice(f, 1);
      }
      if (shakeT > 0) shakeT -= dt;
      if (shakeT <= 0) shakeAmp = 0;
    }

    function moveBall(ball, dt) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Dinding kiri/kanan
      if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
      else if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }
      // Langit-langit
      if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }

      // Paddle
      if (ball.vy > 0 &&
        ball.y + BALL_R >= padY() &&
        ball.y + BALL_R <= padY() + PAD_H + 8 &&
        ball.x >= px - PAD_W / 2 - BALL_R &&
        ball.x <= px + PAD_W / 2 + BALL_R) {
        var offset = (ball.x - px) / (PAD_W / 2);
        offset = Math.max(-1, Math.min(1, offset));
        var a = offset * 1.05;
        var sp = ballSpeed() * 1.003;
        ball.vx = Math.sin(a) * sp;
        ball.vy = -Math.cos(a) * sp;
        ball.y = padY() - BALL_R;
        beep(210, 0.06, "square", 0.025);
      }

      // Blok
      for (var i = 0; i < field.length; i++) {
        var sy = rowY(i);
        if (sy + BRICK_H < 0) continue;
        var row = field[i];
        var bw = brickW();
        for (var c = 0; c < COLS; c++) {
          var cell = row.cells[c];
          if (!cell) continue;
          var rx = MARGIN + c * (bw + GAP);
          var ry = sy;
          var cx = Math.max(rx, Math.min(ball.x, rx + bw));
          var cy = Math.max(ry, Math.min(ball.y, ry + BRICK_H));
          var dx = ball.x - cx, dy = ball.y - cy;
          if (dx * dx + dy * dy >= BALL_R * BALL_R) continue;

          // Pilih sumbu pantulan berdasarkan penetrasi terkecil
          var fromLeft = ball.x - rx, fromRight = rx + bw - ball.x;
          var fromTop = ball.y - ry, fromBottom = ry + BRICK_H - ball.y;
          var m = Math.min(fromLeft, fromRight, fromTop, fromBottom);
          if (m === fromTop) { ball.y = ry - BALL_R; if (ball.vy > 0) ball.vy = -ball.vy; }
          else if (m === fromBottom) { ball.y = ry + BRICK_H + BALL_R; if (ball.vy < 0) ball.vy = -ball.vy; }
          else if (m === fromLeft) { ball.x = rx - BALL_R; if (ball.vx > 0) ball.vx = -ball.vx; }
          else { ball.x = rx + bw + BALL_R; if (ball.vx < 0) ball.vx = -ball.vx; }

          var color = cell.gold ? "#c9a96e" : cell.max === 3 ? "#e560fa" : cell.max === 2 ? "#34d399" : "#60a5fa";
          cell.hp--;
          addParticles(cx, cy, color, cell.gold ? 18 : 8);
          if (cell.hp <= 0) {
            row.cells[c] = null;
            spawnPowerup(cx, ry + BRICK_H / 2);
            alive--;
            combo++;
            comboTic = 0;
            bricksDone++;
            if (alive <= 0) pendingWave = true;
            var mlt = mult();
            if (cell.gold) {
              score += 35 * mlt;
              lives = Math.min(5, lives + 1);
              beep(780, 0.12, "square", 0.04);
              addFloater(cx, cy - 4, "+♥ GOLD", "#c9a96e");
            } else {
              score += 10 * cell.max * mlt;
              beep(300 + cell.max * 90, 0.06, "square", 0.025);
              if (combo >= 4) addFloater(cx, cy - 4, "x" + mlt, "#34d399");
              else addFloater(cx, cy - 4, "+" + 10 * cell.max * mlt, "#9ea1ad");
            }
            shakeT = 0.12;
            shakeAmp = 4;
            updateHud();
          } else {
            beep(180, 0.05, "square", 0.02);
          }
          break;
        }
      }

      // Bola jatuh
      if (ball.y - BALL_R > H) {
        return false;
      }
      return true;
    }

    function draw() {
      ctx.save();
      // Background
      ctx.fillStyle = "#0b0e14";
      ctx.fillRect(-8, -8, W + 16, H + 16);

      if (shakeT > 0) {
        ctx.translate((Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp);
      }

      // Grid subtle
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (var gx = 0; gx <= COLS; gx++) {
        var lx = MARGIN + gx * (brickW() + GAP);
        ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
      }

      // Trail bola
      for (var t = 0; t < trails.length; t++) {
        var tr = trails[t];
        ctx.globalAlpha = (t / trails.length) * 0.25;
        ctx.fillStyle = "#c9a96e";
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, BALL_R * (t / trails.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Brik
      var bw = brickW();
      for (var i = 0; i < field.length; i++) {
        var sy = rowY(i);
        if (sy > H || sy + BRICK_H < 0) continue;
        var row = field[i];
        for (var c = 0; c < COLS; c++) {
          var cell = row.cells[c];
          if (!cell) continue;
          var rx = MARGIN + c * (bw + GAP);
          var color = cell.gold ? "#c9a96e" : cell.max === 3 ? "#e560fa" : cell.max === 2 ? "#34d399" : "#60a5fa";
          ctx.fillStyle = color;
          var alpha = 0.4 + (0.6 * cell.hp / cell.max);
          ctx.globalAlpha = alpha;
          roundRect(rx, sy, bw, BRICK_H, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          roundRect(rx + 2, sy + 1, bw - 4, 3, 2);
          ctx.fill();
          if (mode === "numbered" && !cell.gold) {
            ctx.font = "800 " + Math.max(11, Math.min(16, bw * 0.32)) + "px 'SF Pro Display', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fillText(String(cell.hp), rx + bw / 2 + 1, sy + BRICK_H / 2 + 1);
            ctx.fillStyle = "#fff";
            ctx.fillText(String(cell.hp), rx + bw / 2, sy + BRICK_H / 2);
            ctx.textBaseline = "alphabetic";
          }
        }
      }

      // Paddle
      var padGrad = ctx.createLinearGradient(px - PAD_W / 2, padY(), px + PAD_W / 2, padY() + PAD_H);
      padGrad.addColorStop(0, "#e8c98d");
      padGrad.addColorStop(1, "#c9a96e");
      ctx.fillStyle = padGrad;
      ctx.shadowColor = "rgba(201,169,110,0.55)";
      ctx.shadowBlur = 14;
      roundRect(px - PAD_W / 2, padY(), PAD_W, PAD_H, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Powerups
      ctx.font = "700 13px 'SF Pro Display', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (var pu2 = 0; pu2 < powerups.length; pu2++) {
        var pu = powerups[pu2];
        var info = null;
        for (var pi = 0; pi < PU.length; pi++) if (PU[pi].t === pu.type) info = PU[pi];
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(10,11,18,0.9)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = info.color;
        ctx.stroke();
        ctx.fillStyle = info.color;
        ctx.fillText(info.t === "multi" ? "×5" : info.ch, pu.x, pu.y);
      }
      ctx.textBaseline = "alphabetic";

      // Bola
      if (state !== "over") {
        ctx.fillStyle = "#f0f1f5";
        for (var bi = 0; bi < balls.length; bi++) {
          ctx.beginPath();
          ctx.arc(balls[bi].x, balls[bi].y, BALL_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c9a96e";
          ctx.beginPath();
          ctx.arc(balls[bi].x, balls[bi].y, BALL_R * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#f0f1f5";
        }
      }

      // Partikel
      for (var p2 = 0; p2 < particles.length; p2++) {
        var pt = particles[p2];
        ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Floating text (pakai backdrop biar kebaca di atas brik/bola)
      for (var f2 = 0; f2 < floaters.length; f2++) {
        var fl = floaters[f2];
        ctx.globalAlpha = Math.max(0, 1 - fl.t);
        pillText(fl.text, fl.x, fl.y, fl.color, 13);
      }
      ctx.globalAlpha = 1;

      // Notifikasi tengah atas (COMBO / SLOW)
      if (slowT > 0 && state !== "over") {
        pillText("SLOW " + slowT.toFixed(0) + "s", W / 2, 34, "#60a5fa", 22);
      } else if (state !== "over" && combo >= 4) {
        pillText("COMBO x" + mult(), W / 2, 34, "#34d399", 22);
      }

      ctx.restore();
    }

    function pillText(text, x, y, color, fontSize) {
      var fs = fontSize || 22;
      ctx.font = "700 " + fs + "px 'SF Pro Display', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var tw = ctx.measureText(text).width;
      var w = tw + fs;
      var h = fs + 12;
      ctx.fillStyle = "rgba(6,8,14,0.8)";
      roundRect(x - w / 2, y - h / 2, w, h, 10);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
      ctx.textBaseline = "alphabetic";
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function frame(ts) {
      if (!running) return;
      var dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;
      update(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    function pointerX(e) {
      var rect = cv.getBoundingClientRect();
      return ((e.clientX - rect.left) / rect.width) * W;
    }

    function onPointerMove(e) {
      if (!running || state === "over" || !balls.length) return;
      px = pointerX(e);
      px = Math.max(PAD_W / 2 + 8, Math.min(W - PAD_W / 2 - 8, px));
    }

    function onPointerDown(e) {
      if (!running) return;
      e.preventDefault();
      onPointerMove(e);
      launch();
    }

    function onKeyDown(e) {
      if (!bbModal || !bbModal.classList.contains("open") || state === "over") return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") { keys.left = true; e.preventDefault(); }
      else if (e.code === "ArrowRight" || e.code === "KeyD") { keys.right = true; e.preventDefault(); }
      else if (e.code === "Space") { launch(); e.preventDefault(); }
      else if (e.code === "ArrowDown" || e.code === "KeyS") { recallBalls(); e.preventDefault(); }
    }
    function onKeyUp(e) {
      if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
      else if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
    }

    function init(newMode) {
      if (running) return;
      mode = newMode || "classic";
      setupCanvas();
      if (!ctx) return;
      if (!bound) {
        bound = true;
        cv.addEventListener("pointermove", onPointerMove);
        cv.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
      }
      scoreEl = document.getElementById("bbScore");
      bestEl = document.getElementById("bbBest");
      comboEl = document.getElementById("bbCombo");
      livesEl = document.getElementById("bbLives");
      waveEl = document.getElementById("bbWave");
      modeEl = document.getElementById("bbMode");
      overEl = document.getElementById("bbOverlay");
      overTitle = document.getElementById("bbOverTitle");
      overText = document.getElementById("bbOverText");
      recallBtn = document.getElementById("bbRecall");
      if (recallBtn) recallBtn.onclick = function () { recallBalls(); };
      restartBtn = document.getElementById("bbRestart");
      if (restartBtn) restartBtn.onclick = function () { reset(); beep(440, 0.09, "square", 0.03); };
      reset();
      lastTs = performance.now();
      running = true;
      raf = requestAnimationFrame(frame);
    }

    function destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      keys.left = false;
      keys.right = false;
      if (actx && actx.state === "running") actx.close();
      actx = null;
    }

    return { init: init, destroy: destroy };
  })();
})();