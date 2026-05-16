// Minesweeper Game Module
import { rateBoard, getNextHint } from "./solver.js";

const setupEl = document.getElementById("setup");
const hudEl = document.getElementById("hud");
const titleEl = document.getElementById("title");
const boardEl = document.getElementById("board");
const maskEl = document.getElementById("pauseMask");
const flagsEl = document.getElementById("flags");
const timerEl = document.getElementById("timer");
const pauseBtn = document.getElementById("pauseBtn");
const swapToggle = document.getElementById("swapToggle");

let W, H, M, seedText;
let cells = [];
let biggestRegion = new Set();
let gameOver = false;
let running = false;
let paused = false;
let swapClicks = false;

let openedCount = 0;
let firstMoveDone = false;
let startTime = null;
let pausedAt = null;
let totalPaused = 0;
let timerId = null;

// ── Hint state ────────────────────────────────
let activeHint = null; // { tier, type, cells[], explanation }
const HINT_COLORS = ["#67e8f9", "#c4b5fd", "#fda4af", "#86efac", "#fde68a", "#f9a8d4", "#93c5fd", "#fdba74"];

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function hintLabelToIndex(label) {
    const match = /^r(\d+)c(\d+)$/i.exec(label);
    if (!match) return null;
    const row = parseInt(match[1], 10);
    const col = parseInt(match[2], 10);
    if (row < 1 || col < 1 || row > H || col > W) return null;
    return (row - 1) * W + (col - 1);
}

function getHintColorMap(text) {
    const map = new Map();
    if (!text) return map;
    for (const match of text.matchAll(/\br\d+c\d+\b/gi)) {
        const label = match[0].toLowerCase();
        const cellIndex = hintLabelToIndex(label);
        if (cellIndex === null || map.has(cellIndex)) continue;
        map.set(cellIndex, HINT_COLORS[map.size % HINT_COLORS.length]);
    }
    return map;
}

function formatHintText(text) {
    const colorMap = getHintColorMap(text);
    const labelColorMap = new Map();
    for (const [cellIndex, color] of colorMap) {
        const row = Math.floor(cellIndex / W) + 1;
        const col = (cellIndex % W) + 1;
        labelColorMap.set(`r${row}c${col}`, color);
    }

    return escapeHtml(text)
        .replace(/\br\d+c\d+\b/gi, label => {
            const color = labelColorMap.get(label.toLowerCase());
            if (!color) return label;
            return `<span class="hint-cell-ref" style="--hint-color:${color}">${label}</span>`;
        })
        .replace(/\n\n/g, "<br><br>");
}

function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}

function mulberry32(a) {
    return function () {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededRandom(seed) {
    return mulberry32(xmur3(seed)());
}

function getSeedNumber(seed, w, h, m) {
    const str = `${seed}|${w}x${h}|${m}`;
    let h1 = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h1 ^= str.charCodeAt(i);
        h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    return h1 % 1000000;
}

function getDailySeed() {
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rng = seededRandom(dateStr);
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(rng() * chars.length)];
    return s;
}

function resolveActualSeed(input) {
    const trimmed = input.replace(/^#/, '').trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${trimmed}::${dateStr}`;
}

function seedToNumeric(resolvedSeed) {
    let h = 0;
    for (let i = 0; i < resolvedSeed.length; i++) {
        h = Math.imul(h ^ resolvedSeed.charCodeAt(i), 0x9e3779b9) >>> 0;
        h = ((h << 5) | (h >>> 27)) >>> 0;
    }
    let h2 = h ^ 0xdeadbeef;
    for (let i = resolvedSeed.length - 1; i >= 0; i--) {
        h2 = Math.imul(h2 ^ resolvedSeed.charCodeAt(i), 0x85ebca77) >>> 0;
        h2 = ((h2 >>> 13) ^ h2) >>> 0;
    }
    const combined = ((h >>> 0) * 100000 + (h2 >>> 0) % 100000) >>> 0;
    return combined % 100000000000;
}

const NUMERIC_SEED_MAP_KEY = "minesweeper-numeric-map";

function seedToNumericStable(resolvedSeed) {
    if (/^\d+$/.test(resolvedSeed)) return parseInt(resolvedSeed, 10);
    const raw = localStorage.getItem(NUMERIC_SEED_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (map[resolvedSeed]) return map[resolvedSeed];
    let num = seedToNumeric(resolvedSeed);
    const usedVals = new Set(Object.values(map));
    while (usedVals.has(num)) num = (num + 1) % 100000000000;
    map[resolvedSeed] = num;
    localStorage.setItem(NUMERIC_SEED_MAP_KEY, JSON.stringify(map));
    return num;
}

const STORAGE_KEY = "minesweeper-settings";

function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        width: document.getElementById("width").value,
        height: document.getElementById("height").value,
        mines: document.getElementById("mines").value,
        cellSize: document.getElementById("cellSize").value,
        swapClicks
    }));
}

function loadSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        const s = JSON.parse(raw);
        document.getElementById("width").value = s.width;
        document.getElementById("height").value = s.height;
        document.getElementById("mines").value = s.mines;
        document.getElementById("cellSize").value = s.cellSize;
        if (s.swapClicks !== undefined) {
            swapClicks = s.swapClicks;
            document.getElementById("swapToggle").textContent = swapClicks ? "Swapped" : "Normal";
        }
    } catch { }
}

function idx(x, y) { return y * W + x; }
function coords(i) { return [i % W, Math.floor(i / W)]; }

function neighbors(i) {
    const [x, y] = coords(i);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(idx(nx, ny));
        }
    }
    return out;
}

function clamp(n, lo, hi) {
    if (Number.isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

function buildBoard() {
    W = clamp(parseInt(document.getElementById("width").value, 10), 5, 60);
    H = clamp(parseInt(document.getElementById("height").value, 10), 5, 40);
    M = parseInt(document.getElementById("mines").value, 10);

    const rawInput = document.getElementById("seed").value.trim() || "default";
    const resolved = resolveActualSeed(rawInput);
    seedText = resolved;

    const maxMines = W * H - 9;
    M = clamp(M, 1, Math.max(1, maxMines));

    const cellSize = clamp(parseInt(document.getElementById("cellSize").value, 10), 16, 50);
    document.documentElement.style.setProperty("--cell", cellSize + "px");

    saveSettings();

    cells = Array.from({ length: W * H }, (_, i) => ({
        i, mine: false, num: 0, open: false, flag: false, question: false, el: null
    }));

    const numericId = seedToNumericStable(resolved);
    const rng = seededRandom(`${numericId}|${W}x${H}|${M}`);

    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    const weights = Array.from({ length: W * H }, (_, i) => {
        const x = i % W, y = Math.floor(i / W);
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        return 0.1 + (dist / maxDist) * 0.9;
    });

    const available = [...Array(W * H).keys()];
    const chosen = [];
    for (let k = 0; k < M; k++) {
        const totalW = available.reduce((s, i) => s + weights[i], 0);
        let r = rng() * totalW;
        let picked = available.length - 1;
        for (let j = 0; j < available.length; j++) {
            r -= weights[available[j]];
            if (r <= 0) { picked = j; break; }
        }
        chosen.push(available[picked]);
        available.splice(picked, 1);
    }

    for (let k = 0; k < M; k++) cells[chosen[k]].mine = true;
    for (const c of cells) {
        if (!c.mine) c.num = neighbors(c.i).filter(n => cells[n].mine).length;
    }

    biggestRegion = findBiggestZeroRegion();
    firstMoveDone = false;

    gameOver = false;
    running = true;
    paused = false;
    openedCount = 0;
    startTime = null;
    pausedAt = null;
    totalPaused = 0;
    clearInterval(timerId);
    activeHint = null;
    clearHintUI();

    setupEl.classList.add("hidden-ui");
    titleEl.classList.add("hidden-ui");
    hudEl.classList.remove("hidden-ui");

    render();
    updateHUD();
}

function findBiggestZeroRegionMini(miniCells, pw, ph) {
    const seen = new Set();
    let best = new Set();
    for (let i = 0; i < pw * ph; i++) {
        if (miniCells[i].mine || miniCells[i].num !== 0 || seen.has(i)) continue;
        const region = [], q = [i];
        seen.add(i);
        while (q.length) {
            const cur = q.shift(); region.push(cur);
            const cx = cur % pw, cy = Math.floor(cur / pw);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx >= 0 && nx < pw && ny >= 0 && ny < ph) {
                    const ni = ny * pw + nx;
                    if (!seen.has(ni) && !miniCells[ni].mine && miniCells[ni].num === 0) { seen.add(ni); q.push(ni); }
                }
            }
        }
        if (region.length > best.size) best = new Set(region);
    }
    return best;
}

function regionCenterScore(region, W, H) {
    const cx = W / 2, cy = H / 2;
    let score = 0;
    for (const i of region) {
        const x = i % W, y = Math.floor(i / W);
        score += Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    }
    return score / region.length;
}

function findBiggestZeroRegion() {
    const seen = new Set();
    const regions = [];

    for (const c of cells) {
        if (c.mine || c.num !== 0 || seen.has(c.i)) continue;
        const region = [], q = [c.i];
        seen.add(c.i);
        while (q.length) {
            const cur = q.shift();
            region.push(cur);
            for (const n of neighbors(cur)) {
                if (!seen.has(n) && !cells[n].mine && cells[n].num === 0) { seen.add(n); q.push(n); }
            }
        }
        regions.push(region);
    }

    if (!regions.length) return new Set();

    const maxSize = Math.max(...regions.map(r => r.length));
    const threshold = maxSize * 0.75;
    const candidates = regions.filter(r => r.length >= threshold);

    let best = candidates[0], bestScore = Infinity;
    for (const r of candidates) {
        const score = regionCenterScore(r, W, H);
        if (score < bestScore) { bestScore = score; best = r; }
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
            clearHint();
            if (e.shiftKey) { toggleQuestion(c.i); return; }
            swapClicks ? doRightAction(c.i) : reveal(c.i);
        });

        el.addEventListener("contextmenu", e => {
            e.preventDefault();
            e.stopPropagation();
            if (paused) return;
            clearHint();
            swapClicks ? reveal(c.i) : doRightAction(c.i);
        });

        c.el = el;
        boardEl.appendChild(el);
    }

    paint();
}

function paint() {
    const hintSet = activeHint ? new Set(activeHint.cells) : new Set();
    const srcSet = activeHint?.source !== undefined ? new Set([activeHint.source]) : new Set();
    const hintColorMap = getHintColorMap(activeHint?.explanation || "");

    for (const c of cells) {
        const el = c.el;
        el.className = "cell";
        el.style.removeProperty("--hint-color");

        if (c.open) {
            el.classList.add("open");
            if (c.num > 0 && isChordable(c.i)) el.classList.add("chordable");
            el.textContent = c.mine ? "💣" : (c.num || "");
            if (c.num) el.classList.add("n" + c.num);
        } else {
            el.classList.add("hidden");
            if (biggestRegion.has(c.i)) el.classList.add("region");
            if (c.flag) { el.classList.add("flagged"); el.textContent = "🚩"; }
            else if (c.question) { el.classList.add("question"); el.textContent = "?"; }
            else el.textContent = "";
        }

        // Hint overlays
        if (srcSet.has(c.i)) el.classList.add("hint-source");
        if (hintSet.has(c.i)) {
            el.classList.add(activeHint.type === "flag" ? "hint-flag" : activeHint.type === "guess" ? "hint-guess" : "hint-open");
        }
        if (hintColorMap.has(c.i)) {
            el.style.setProperty("--hint-color", hintColorMap.get(c.i));
            el.classList.add("hint-cell-highlight");
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

    if (!firstMoveDone) {
        firstMoveDone = true;
        if (biggestRegion.size > 0) {
            const regionArr = [...biggestRegion];
            floodReveal(regionArr[0]);
            paint();
            checkWin();
            return;
        }
    }

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
    const q = [i], seen = new Set();
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
        if (!firstMoveDone) {
            firstMoveDone = true;
            startTimer();
            if (biggestRegion.size > 0) { floodReveal([...biggestRegion][0]); paint(); checkWin(); return; }
        }
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
            if (cells[n].mine) { cells[n].open = true; lose(); return; }
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
    if (!firstMoveDone) {
        firstMoveDone = true;
        startTimer();
        if (biggestRegion.size > 0) { floodReveal([...biggestRegion][0]); paint(); checkWin(); return; }
    }
    c.question = !c.question;
    paint();
}

function lose() {
    gameOver = true;
    clearInterval(timerId);
    clearHint();
    for (const c of cells) { if (c.mine) c.open = true; }
    paint();
    updateHUD();
    alert("Boom. You lost.");
}

function checkWin() {
    if (openedCount === W * H - M) {
        gameOver = true;
        clearInterval(timerId);
        clearHint();
        for (const c of cells) { if (c.mine) c.flag = true; }
        paint();
        updateHUD();
        const t = parseFloat(elapsed());
        const diff = activeDiff || "custom";
        const seedNum = getSeedNumber(seedText, W, H, M);
        saveStatWin(diff, t, seedText, seedNum, W, H, M);
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
    clearHint();
    document.getElementById("seed").value = getDailySeed();
}

// ── HINT SYSTEM ───────────────────────────────
function clearHint() {
    activeHint = null;
    clearHintUI();
    paint();
}

function clearHintUI() {
    const panel = document.getElementById("hintPanel");
    if (panel) panel.classList.add("hidden-ui");
}

function showHint() {
    if (!running || gameOver || paused) return;
    if (!firstMoveDone) {
        showHintPanel("💡", "Click any green cell to start — it opens the largest safe region automatically.", "hint-open");
        return;
    }
    const hint = getNextHint(cells, W, H, M);
    if (!hint) {
        showHintPanel("✅", "The board looks solved or no further moves detected.", "");
        return;
    }
    activeHint = hint;
    const tierLabels = { 1: "Basic", 2: "Intermediate", 3: "Advanced", 4: "Deep logic", 5: "Guess" };
    const tier = tierLabels[hint.tier] || "";
    showHintPanel(`💡 ${tier}`, hint.explanation, hint.type === "flag" ? "hint-flag-panel" : hint.type === "guess" ? "hint-guess-panel" : "hint-open-panel");
    paint();
}

function showHintPanel(title, text, cls) {
    const panel = document.getElementById("hintPanel");
    if (!panel) return;
    panel.className = "hint-panel " + (cls || "");
    panel.classList.remove("hidden-ui");
    const formatted = formatHintText(text);
    panel.innerHTML = `<span class="hint-title">${title}</span><span class="hint-text">${formatted}</span><button class="hint-close btn-icon" onclick="this.closest('.hint-panel').classList.add('hidden-ui'); activeHint=null; paint()">✕</button>`;
}

document.addEventListener("contextmenu", e => { if (running) e.preventDefault(); });

document.getElementById("startBtn").addEventListener("click", buildBoard);
document.getElementById("resetBtn").addEventListener("click", resetToSetup);
document.getElementById("hintBtn").addEventListener("click", showHint);

document.getElementById("randomBtn").addEventListener("click", () => {
    document.getElementById("seed").value = Math.random().toString(36).slice(2, 10);
    activeDiff = null;
    document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
    schedulePreview();
});

document.getElementById("copyBtn").addEventListener("click", async () => {
    const seed = document.getElementById("seed").value.trim() || "default";
    const w = clamp(parseInt(document.getElementById("width").value, 10), 5, 60);
    const h = clamp(parseInt(document.getElementById("height").value, 10), 5, 40);
    const m = clamp(parseInt(document.getElementById("mines").value, 10), 1, w * h - 9);
    const num = getSeedNumber(seed, w, h, m);
    const v = `#${num}`;
    try {
        await navigator.clipboard.writeText(v);
    } catch {
        const ta = document.createElement("textarea");
        ta.value = v; ta.style.position = "fixed"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
    }
});

pauseBtn.addEventListener("click", togglePause);
swapToggle.addEventListener("click", () => {
    swapClicks = !swapClicks;
    swapToggle.textContent = swapClicks ? "Swapped" : "Normal";
});

// ── DIFFICULTY PRESETS ────────────────────────
const DIFFICULTIES = {
    easy: { w: 9, h: 9, m: 10, label: "Easy" },
    medium: { w: 16, h: 16, m: 40, label: "Medium" },
    hard: { w: 30, h: 16, m: 99, label: "Hard" },
    expert: { w: 30, h: 20, m: 145, label: "Expert" },
    master: { w: 40, h: 25, m: 250, label: "Master" },
};

const STATS_KEY = "minesweeper-stats";

function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { return {}; }
}

function saveStatWin(diff, time, seed, seedNum, w, h, m) {
    const stats = loadStats();
    if (!stats[diff]) stats[diff] = { wins: 0, best: null, total: 0, runs: [] };
    stats[diff].wins++;
    stats[diff].total += time;
    if (stats[diff].best === null || time < stats[diff].best) stats[diff].best = time;
    stats[diff].runs.unshift({ time, seed, seedNum, w, h, m, date: Date.now() });
    if (stats[diff].runs.length > 100) stats[diff].runs.length = 100;
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

let activeDiff = null;

function setDifficulty(key) {
    const d = DIFFICULTIES[key];
    if (!d) return;
    activeDiff = key;
    document.getElementById("width").value = d.w;
    document.getElementById("height").value = d.h;
    document.getElementById("mines").value = d.m;
    document.querySelectorAll(".diff-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.diff === key)
    );
    renderStats(key);
    schedulePreview();
}

function renderStats(key) {
    const box = document.getElementById("statsBox");
    const stats = loadStats();
    const s = stats[key];
    box.classList.toggle("visible", !!s);
    if (!s) return;
    const avg = s.wins > 0 ? (s.total / s.wins).toFixed(1) : "-";
    const best = s.best !== null ? s.best.toFixed(1) : "-";
    box.innerHTML = `
    <div class="stats-title">${DIFFICULTIES[key].label} Stats</div>
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-val">${s.wins}</div><div class="stat-lbl">Wins</div></div>
      <div class="stat-item"><div class="stat-val">${best}s</div><div class="stat-lbl">Best</div></div>
      <div class="stat-item"><div class="stat-val">${avg}s</div><div class="stat-lbl">Avg</div></div>
    </div>`;
}

document.querySelectorAll(".diff-btn").forEach(b =>
    b.addEventListener("click", () => setDifficulty(b.dataset.diff))
);

let activeStatsTab = "easy";

function openStats() {
    document.getElementById("statsModal").classList.remove("hidden-ui");
    renderStatsModal(activeStatsTab);
}

function closeStats() {
    document.getElementById("statsModal").classList.add("hidden-ui");
}

function renderStatsModal(tab) {
    activeStatsTab = tab;
    document.querySelectorAll(".stats-tab").forEach(b =>
        b.classList.toggle("active", b.dataset.tab === tab)
    );
    const stats = loadStats();
    const s = stats[tab];
    const el = document.getElementById("statsContent");

    if (!s || !s.runs || s.runs.length === 0) {
        el.innerHTML = `<div class="stats-empty">No ${tab === "custom" ? "custom" : DIFFICULTIES[tab]?.label || tab} wins yet.</div>`;
        return;
    }

    const sorted = [...s.runs].sort((a, b) => a.time - b.time);
    const avg = (s.total / s.wins).toFixed(1);
    const best = s.best.toFixed(1);

    el.innerHTML = `
    <div class="stats-summary">
      <div class="stat-card"><div class="sv">${s.wins}</div><div class="sl">Wins</div></div>
      <div class="stat-card"><div class="sv">${best}s</div><div class="sl">Best</div></div>
      <div class="stat-card"><div class="sv">${avg}s</div><div class="sl">Avg</div></div>
    </div>
    <table class="stats-table">
      <thead>
        <tr>
          <th>#</th><th>Time</th><th>Seed</th><th class="r">ID#</th>
          ${tab === "custom" ? "<th>Size</th>" : ""}
          <th class="r">Date</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((r, i) => {
        const date = new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const rankClass = i === 0 ? "gold" : "";
        return `<tr>
            <td class="rank ${rankClass}">${i === 0 ? "★" : i + 1}</td>
            <td class="${rankClass}">${r.time.toFixed(1)}s</td>
            <td class="seed-cell">${r.seed}</td>
            <td class="r">#${r.seedNum}</td>
            ${tab === "custom" ? `<td>${r.w}×${r.h} m${r.m}</td>` : ""}
            <td class="r" style="color:#555">${date}</td>
          </tr>`;
    }).join("")}
      </tbody>
    </table>`;
}

document.querySelectorAll(".stats-tab").forEach(b =>
    b.addEventListener("click", () => renderStatsModal(b.dataset.tab))
);

document.getElementById("statsBtn").addEventListener("click", openStats);
document.getElementById("statsCloseBtn").addEventListener("click", closeStats);
document.getElementById("statsModal").addEventListener("click", e => {
    if (e.target === document.getElementById("statsModal")) closeStats();
});

// ── LIVE PREVIEW + RATING ─────────────────────
let previewTimeout = null;

function schedulePreview() {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(drawPreview, 120);
}

function drawPreview() {
    const canvas = document.getElementById("previewCanvas");
    const wrap = canvas.parentElement;
    const maxW = (wrap.clientWidth || 360) - 4;
    const maxH = (wrap.clientHeight || 360) - 4;

    const pw = clamp(parseInt(document.getElementById("width").value, 10), 5, 60);
    const ph = clamp(parseInt(document.getElementById("height").value, 10), 5, 40);
    const pm = parseInt(document.getElementById("mines").value, 10) || 0;
    const pseedRaw = document.getElementById("seed").value.trim() || "default";
    const pseedResolved = resolveActualSeed(pseedRaw);
    const pseedNum = seedToNumericStable(pseedResolved);

    const cellPx = Math.max(2, Math.min(Math.floor(maxW / pw), Math.floor(maxH / ph), 18));
    const cw = pw * cellPx, ch = ph * cellPx;
    canvas.width = cw; canvas.height = ch;
    canvas.style.width = cw + "px"; canvas.style.height = ch + "px";

    const ctx = canvas.getContext("2d");
    const total = pw * ph;
    const maxM = total - 9;
    const mCount = clamp(pm, 1, Math.max(1, maxM));

    const miniCells = Array.from({ length: total }, (_, i) => ({ i, mine: false, num: 0, open: false, flag: false }));
    const rng = seededRandom(`${pseedNum}|${pw}x${ph}|${mCount}`);

    const ccx = (pw - 1) / 2, ccy = (ph - 1) / 2;
    const maxDist = Math.sqrt(ccx * ccx + ccy * ccy);
    const weights = Array.from({ length: total }, (_, i) => {
        const x = i % pw, y = Math.floor(i / pw);
        const dist = Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2);
        return 0.1 + (dist / maxDist) * 0.9;
    });

    const available = [...Array(total).keys()];
    const chosen = [];
    for (let k = 0; k < mCount; k++) {
        const totalW = available.reduce((s, i) => s + weights[i], 0);
        let r = rng() * totalW;
        let picked = available.length - 1;
        for (let j = 0; j < available.length; j++) {
            r -= weights[available[j]];
            if (r <= 0) { picked = j; break; }
        }
        chosen.push(available[picked]);
        available.splice(picked, 1);
    }
    for (let k = 0; k < mCount; k++) miniCells[chosen[k]].mine = true;

    for (let i = 0; i < total; i++) {
        if (miniCells[i].mine) continue;
        const x = i % pw, y = Math.floor(i / pw);
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < pw && ny >= 0 && ny < ph && miniCells[ny * pw + nx].mine) n++;
        }
        miniCells[i].num = n;
    }

    const bestReg = findBiggestZeroRegionMini(miniCells, pw, ph);

    for (let i = 0; i < total; i++) {
        const x = i % pw, y = Math.floor(i / pw);
        ctx.fillStyle = bestReg.has(i) ? "#1f5239" : "#2a2d38";
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        ctx.strokeStyle = "#191b22";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }

    const pct = ((mCount / total) * 100).toFixed(0);
    document.getElementById("previewInfo").textContent =
        `${pw} × ${ph} · ${mCount} mines (${pct}%) · seed: #${pseedNum}`;

    // ── Board rating (async, non-blocking) ──────
    updateRatingBadge("⏳", "rating-loading", "Analyzing…");
    const startCell = bestReg.size > 0 ? [...bestReg][0] : undefined;
    setTimeout(() => {
        try {
            const result = rateBoard(miniCells, pw, ph, mCount, startCell);
            const r = result.rating;
            updateRatingBadge(r.emoji, `rating-tier-${result.tier}`, `${r.label} — ${r.desc}`);
        } catch {
            updateRatingBadge("❓", "", "Rating unavailable");
        }
    }, 0);
}

function updateRatingBadge(emoji, cls, text) {
    const el = document.getElementById("ratingBadge");
    if (!el) return;
    el.className = "rating-badge " + cls;
    el.innerHTML = `<span class="rating-emoji">${emoji}</span><span class="rating-text">${text}</span>`;
}

// Hook preview to inputs
["seed", "cellSize"].forEach(id => {
    document.getElementById(id).addEventListener("input", schedulePreview);
});
["width", "height", "mines"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
        activeDiff = null;
        document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
        schedulePreview();
    });
});

loadSettings();
document.getElementById("seed").value = getDailySeed();
setDifficulty("medium");
schedulePreview();
