/*!
 * 霓虹贪吃蛇 — 手机优先的网页小游戏
 * 纯原生 HTML/CSS/JS，无依赖，可直接部署到 GitHub Pages。
 */
(() => {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const COLS = 20;
  const ROWS = 20;
  const BASE_STEP = 165;   // 初始每步毫秒数
  const MIN_STEP = 78;     // 最快每步毫秒数
  const STEP_DECAY = 4.5;  // 每吃一个果实减少的毫秒数
  const SWIPE_THRESHOLD = 22;

  const STORAGE_BEST = 'snake.best';
  const STORAGE_SOUND = 'snake.sound';

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  /* ---------------- DOM ---------------- */
  const stage = document.getElementById('stage');
  const wrap = document.getElementById('boardWrap');
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovText = document.getElementById('ovText');
  const ovBtn = document.getElementById('ovBtn');
  const pauseBtn = document.getElementById('btnPause');
  const soundBtn = document.getElementById('btnSound');

  /* ---------------- 状态 ---------------- */
  let cell = 20;          // 每格 CSS 像素
  let snake = [];         // 索引 0 是蛇头
  let prevSnake = [];     // 上一步的蛇身，用于插值渲染
  let dir = 'right';
  let queue = [];         // 缓存的转向指令
  let food = { x: 0, y: 0 };
  let score = 0;
  let best = Number(load(STORAGE_BEST, 0)) || 0;
  let mode = 'idle';      // idle | running | paused | over
  let stepMs = BASE_STEP;
  let acc = 0;
  let lastTs = 0;
  let clock = 0;          // 累计时间，用于呼吸动画
  let particles = [];
  let isRecord = false;
  let audioCtx = null;
  let soundOn = load(STORAGE_SOUND, 'on') !== 'off';

  /* ---------------- 工具 ---------------- */
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) {
      /* 隐私模式下忽略 */
    }
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* ---------------- 音效 ---------------- */
  function ensureAudio() {
    if (!soundOn) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function blip(freq, dur, type, vol) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol === undefined ? 0.05 : vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function vibrate(pattern) {
    if (soundOn && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (err) { /* 忽略 */ }
    }
  }

  /* ---------------- 自适应尺寸 ---------------- */
  function resize() {
    const rect = stage.getBoundingClientRect();
    const side = Math.max(120, Math.floor(Math.min(rect.width, rect.height)));
    wrap.style.width = side + 'px';
    wrap.style.height = side + 'px';

    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cell = side / COLS;
    render(progress());
  }

  function progress() {
    return mode === 'running' || mode === 'paused' ? clamp(acc / stepMs, 0, 1) : 0;
  }

  /* ---------------- 游戏流程 ---------------- */
  function reset() {
    const cy = Math.floor(ROWS / 2);
    snake = [
      { x: 4, y: cy },
      { x: 3, y: cy },
      { x: 2, y: cy },
    ];
    prevSnake = snake.map((c) => ({ x: c.x, y: c.y }));
    dir = 'right';
    queue = [];
    score = 0;
    stepMs = BASE_STEP;
    acc = 0;
    lastTs = 0;
    particles = [];
    isRecord = false;
    placeFood();
    updateHud();
  }

  function placeFood() {
    const taken = new Set(snake.map((c) => c.x + ',' + c.y));
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!taken.has(x + ',' + y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) {
      food = { x: -1, y: -1 };
      return;
    }
    food = free[(Math.random() * free.length) | 0];
  }

  function start() {
    reset();
    mode = 'running';
    hideOverlay();
    syncPauseBtn();
    ensureAudio();
  }

  function togglePause(force) {
    if (mode === 'running') {
      mode = 'paused';
      showOverlay('paused');
    } else if (mode === 'paused') {
      mode = 'running';
      hideOverlay();
    } else if (force === undefined) {
      return;
    }
    syncPauseBtn();
  }

  function primaryAction() {
    if (mode === 'running') return;
    if (mode === 'paused') {
      togglePause();
      return;
    }
    start();
  }

  function gameOver() {
    mode = 'over';
    blip(190, 0.24, 'sawtooth', 0.07);
    vibrate([26, 55, 30]);
    const head = snake[0] || { x: 0, y: 0 };
    burst(head.x, head.y, 22, '#ff5a7a');
    if (score > best) {
      best = score;
      isRecord = true;
      save(STORAGE_BEST, best);
    }
    updateHud();
    showOverlay('over');
    syncPauseBtn();
  }

  function step() {
    if (queue.length) {
      const next = queue.shift();
      if (next !== OPPOSITE[dir] && next !== dir) dir = next;
    }

    const d = DIRS[dir];
    const head = snake[0];
    const nx = head.x + d.x;
    const ny = head.y + d.y;

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      gameOver();
      return;
    }
    // 蛇尾这一步会移开，因此允许进入尾格
    for (let i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === nx && snake[i].y === ny) {
        gameOver();
        return;
      }
    }

    prevSnake = snake.map((c) => ({ x: c.x, y: c.y }));
    snake.unshift({ x: nx, y: ny });

    if (nx === food.x && ny === food.y) {
      score += 1;
      stepMs = Math.max(MIN_STEP, BASE_STEP - score * STEP_DECAY);
      burst(nx, ny, 14, '#ffd166');
      blip(520 + Math.min(score, 20) * 22, 0.09, 'square', 0.05);
      vibrate(12);
      updateHud();
      placeFood();
    } else {
      snake.pop();
    }
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
  }

  function syncPauseBtn() {
    const icon = mode === 'running' ? '⏸' : '▶';
    pauseBtn.textContent = icon;
    pauseBtn.setAttribute('aria-label', mode === 'running' ? '暂停' : '继续');
  }

  function showOverlay(kind) {
    if (kind === 'paused') {
      ovTitle.textContent = '已暂停';
      ovText.textContent = '休息一下，随时回来继续';
      ovBtn.textContent = '继续游戏';
    } else if (kind === 'over') {
      ovTitle.textContent = isRecord ? '新纪录！' : '游戏结束';
      ovText.innerHTML = '本局得分 <b>' + score + '</b> · 历史最高 <b>' + best + '</b>';
      ovBtn.textContent = '再玩一次';
    } else {
      ovTitle.textContent = '霓虹贪吃蛇';
      ovText.innerHTML = '滑动屏幕或使用方向键<br>吃满果实，别撞墙也别咬到自己';
      ovBtn.textContent = '开始游戏';
    }
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  /* ---------------- 输入 ---------------- */
  function push(next) {
    if (mode === 'idle' || mode === 'over') start();
    if (mode !== 'running') return;
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (next === last || next === OPPOSITE[last]) return;
    if (queue.length < 3) queue.push(next);
  }

  function bindSwipe() {
    let origin = null;

    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        origin = null;
        return;
      }
      const t = e.touches[0];
      origin = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    wrap.addEventListener('touchmove', (e) => {
      if (!origin || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - origin.x;
      const dy = t.clientY - origin.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (Math.max(ax, ay) < SWIPE_THRESHOLD) return;
      push(ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      origin = { x: t.clientX, y: t.clientY };  // 支持一次拖动连续转向
    }, { passive: false });

    wrap.addEventListener('touchend', () => { origin = null; }, { passive: true });
    wrap.addEventListener('touchcancel', () => { origin = null; }, { passive: true });
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const mapped = KEYMAP[e.key];
      if (mapped) {
        e.preventDefault();
        push(mapped);
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        primaryAction();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePause();
      }
    });
  }

  function bindButtons() {
    document.querySelectorAll('[data-dir]').forEach((btn) => {
      const fire = (e) => {
        e.preventDefault();
        push(btn.dataset.dir);
      };
      btn.addEventListener('pointerdown', fire);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    ovBtn.addEventListener('click', primaryAction);
    pauseBtn.addEventListener('click', () => togglePause());

    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      save(STORAGE_SOUND, soundOn ? 'on' : 'off');
      syncSoundBtn();
      if (soundOn) {
        ensureAudio();
        blip(660, 0.09, 'square', 0.05);
      }
    });
  }

  function syncSoundBtn() {
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.dataset.off = soundOn ? 'false' : 'true';
    soundBtn.setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
  }

  function bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && mode === 'running') togglePause();
    });
    window.addEventListener('blur', () => {
      if (mode === 'running') togglePause();
    });
  }

  /* ---------------- 粒子 ---------------- */
  function burst(gx, gy, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.1 + Math.random() * 3.4;
      particles.push({
        x: gx + 0.5,
        y: gy + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: color || '#ffd166',
      });
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }

  function updateParticles(dtMs) {
    if (!particles.length) return;
    const dt = dtMs / 1000;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 2.2 * dt;
      p.life -= dt * 2.3;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  /* ---------------- 渲染 ---------------- */
  function cellAt(i, t) {
    const cur = snake[i];
    if (!cur) return { x: 0, y: 0 };
    const p = prevSnake[Math.min(i, prevSnake.length - 1)] || cur;
    return { x: p.x + (cur.x - p.x) * t, y: p.y + (cur.y - p.y) * t };
  }

  function toCenter(c) {
    return { x: (c.x + 0.5) * cell, y: (c.y + 0.5) * cell };
  }

  function strokePath(points, width) {
    if (!points.length) return;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (points.length === 1) {
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[0].x + 0.01, points[0].y);
    } else {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  function drawGrid() {
    const size = COLS * cell;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 160, 255, .075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      const px = Math.round(x * cell) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size);
    }
    for (let y = 1; y < ROWS; y++) {
      const py = Math.round(y * cell) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(size, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFood() {
    if (food.x < 0) return;
    const c = toCenter(food);
    const pulse = 1 + Math.sin(clock / 210) * 0.09;
    const radius = cell * 0.33 * pulse;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 90, 122, .9)';
    ctx.shadowBlur = cell * 1.15;
    const grad = ctx.createRadialGradient(
      c.x - cell * 0.12, c.y - cell * 0.13, cell * 0.04,
      c.x, c.y, radius
    );
    grad.addColorStop(0, '#ffe1e8');
    grad.addColorStop(0.42, '#ff5a7a');
    grad.addColorStop(1, '#c01f43');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake(t) {
    if (!snake.length) return;
    const points = [];
    for (let i = 0; i < snake.length; i++) points.push(toCenter(cellAt(i, t)));

    ctx.save();
    // 外层霓虹光晕
    ctx.shadowColor = 'rgba(56, 255, 170, .75)';
    ctx.shadowBlur = cell * 0.95;
    ctx.strokeStyle = '#22c979';
    strokePath(points, cell * 0.86);
    ctx.shadowBlur = 0;
    // 内层高光
    ctx.strokeStyle = '#7dffc0';
    strokePath(points, cell * 0.46);
    ctx.restore();

    drawHead(points[0], headVector(t));
  }

  function headVector(t) {
    const a = cellAt(0, t);
    const b = cellAt(Math.min(1, snake.length - 1), t);
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    if (dx === 0 && dy === 0) {
      const d = DIRS[dir];
      return { x: d.x, y: d.y };
    }
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  function drawHead(p, d) {
    const r = cell * 0.44;
    ctx.save();
    ctx.shadowColor = 'rgba(56, 255, 170, .9)';
    ctx.shadowBlur = cell * 0.8;
    ctx.fillStyle = '#b6ffd9';
    roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.62);
    ctx.fill();
    ctx.restore();

    // 眼睛
    const px = -d.y;
    const py = d.x;
    const forward = cell * 0.14;
    const spread = cell * 0.19;
    const eyeR = cell * 0.105;
    ctx.fillStyle = '#08131f';
    for (let s = -1; s <= 1; s += 2) {
      const ex = p.x + d.x * forward + px * s * spread;
      const ey = p.y + d.y * forward + py * s * spread;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    if (!particles.length) return;
    ctx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * cell, p.y * cell, cell * 0.13 * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render(t) {
    const size = COLS * cell;
    ctx.clearRect(0, 0, size, size);
    drawGrid();
    drawFood();
    drawSnake(t);
    drawParticles();
  }

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    let dt = ts - lastTs;
    lastTs = ts;
    if (dt < 0) dt = 0;
    if (dt > 250) dt = 250;   // 切回标签页时不要一次补太多步
    clock += dt;

    if (mode === 'running') {
      acc += dt;
      let guard = 0;
      while (acc >= stepMs && guard++ < 8) {
        acc -= stepMs;
        step();
        if (mode !== 'running') break;
      }
      if (mode !== 'running') acc = 0;
    }

    updateParticles(dt);
    render(progress());
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    reset();
    syncSoundBtn();
    syncPauseBtn();
    showOverlay('idle');

    bindSwipe();
    bindKeys();
    bindButtons();
    bindVisibility();

    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(stage);
    } else {
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
    }
    resize();
    requestAnimationFrame(loop);

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线能力可选 */ });
      });
    }
  }

  init();
})();
