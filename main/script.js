(() => {
  const setupEl = document.getElementById("setup");
  const hudEl = document.getElementById("hud");
  const titleEl = document.getElementById("title");
  const boardEl = document.getElementById("board");
  const maskEl = document.getElementById("pauseMask");
  const flagsEl = document.getElementById("flags");
  const timerEl = document.getElementById("timer");
  const pauseBtn = document.getElementById("pauseBtn");
  const swapToggle = document.getElementById("swapToggle");
  const messageEl = document.getElementById("message");

  let W, H, M, seedText;
  let cells = [];
  let biggestRegion = new Set();
  let gameOver = false;
  let running = false;
  let paused = false;
  let swapClicks = false;

  let openedCount = 0;
  let startTime = null;
  let pausedAt = null;
  let totalPaused = 0;
  let timerId = null;

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function() {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRandom(seed) {
    return mulberry32(xmur3(seed)());
  }

  function idx(x, y) {
    return y * W + x;
  }

  function coords(i) {
    return [i % W, Math.floor(i / W)];
  }

  function neighbors(i) {
    const [x, y] = coords(i);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(idx(nx, ny));
      }
    }
    return out;
  }

  function clamp(n, lo, hi) {
    if (Number.isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function buildBoard() {
    W = clamp(parseInt(document.getElementById("width").value, 10), 5, 60);
    H = clamp(parseInt(document.getElementById("height").value, 10), 5, 40);
    M = parseInt(document.getElementById("mines").value, 10);
    seedText = document.getElementById("seed").value.trim() || "default";

    const maxMines = W * H - 9;
    M = clamp(M, 1, Math.max(1, maxMines));

    const cellSize = clamp(parseInt(document.getElementById("cellSize").value, 10), 16, 50);
    document.documentElement.style.setProperty("--cell", cellSize + "px");

    cells = Array.from({ length: W * H }, (_, i) => ({
      i,
      mine: false,
      num: 0,
      open: false,
      flag: false,
      question: false,
      el: null
    }));

    const rng = seededRandom(`${seedText}|${W}x${H}|${M}`);
    const all = [...Array(W * H).keys()];
    shuffle(all, rng);

    for (let k = 0; k < M; k++) cells[all[k]].mine = true;

    for (const c of cells) {
      if (!c.mine) c.num = neighbors(c.i).filter(n => cells[n].mine).length;
    }

    biggestRegion = findBiggestZeroRegion();

    gameOver = false;
    running = true;
    paused = false;
    openedCount = 0;
    startTime = null;
    pausedAt = null;
    totalPaused = 0;
    clearInterval(timerId);

    setupEl.classList.add("hidden-ui");
    titleEl.classList.add("hidden-ui");
    hudEl.classList.remove("hidden-ui");

    render();
    updateHUD();

    const regionSize = biggestRegion.size;
    messageEl.textContent = `Biggest empty region size: ${regionSize}`;
  }

  function findBiggestZeroRegion() {
    const seen = new Set();
    let best = [];

    for (const c of cells) {
      if (c.mine || c.num !== 0 || seen.has(c.i)) continue;

      const region = [];
      const q = [c.i];
      seen.add(c.i);

      while (q.length) {
        const cur = q.shift();
        region.push(cur);

        for (const n of neighbors(cur)) {
          if (!seen.has(n) && !cells[n].mine && cells[n].num === 0) {
            seen.add(n);
            q.push(n);
          }
        }
      }

      if (region.length > best.length) best = region;
    }

    return new Set(best);
  }

  function render() {
    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = `repeat(${W}, var(--cell))`;

    for (const c of cells) {
      const el = document.createElement("div");
      el.className = "cell hidden";
      el.dataset.i = c.i;

      el.addEventListener("click", e => {
        e.preventDefault();
        if (paused) return;

        if (e.shiftKey) {
          toggleQuestion(c.i);
          return;
        }

        swapClicks ? doRightAction(c.i) : reveal(c.i);
      });

      el.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        if (paused) return;

        swapClicks ? reveal(c.i) : doRightAction(c.i);
      });

      c.el = el;
      boardEl.appendChild(el);
    }

    paint();
  }

  function paint() {
    for (const c of cells) {
      const el = c.el;
      el.className = "cell";

      if (c.open) {
        el.classList.add("open");

        if (c.num > 0 && isChordable(c.i)) {
          el.classList.add("chordable");
        }

        el.textContent = c.mine ? "💣" : (c.num || "");
        if (c.num) el.classList.add("n" + c.num);
      } else {
        el.classList.add("hidden");

        if (biggestRegion.has(c.i)) el.classList.add("region");

        if (c.flag) {
          el.classList.add("flagged");
          el.textContent = "🚩";
        } else if (c.question) {
          el.classList.add("question");
          el.textContent = "?";
        } else {
          el.textContent = "";
        }
      }
    }
  }

  function isChordable(i) {
    const c = cells[i];
    if (!c.open || c.num <= 0) return false;
    const ns = neighbors(i);
    const flags = ns.filter(n => cells[n].flag).length;
    const unopened = ns.some(n => !cells[n].open && !cells[n].flag);
    return flags === c.num && unopened;
  }

  function startTimer() {
    if (startTime) return;
    startTime = Date.now();
    timerId = setInterval(updateHUD, 100);
  }

  function reveal(i) {
    if (gameOver || paused) return;

    const c = cells[i];
    if (c.open || c.flag) return;

    startTimer();

    if (c.mine) {
      c.open = true;
      c.el.classList.add("mine-hit");
      lose();
      return;
    }

    c.question = false;
    floodReveal(i);
    paint();
    checkWin();
  }

  function floodReveal(i) {
    const q = [i];
    const seen = new Set();

    while (q.length) {
      const cur = q.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);

      const c = cells[cur];
      if (c.open || c.flag || c.mine) continue;

      c.open = true;
      c.question = false;
      openedCount++;

      if (c.num === 0) {
        for (const n of neighbors(cur)) {
          if (!seen.has(n) && !cells[n].mine && !cells[n].flag) q.push(n);
        }
      }
    }
  }

  function doRightAction(i) {
    if (gameOver || paused) return;

    const c = cells[i];

    if (!c.open) {
      if (c.question) c.question = false;
      c.flag = !c.flag;
      paint();
      updateHUD();
      return;
    }

    chord(i);
  }

  function chord(i) {
    const c = cells[i];
    if (!c.open || c.num <= 0) return;

    const ns = neighbors(i);
    const flags = ns.filter(n => cells[n].flag).length;
    if (flags !== c.num) return;

    startTimer();

    for (const n of ns) {
      if (!cells[n].flag && !cells[n].open) {
        if (cells[n].mine) {
          cells[n].open = true;
          lose();
          return;
        }
        floodReveal(n);
      }
    }

    paint();
    checkWin();
  }

  function toggleQuestion(i) {
    if (gameOver || paused) return;

    const c = cells[i];
    if (c.open || c.flag) return;

    c.question = !c.question;
    paint();
  }

  function lose() {
    gameOver = true;
    clearInterval(timerId);

    for (const c of cells) {
      if (c.mine) c.open = true;
    }

    paint();
    updateHUD();
    alert("Boom. You lost.");
  }

  function checkWin() {
    if (openedCount === W * H - M) {
      gameOver = true;
      clearInterval(timerId);

      for (const c of cells) {
        if (c.mine) c.flag = true;
      }

      paint();
      updateHUD();
      alert(`Cleared! Time: ${elapsed()}s`);
    }

    updateHUD();
  }

  function updateHUD() {
    const flags = cells.filter(c => c.flag).length;
    flagsEl.textContent = `Flags: ${flags}/${M}`;
    timerEl.textContent = `Time: ${elapsed()}s`;
  }

  function elapsed() {
    if (!startTime) return "0.0";

    const now = paused ? pausedAt : Date.now();
    return ((now - startTime - totalPaused) / 1000).toFixed(1);
  }

  function togglePause() {
    if (!running || gameOver) return;

    paused = !paused;

    if (paused) {
      pausedAt = Date.now();
      clearInterval(timerId);
      pauseBtn.textContent = "Resume";
      maskEl.classList.add("show");
    } else {
      totalPaused += Date.now() - pausedAt;
      pausedAt = null;
      pauseBtn.textContent = "Pause";
      maskEl.classList.remove("show");

      if (startTime) timerId = setInterval(updateHUD, 100);
    }

    updateHUD();
  }

  function resetToSetup() {
    clearInterval(timerId);
    running = false;
    paused = false;
    gameOver = false;
    maskEl.classList.remove("show");
    pauseBtn.textContent = "Pause";
    boardEl.innerHTML = "";
    hudEl.classList.add("hidden-ui");
    setupEl.classList.remove("hidden-ui");
    titleEl.classList.remove("hidden-ui");
  }

  document.addEventListener("contextmenu", e => {
    if (running) e.preventDefault();
  });

  document.getElementById("startBtn").addEventListener("click", buildBoard);
  document.getElementById("resetBtn").addEventListener("click", resetToSetup);
  pauseBtn.addEventListener("click", togglePause);

  swapToggle.addEventListener("click", () => {
    swapClicks = !swapClicks;
    swapToggle.textContent = swapClicks ? "Swapped" : "Normal";
  });
})();
