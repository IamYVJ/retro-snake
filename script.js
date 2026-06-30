/* =====================================================================
   Retro Snake — game logic (vanilla JavaScript)

   Everything lives inside one IIFE so we don't leak anything onto the
   global `window` object. The code is grouped into clear sections:

     1. CONFIG          — knobs you can safely tweak
     2. DOM references  — cached elements
     3. State           — the mutable game state
     4. Persistence     — best score via localStorage
     5. Setup           — reset / food placement
     6. Input           — keyboard, swipe, and on-screen D-pad
     7. Game logic      — the per-step update (move / eat / collide)
     8. Rendering       — drawing the board onto the canvas
     9. Loop            — a fixed-timestep game loop
    10. Screens         — start / pause / game over transitions
    11. Init            — wire everything together
   ===================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1. CONFIG — change these to alter look & feel and difficulty        */
  /* ------------------------------------------------------------------ */
  const CONFIG = {
    // Board layouts, switchable at runtime via the "Screen" toggle. "phone" is
    // the classic square LCD; "wide" is a broader field for laptop/desktop.
    // Each cell renders at cellSize px in the canvas (which is then scaled to
    // fit by CSS), so cols*cellSize x rows*cellSize is the canvas resolution.
    layouts: {
      phone: { cols: 20, rows: 20, cellSize: 20 }, // 1:1 square
      wide:  { cols: 34, rows: 20, cellSize: 20 }  // ~17:10 widescreen
    },
    defaultLayout: 'phone', // used only when the screen can't be auto-detected

    stepMs: 130,         // milliseconds per move at the start (lower = faster)
    minStepMs: 70,       // the fastest the snake is allowed to get
    speedUpEvery: 4,     // speed up after eating this many foods (0 = never)
    speedUpBy: 6,        // milliseconds shaved off each speed-up

    wrap: false,         // default mode: false = walls are deadly, true = "No Walls"
                         // (the player can switch this at runtime via the mode toggle)

    colors: {
      background: '#aebe7e', // keep in sync with --lcd-bg in style.css
      grid: '#a3b173',       // faint "off pixel" dots
      snake: '#1e2a16',      // snake body
      snakeHead: '#0f1a09',  // snake head (slightly darker)
      food: '#1e2a16'        // food
    },

    storageKey: 'retroSnakeBestScore', // best-score prefix (suffixed per layout + mode)
    storageKeyMode: 'retroSnakeMode',  // remembers the last-picked mode
    storageKeyLayout: 'retroSnakeLayout' // remembers the last-picked screen layout
  };

  // Direction vectors. Using objects keeps the movement maths readable.
  const DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 }
  };

  // The finite set of states the game can be in. DYING is the brief window
  // while the death animation plays, before the Game Over overlay appears.
  const State = { READY: 'ready', RUNNING: 'running', PAUSED: 'paused', DYING: 'dying', OVER: 'over' };

  /* ------------------------------------------------------------------ */
  /* 2. DOM references                                                   */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best-score');
  const finalScoreEl = document.getElementById('final-score');
  const finalBestEl = document.getElementById('final-best');

  const startScreen = document.getElementById('start-screen');
  const pauseScreen = document.getElementById('pause-screen');
  const gameoverScreen = document.getElementById('gameover-screen');

  const startBtn = document.getElementById('start-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const dpadButtons = document.querySelectorAll('[data-dir]');
  const modeButtons = document.querySelectorAll('[data-mode]');
  const layoutButtons = document.querySelectorAll('[data-layout]');
  const board = document.getElementById('board');

  /* ------------------------------------------------------------------ */
  /* 3. State                                                            */
  /* ------------------------------------------------------------------ */
  // Current grid dimensions — set by applyLayout() from CONFIG.layouts.
  let cols, rows, cellSize;
  let layout;         // 'phone' (square) or 'wide' (widescreen)
  let snake;          // array of {x, y}; index 0 is the head
  let direction;      // the currently committed direction vector
  let inputQueue;     // buffered upcoming directions (prevents reversing bug)
  let food;           // {x, y}
  let score;
  let best;
  let foodsEaten;
  let stepMs;         // current move interval (shrinks as you speed up)
  let state;
  let lastStepTime;   // timestamp of the previous move
  let rafId;          // requestAnimationFrame handle
  let mode;           // 'classic' (deadly walls) or 'wrap' (edge-to-edge)
  let wrap;           // convenience flag: true when mode === 'wrap'

  /* ------------------------------------------------------------------ */
  /* 4. Persistence — best score, chosen mode, chosen layout             */
  /* ------------------------------------------------------------------ */

  // Each layout + mode combination is really a different game, so each keeps
  // its own high score (e.g. a roomy "wide / No Walls" run can't overwrite the
  // tighter "phone / Walls" record).
  function bestKey() {
    return CONFIG.storageKey + '_' + layout + '_' + mode;
  }

  function loadBest() {
    // localStorage can throw (private mode, disabled storage), so guard it.
    try {
      return parseInt(localStorage.getItem(bestKey()), 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      localStorage.setItem(bestKey(), String(value));
    } catch (err) {
      /* storage unavailable — the score simply won't persist */
    }
  }

  function loadMode() {
    try {
      return localStorage.getItem(CONFIG.storageKeyMode) === 'wrap' ? 'wrap' : 'classic';
    } catch (err) {
      return CONFIG.wrap ? 'wrap' : 'classic';
    }
  }

  // Switch modes: update the flag, remember the choice, and reload the best
  // score for the newly selected mode so the HUD reflects it immediately.
  function setMode(next) {
    mode = (next === 'wrap') ? 'wrap' : 'classic';
    wrap = (mode === 'wrap');
    try {
      localStorage.setItem(CONFIG.storageKeyMode, mode);
    } catch (err) {
      /* storage unavailable — the choice just won't persist */
    }
    best = loadBest();
    updateModeUI();
    updateScoreUI();
  }

  function updateModeUI() {
    modeButtons.forEach(function (btn) {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // Pick the starting layout: a remembered choice wins; otherwise default to
  // "wide" on roomy landscape screens (laptops/desktops) and "phone" elsewhere.
  function loadLayout() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKeyLayout);
      if (saved && CONFIG.layouts[saved]) return saved;
    } catch (err) {
      /* fall through to auto-detection */
    }
    const roomy = window.matchMedia && window.matchMedia('(min-width: 820px)').matches;
    return roomy ? 'wide' : CONFIG.defaultLayout;
  }

  // Resize the canvas + board frame to match the active layout's grid.
  function applyLayout() {
    const L = CONFIG.layouts[layout] || CONFIG.layouts[CONFIG.defaultLayout];
    cols = L.cols;
    rows = L.rows;
    cellSize = L.cellSize;
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    board.style.aspectRatio = cols + ' / ' + rows;
    document.body.classList.toggle('layout-wide', layout === 'wide');
  }

  // Switch layouts: this changes the board size, so it restarts the board.
  // Only reachable from the start / game-over overlays, so resetting is safe.
  function setLayout(next) {
    layout = CONFIG.layouts[next] ? next : CONFIG.defaultLayout;
    try {
      localStorage.setItem(CONFIG.storageKeyLayout, layout);
    } catch (err) {
      /* storage unavailable — the choice just won't persist */
    }
    applyLayout();
    best = loadBest();   // best is tracked per layout + mode
    resetGame();
    render();
    updateLayoutUI();
    updateScoreUI();
  }

  function updateLayoutUI() {
    layoutButtons.forEach(function (btn) {
      const active = btn.dataset.layout === layout;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 5. Setup                                                            */
  /* ------------------------------------------------------------------ */
  function resetGame() {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);

    // Start as a length-3 snake heading right, away from the walls.
    snake = [
      { x: cx,     y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy }
    ];

    direction = DIRS.right;
    inputQueue = [];
    score = 0;
    foodsEaten = 0;
    stepMs = CONFIG.stepMs;

    placeFood();
    updateScoreUI();
  }

  // Drop food on a random cell that the snake doesn't occupy.
  function placeFood() {
    const free = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!isOnSnake(x, y)) free.push({ x: x, y: y });
      }
    }
    // No free cells means the board is full — the player has effectively won.
    if (free.length === 0) return;
    food = free[Math.floor(Math.random() * free.length)];
  }

  function isOnSnake(x, y) {
    return snake.some(function (seg) { return seg.x === x && seg.y === y; });
  }

  /* ------------------------------------------------------------------ */
  /* 6. Input                                                            */
  /* ------------------------------------------------------------------ */

  // Queue a direction change, rejecting no-ops and direct reversals.
  // We compare against the LAST queued direction (or the current one if the
  // queue is empty) so that pressing e.g. Up then Left within a single step
  // can't fold the snake back on itself.
  function queueDirection(name) {
    if (state !== State.RUNNING) return;
    const next = DIRS[name];
    if (!next) return;

    const ref = inputQueue.length ? inputQueue[inputQueue.length - 1] : direction;
    const isSame = next.x === ref.x && next.y === ref.y;
    const isReverse = next.x === -ref.x && next.y === -ref.y;
    if (isSame || isReverse) return;

    // Buffer at most two turns; more than that just feels laggy.
    if (inputQueue.length < 2) inputQueue.push(next);
  }

  // Map both arrow keys and WASD to directions.
  const KEY_MAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  function onKeyDown(e) {
    // Pause / resume with Space or P.
    if (e.code === 'Space' || e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
      return;
    }

    // Enter starts the game from the start or game-over screen.
    if (e.code === 'Enter') {
      if (state === State.READY || state === State.OVER) {
        e.preventDefault();
        startGame();
      }
      return;
    }

    const dir = KEY_MAP[e.code];
    if (dir) {
      e.preventDefault(); // stop arrow keys from scrolling the page
      queueDirection(dir);
    }
  }

  // --- Touch swipe handling on the board ---
  let touchStart = null;
  const SWIPE_THRESHOLD = 24; // minimum px travel to register as a swipe

  function onTouchStart(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (t) touchStart = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!touchStart || !t) return;

    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;

    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_THRESHOLD) {
      if (Math.abs(dx) > Math.abs(dy)) {
        queueDirection(dx > 0 ? 'right' : 'left');
      } else {
        queueDirection(dy > 0 ? 'down' : 'up');
      }
    }
    touchStart = null;
  }

  /* ------------------------------------------------------------------ */
  /* 7. Game logic — advance the simulation by one step                  */
  /* ------------------------------------------------------------------ */
  function step() {
    // Commit one buffered turn this tick.
    if (inputQueue.length) direction = inputQueue.shift();

    const head = snake[0];
    let nx = head.x + direction.x;
    let ny = head.y + direction.y;

    if (wrap) {
      // "No Walls" mode: slide off one edge and reappear on the opposite one.
      nx = (nx + cols) % cols;
      ny = (ny + rows) % rows;
    } else if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
      // Hit a wall.
      gameOver();
      return;
    }

    const willEat = food && nx === food.x && ny === food.y;

    // Self-collision: ignore the current tail cell because it will move out
    // of the way this tick — unless we're growing, in which case it stays.
    const body = willEat ? snake : snake.slice(0, snake.length - 1);
    if (body.some(function (seg) { return seg.x === nx && seg.y === ny; })) {
      gameOver();
      return;
    }

    // Grow by adding the new head.
    snake.unshift({ x: nx, y: ny });

    if (willEat) {
      score += 1;
      foodsEaten += 1;

      // Gradually ramp up the speed for a rising difficulty curve.
      if (CONFIG.speedUpEvery > 0 && foodsEaten % CONFIG.speedUpEvery === 0) {
        stepMs = Math.max(CONFIG.minStepMs, stepMs - CONFIG.speedUpBy);
      }

      placeFood();
      updateScoreUI();
    } else {
      // Not eating: drop the tail so the snake appears to move.
      snake.pop();
    }
  }

  function updateScoreUI() {
    scoreEl.textContent = score;
    // While playing, show the live best so it ticks up the moment you beat your
    // record. Otherwise show the stored best for the current mode — this keeps
    // the HUD correct when you switch modes between games.
    bestEl.textContent = (state === State.RUNNING) ? Math.max(best, score) : best;
  }

  /* ------------------------------------------------------------------ */
  /* 8. Rendering                                                        */
  /* ------------------------------------------------------------------ */
  // Draws the board for a given list of snake segments (head at index 0).
  // Defaults to the live snake; the death animation passes a shrinking list.
  function render(segments) {
    const segs = segments || snake;

    // Background wash.
    ctx.fillStyle = CONFIG.colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Faint dot grid to sell the LCD look.
    drawGrid();

    // Food.
    if (food) drawFood();

    // Snake — draw tail first so the head sits on top.
    for (let i = segs.length - 1; i >= 0; i--) {
      ctx.fillStyle = (i === 0) ? CONFIG.colors.snakeHead : CONFIG.colors.snake;
      drawCell(segs[i].x, segs[i].y);
    }
  }

  // A cell drawn with a small inset so segments read as chunky pixels.
  function drawCell(x, y) {
    const s = cellSize;
    const pad = Math.max(1, Math.floor(s * 0.12));
    ctx.fillRect(x * s + pad, y * s + pad, s - pad * 2, s - pad * 2);
  }

  function drawGrid() {
    const s = cellSize;
    const dot = Math.max(1, Math.floor(s * 0.08));
    const offset = (s - dot) / 2;
    ctx.fillStyle = CONFIG.colors.grid;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillRect(x * s + offset, y * s + offset, dot, dot);
      }
    }
  }

  // Food is a little diamond so it reads differently from the square snake.
  function drawFood() {
    const s = cellSize;
    const cx = food.x * s + s / 2;
    const cy = food.y * s + s / 2;
    const r = s * 0.3;
    ctx.fillStyle = CONFIG.colors.food;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }

  /* ------------------------------------------------------------------ */
  /* 9. Game loop — fixed timestep driven by requestAnimationFrame       */
  /* ------------------------------------------------------------------ */
  function loop(now) {
    // Schedule the next frame up front so an exception mid-step doesn't
    // silently stop the loop.
    rafId = requestAnimationFrame(loop);

    const elapsed = now - lastStepTime;
    if (elapsed >= stepMs) {
      // Snap forward by whole steps so timing stays stable after a slow frame.
      lastStepTime = now - (elapsed % stepMs);
      step();
    }

    render();
  }

  function startLoop() {
    lastStepTime = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    cancelAnimationFrame(rafId);
  }

  /* ------------------------------------------------------------------ */
  /* 10. Screens / transitions                                           */
  /* ------------------------------------------------------------------ */
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function startGame() {
    resetGame();
    state = State.RUNNING;
    hide(startScreen);
    hide(gameoverScreen);
    hide(pauseScreen);
    startLoop();
  }

  function togglePause() {
    if (state === State.RUNNING) {
      state = State.PAUSED;
      stopLoop();
      show(pauseScreen);
    } else if (state === State.PAUSED) {
      state = State.RUNNING;
      hide(pauseScreen);
      startLoop();
    }
  }

  function gameOver() {
    // Stop the normal loop and play a short death animation before revealing
    // the overlay — snapping straight to "GAME OVER" felt abrupt.
    state = State.DYING;
    stopLoop();

    if (score > best) {
      best = score;
      saveBest(best);
    }

    board.classList.add('board--hit'); // a quick screen shake on impact (CSS)
    playDeath(showGameOver);
  }

  // An LCD-style death sequence: the screen blanks dark on the hit, the snake
  // blinks a few times, then drains away tail-to-head. Honours the user's
  // reduced-motion preference by skipping straight to the overlay.
  function playDeath(done) {
    const reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { render([]); done(); return; }

    const corpse = snake.slice(); // freeze the snake at the moment of death
    const total = corpse.length;
    const start = performance.now();

    const FLASH_MS = 90;       // screen blanks dark on the hit
    const BLINK_MS = 420;      // then the snake flashes on/off
    const BLINK_PERIOD = 140;  // one on+off cycle
    const DRAIN_MS = 460;      // then it retracts into nothing
    const endMs = FLASH_MS + BLINK_MS + DRAIN_MS;

    function frame(now) {
      if (state !== State.DYING) return; // a new game began — abandon the animation
      const t = now - start;

      if (t < FLASH_MS) {
        ctx.fillStyle = CONFIG.colors.snake; // dark impact flash
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (t < FLASH_MS + BLINK_MS) {
        const on = Math.floor((t - FLASH_MS) / (BLINK_PERIOD / 2)) % 2 === 0;
        render(on ? corpse : []);
      } else if (t < endMs) {
        const p = (t - FLASH_MS - BLINK_MS) / DRAIN_MS;
        const keep = Math.max(0, Math.ceil(total * (1 - p)));
        render(corpse.slice(0, keep));
      } else {
        render([]);
        done();
        return;
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
  }

  function showGameOver() {
    state = State.OVER;
    board.classList.remove('board--hit');
    finalScoreEl.textContent = score;
    finalBestEl.textContent = best;
    updateScoreUI();
    show(gameoverScreen);
  }

  /* ------------------------------------------------------------------ */
  /* 11. Init — wire up events and draw the first frame                  */
  /* ------------------------------------------------------------------ */
  function init() {
    layout = loadLayout(); // restore (or auto-pick) the screen layout first...
    applyLayout();         // ...so the canvas is sized before anything is drawn
    updateLayoutUI();
    setMode(loadMode());   // restore the last-played mode (sets `best` too)
    resetGame();           // populate the board so it isn't blank behind...
    state = State.READY;   // ...the start overlay
    render();

    // Keyboard.
    document.addEventListener('keydown', onKeyDown);

    // Buttons.
    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', startGame);
    resumeBtn.addEventListener('click', togglePause);

    // pointerdown feels instant on touch devices; preventDefault stops the
    // synthetic mouse events and focus jumps that would otherwise follow.
    pauseBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      togglePause();
    });

    dpadButtons.forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        queueDirection(btn.dataset.dir);
      });
    });

    // Mode toggle on the start / game-over screens.
    modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.dataset.mode);
      });
    });

    // Screen-layout toggle on the start / game-over screens.
    layoutButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLayout(btn.dataset.layout);
      });
    });

    // Touch swipes on the board. touchmove is non-passive so we can block
    // the page from scrolling while a swipe is in progress.
    board.addEventListener('touchstart', onTouchStart, { passive: true });
    board.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    board.addEventListener('touchend', onTouchEnd, { passive: true });

    // Auto-pause if the tab is hidden so the snake doesn't run off-screen.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === State.RUNNING) togglePause();
    });
  }

  init();
})();
