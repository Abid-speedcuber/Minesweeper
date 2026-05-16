// ─────────────────────────────────────────────
//  Minesweeper Solver Engine
//  Pure logic — no DOM, no side effects.
//  Exports: rateBoard(cells, W, H, M)
//           getNextHint(cells, W, H, M)
// ─────────────────────────────────────────────

// ── Tier constants ──────────────────────────
export const TIER = {
  T1: 1,   // trivial flag / trivial open
  T2: 2,   // subset elimination
  T3: 3,   // enumerate valid configurations
  T4: 4,   // global mine count + full SAT
  GUESS: 5 // no deterministic move exists
};

export const RATING = {
  1: { label: "Easy",        emoji: "🟢", desc: "Solvable with basic logic" },
  2: { label: "Difficult",   emoji: "🟡", desc: "Requires constraint chaining" },
  3: { label: "Insane",      emoji: "🔴", desc: "Requires combinatorial solving" },
  4: { label: "Abomination", emoji: "💀", desc: "Requires full SAT / deep enumeration" },
  5: { label: "Guess",       emoji: "🎲", desc: "Contains forced guesses" }
};

// ── Helpers ──────────────────────────────────
function nbrs(i, W, H) {
  const x = i % W, y = Math.floor(i / W);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
  }
  return out;
}

function cloneState(cells) {
  return cells.map(c => ({ ...c }));
}

// ── Constraint builder ────────────────────────
// Returns array of { cells: Set<idx>, mines: number } from visible numbered cells
function buildConstraints(cells, W, H) {
  const constraints = [];
  for (const c of cells) {
    if (!c.open || c.mine || c.num <= 0) continue;
    const ns = nbrs(c.i, W, H);
    const unknown = ns.filter(n => !cells[n].open && !cells[n].flag);
    const flagged  = ns.filter(n => cells[n].flag).length;
    const rem = c.num - flagged;
    if (unknown.length === 0) continue;
    constraints.push({ cells: new Set(unknown), mines: rem });
  }
  return constraints;
}

// ── TIER 1: Trivial moves ────────────────────
function tier1Moves(cells, W, H) {
  const toFlag = new Set();
  const toOpen = new Set();

  for (const c of cells) {
    if (!c.open || c.mine || c.num <= 0) continue;
    const ns = nbrs(c.i, W, H);
    const unknown = ns.filter(n => !cells[n].open && !cells[n].flag);
    const flagged  = ns.filter(n => cells[n].flag).length;
    const rem = c.num - flagged;

    if (rem === 0 && unknown.length > 0) {
      unknown.forEach(n => toOpen.add(n));
    }
    if (rem === unknown.length && rem > 0) {
      unknown.forEach(n => toFlag.add(n));
    }
  }

  return { toFlag, toOpen };
}

// ── TIER 2: Subset elimination ───────────────
function tier2Moves(constraints) {
  const toFlag = new Set();
  const toOpen = new Set();

  for (let i = 0; i < constraints.length; i++) {
    for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const A = constraints[i], B = constraints[j];
      // Check if A ⊆ B
      let subset = true;
      for (const x of A.cells) { if (!B.cells.has(x)) { subset = false; break; } }
      if (!subset) continue;

      const diff = [...B.cells].filter(x => !A.cells.has(x));
      const diffMines = B.mines - A.mines;
      if (diff.length === 0) continue;

      if (diffMines === 0) {
        diff.forEach(n => toOpen.add(n));
      } else if (diffMines === diff.length) {
        diff.forEach(n => toFlag.add(n));
      }
    }
  }

  return { toFlag, toOpen };
}

// ── TIER 3: Enumerate configurations ─────────
// Returns { toFlag, toOpen } by enumerating valid mine assignments
// Works per independent partition of the constraint frontier
function tier3Moves(constraints, cells, W, H, totalMinesLeft) {
  const toFlag = new Set();
  const toOpen = new Set();

  if (constraints.length === 0) return { toFlag, toOpen };

  // Build partitions: connected components of constraints sharing cells
  const partitions = buildPartitions(constraints);

  for (const part of partitions) {
    const frontier = [...new Set(part.flatMap(c => [...c.cells]))];
    if (frontier.length > 25) continue; // safety cap

    const configs = enumerateConfigs(part, frontier);
    if (configs.length === 0) continue;

    // Tally mine presence per cell across all valid configs
    const mineCounts = new Map(frontier.map(f => [f, 0]));
    for (const cfg of configs) {
      for (let k = 0; k < frontier.length; k++) {
        if (cfg[k]) mineCounts.set(frontier[k], mineCounts.get(frontier[k]) + 1);
      }
    }

    for (const [cell, cnt] of mineCounts) {
      if (cnt === configs.length) toFlag.add(cell);
      if (cnt === 0)             toOpen.add(cell);
    }
  }

  return { toFlag, toOpen };
}

function buildPartitions(constraints) {
  const n = constraints.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    for (const x of constraints[i].cells) {
      if (constraints[j].cells.has(x)) { union(i, j); break; }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(constraints[i]);
  }
  return [...groups.values()];
}

function enumerateConfigs(constraints, frontier, maxConfigs = 500000) {
  const valid = [];
  const assignment = new Array(frontier.length).fill(false);

  function backtrack(idx) {
    if (valid.length >= maxConfigs) return;
    if (idx === frontier.length) {
      // Check all constraints satisfied
      for (const con of constraints) {
        let cnt = 0;
        for (let k = 0; k < frontier.length; k++) {
          if (assignment[k] && con.cells.has(frontier[k])) cnt++;
        }
        if (cnt !== con.mines) return;
      }
      valid.push([...assignment]);
      return;
    }

    // Pruning: check if remaining cells can still satisfy each constraint
    for (const con of constraints) {
      let placed = 0, possible = 0;
      for (let k = 0; k < frontier.length; k++) {
        if (!con.cells.has(frontier[k])) continue;
        if (assignment[k]) placed++;
        else if (k >= idx)  possible++;
      }
      if (placed > con.mines) return;
      if (placed + possible < con.mines) return;
    }

    assignment[idx] = false; backtrack(idx + 1);
    assignment[idx] = true;  backtrack(idx + 1);
    assignment[idx] = false;
  }

  backtrack(0);
  return valid;
}

// ── TIER 4: Global mine count forcing ────────
// After frontier analysis, apply remaining mine count to dark cells
function tier4Moves(cells, W, H, M, t3Flag, t3Open) {
  const toFlag = new Set(t3Flag);
  const toOpen = new Set(t3Open);

  const flaggedCount = cells.filter(c => c.flag).length + t3Flag.size;
  const remaining = M - flaggedCount;

  // Dark cells: not open, not flagged, not in any constraint's frontier
  const inFrontier = new Set();
  for (const c of cells) {
    if (!c.open || c.mine || c.num <= 0) continue;
    nbrs(c.i, W, H).forEach(n => {
      if (!cells[n].open && !cells[n].flag) inFrontier.add(n);
    });
  }
  t3Flag.forEach(x => inFrontier.add(x));
  t3Open.forEach(x => inFrontier.add(x));

  const dark = cells.filter(c => !c.open && !c.flag && !inFrontier.has(c.i) && !t3Flag.has(c.i));

  if (remaining === 0 && dark.length > 0) {
    dark.forEach(c => toOpen.add(c.i));
  } else if (remaining === dark.length && dark.length > 0) {
    dark.forEach(c => toFlag.add(c.i));
  }

  return { toFlag, toOpen };
}

// ── Guess picker: lowest-probability cell ────
function bestGuess(cells, W, H, M) {
  // Try frontier cells first, pick the one appearing in fewest "mine" configs
  const constraints = buildConstraints(cells, W, H);
  const partitions  = buildPartitions(constraints.length ? constraints : []);

  let bestCell = null, bestProb = Infinity;

  for (const part of partitions) {
    const frontier = [...new Set(part.flatMap(c => [...c.cells]))];
    if (frontier.length > 20) {
      // fallback: uniform probability
      const rem = M - cells.filter(c => c.flag).length;
      const unk = cells.filter(c => !c.open && !c.flag).length;
      const p = unk > 0 ? rem / unk : 1;
      if (p < bestProb) {
        bestProb = p;
        bestCell = frontier[0];
      }
      continue;
    }
    const configs = enumerateConfigs(part, frontier);
    if (!configs.length) continue;
    const mineCounts = new Map(frontier.map(f => [f, 0]));
    for (const cfg of configs) {
      for (let k = 0; k < frontier.length; k++) {
        if (cfg[k]) mineCounts.set(frontier[k], mineCounts.get(frontier[k]) + 1);
      }
    }
    for (const [cell, cnt] of mineCounts) {
      const p = cnt / configs.length;
      if (p < bestProb && p > 0) { bestProb = p; bestCell = cell; }
    }
  }

  // Also consider dark cells
  const inFrontier = new Set(constraints.flatMap(c => [...c.cells]));
  const dark = cells.filter(c => !c.open && !c.flag && !inFrontier.has(c.i));
  if (dark.length > 0) {
    const rem = M - cells.filter(c => c.flag).length - inFrontier.size;
    const darkProb = Math.max(0, rem) / dark.length;
    if (darkProb < bestProb) {
      bestProb = darkProb;
      // Pick dark cell closest to center
      bestCell = dark[Math.floor(dark.length / 2)].i;
    }
  }

  return { cell: bestCell, prob: bestProb };
}

// ── One solve step ────────────────────────────
// Returns { tier, toFlag, toOpen } or null if no move found
function solveStep(cells, W, H, M) {
  // T1
  const t1 = tier1Moves(cells, W, H);
  if (t1.toFlag.size || t1.toOpen.size) return { tier: TIER.T1, ...t1 };

  // T2
  const totalFlagged   = cells.filter(c => c.flag).length;
  const totalMinesLeft = M - totalFlagged;
  const constraints = buildConstraints(cells, W, H);

  // Inject global mine count as a constraint over ALL frontier cells
  const allFrontier = new Set(constraints.flatMap(c => [...c.cells]));
  if (allFrontier.size > 0 && allFrontier.size >= totalMinesLeft) {
    constraints.push({ cells: allFrontier, mines: totalMinesLeft });
  }

  const t2 = tier2Moves(constraints);
  if (t2.toFlag.size || t2.toOpen.size) return { tier: TIER.T2, ...t2 };

  // T3
  const t3 = tier3Moves(constraints, cells, W, H, totalMinesLeft);
  if (t3.toFlag.size || t3.toOpen.size) return { tier: TIER.T3, ...t3 };

  // T4
  const t4 = tier4Moves(cells, W, H, M, t3.toFlag, t3.toOpen);
  if (t4.toFlag.size || t4.toOpen.size) return { tier: TIER.T4, ...t4 };

  return null;
}

// ── Apply a step to a virtual board ──────────
function applyStep(cells, W, H, step) {
  for (const i of step.toFlag) cells[i].flag = true;
  for (const i of step.toOpen) {
    if (cells[i].mine) return false; // hit a mine — shouldn't happen but guard it
    floodRevealSim(cells, W, H, i);
  }
  return true;
}

function floodRevealSim(cells, W, H, start) {
  const q = [start], seen = new Set();
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const c = cells[cur];
    if (c.open || c.flag || c.mine) continue;
    c.open = true;
    if (c.num === 0) nbrs(cur, W, H).forEach(n => { if (!seen.has(n)) q.push(n); });
  }
}

// ── Main: rateBoard ───────────────────────────
// Simulates a full solve starting from the biggest-region cell.
// Returns { tier, rating } where rating is from RATING map.
export function rateBoard(cells, W, H, M, startCell) {
  const sim = cloneState(cells);

  // Recalculate nums on sim (cells passed in may already have them set)
  for (let i = 0; i < sim.length; i++) {
    if (!sim[i].mine) {
      sim[i].num = nbrs(i, W, H).filter(n => sim[n].mine).length;
    }
    sim[i].open = false;
    sim[i].flag = false;
  }

  // Open the starting cell
  if (startCell !== undefined && !sim[startCell].mine) {
    floodRevealSim(sim, W, H, startCell);
  } else {
    // Find a non-mine cell near center to start
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const center = cy * W + cx;
    let found = false;
    for (let r = 0; r <= Math.max(W, H); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const i = ny * W + nx;
        if (!sim[i].mine) { floodRevealSim(sim, W, H, i); found = true; break; }
      }
      if (found) break;
    }
  }

  let maxTier = TIER.T1;
  const totalSafe = W * H - M;
  let iterations = 0;

  while (true) {
    const opened = sim.filter(c => c.open).length;
    if (opened >= totalSafe) break; // solved!
    if (iterations++ > W * H * 2) break; // safety

    const step = solveStep(sim, W, H, M);
    if (!step) {
      // Check if truly stuck or just all remaining are flagged
      const remaining = sim.filter(c => !c.open && !c.flag && !c.mine);
      if (remaining.length === 0) break;
      maxTier = TIER.GUESS;
      break;
    }

    if (step.tier > maxTier) maxTier = step.tier;
    const ok = applyStep(sim, W, H, step);
    if (!ok) break;
  }

  return { tier: maxTier, rating: RATING[maxTier] };
}

// ── Main: getNextHint ─────────────────────────
// Returns a hint object for the current live board state.
// { tier, type, cells[], explanation, prob? }
export function getNextHint(cells, W, H, M) {
  // T1 check
  for (const c of cells) {
    if (!c.open || c.mine || c.num <= 0) continue;
    const ns = nbrs(c.i, W, H);
    const unknown  = ns.filter(n => !cells[n].open && !cells[n].flag);
    const flagged  = ns.filter(n => cells[n].flag).length;
    const rem = c.num - flagged;

    if (rem === 0 && unknown.length > 0) {
      const [cx, cy] = [c.i % W, Math.floor(c.i / W)];
      return {
        tier: TIER.T1,
        type: "open",
        cells: unknown,
        source: c.i,
        explanation: `Cell (${cx+1}, ${cy+1}) shows ${c.num} mine${c.num>1?"s":""} and all ${flagged} neighbor${flagged>1?"s are":" is"} already flagged — the remaining ${unknown.length} neighbor${unknown.length>1?"s are":" is"} safe to open.`
      };
    }
    if (rem === unknown.length && rem > 0) {
      const [cx, cy] = [c.i % W, Math.floor(c.i / W)];
      return {
        tier: TIER.T1,
        type: "flag",
        cells: unknown,
        source: c.i,
        explanation: `Cell (${cx+1}, ${cy+1}) shows ${c.num} mine${c.num>1?"s":""} and has exactly ${unknown.length} unrevealed neighbor${unknown.length>1?"s":""} — all of them must be mines. Flag them.`
      };
    }
  }

  // T2 check — inject global mine count as extra constraint
  const totalFlaggedH  = cells.filter(c => c.flag).length;
  const totalMinesLeftH = M - totalFlaggedH;
  const constraints = buildConstraints(cells, W, H);
  const allFrontierH = new Set(constraints.flatMap(c => [...c.cells]));
  if (allFrontierH.size > 0 && allFrontierH.size >= totalMinesLeftH) {
    constraints.push({ cells: allFrontierH, mines: totalMinesLeftH });
  }
  for (let i = 0; i < constraints.length; i++) {
    for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const A = constraints[i], B = constraints[j];
      let subset = true;
      for (const x of A.cells) { if (!B.cells.has(x)) { subset = false; break; } }
      if (!subset) continue;
      const diff = [...B.cells].filter(x => !A.cells.has(x));
      const diffMines = B.mines - A.mines;
      if (diff.length === 0) continue;
      if (diffMines === 0) {
        return {
          tier: TIER.T2,
          type: "open",
          cells: diff,
          explanation: `Constraint analysis: one group of cells is a subset of another. After subtracting, the ${diff.length} remaining cell${diff.length>1?"s":""} must contain 0 mines — safe to open.`
        };
      }
      if (diffMines === diff.length) {
        return {
          tier: TIER.T2,
          type: "flag",
          cells: diff,
          explanation: `Constraint analysis: after subtracting a subset constraint, the remaining ${diff.length} cell${diff.length>1?"s":""} must all be mines. Flag them.`
        };
      }
    }
  }

  // T3 check
  const totalFlagged = cells.filter(c => c.flag).length;
  const t3 = tier3Moves(constraints, cells, W, H, M - totalFlagged);
  if (t3.toFlag.size) {
    return {
      tier: TIER.T3,
      type: "flag",
      cells: [...t3.toFlag],
      explanation: `Combinatorial analysis: after enumerating all valid mine arrangements for this region, ${t3.toFlag.size > 1 ? "these cells are" : "this cell is"} a mine in every possible configuration.`
    };
  }
  if (t3.toOpen.size) {
    return {
      tier: TIER.T3,
      type: "open",
      cells: [...t3.toOpen],
      explanation: `Combinatorial analysis: after enumerating all valid mine arrangements, ${t3.toOpen.size > 1 ? "these cells are" : "this cell is"} safe in every possible configuration.`
    };
  }

  // T4 check
  const t4 = tier4Moves(cells, W, H, M, new Set(), new Set());
  if (t4.toFlag.size) {
    return {
      tier: TIER.T4,
      type: "flag",
      cells: [...t4.toFlag],
      explanation: `Global mine count: the total remaining mines exactly matches the number of unrevealed cells outside the constraint frontier — all of them are mines.`
    };
  }
  if (t4.toOpen.size) {
    return {
      tier: TIER.T4,
      type: "open",
      cells: [...t4.toOpen],
      explanation: `Global mine count: there are no remaining mines to place outside the constraint frontier — all those cells are safe.`
    };
  }

  // Guess
  const { cell, prob } = bestGuess(cells, W, H, M);
  if (cell !== null) {
    const pct = (prob * 100).toFixed(0);
    const [gx, gy] = [cell % W, Math.floor(cell / W)];
    return {
      tier: TIER.GUESS,
      type: "guess",
      cells: [cell],
      prob,
      explanation: `No deterministic move exists. Best guess: cell (${gx+1}, ${gy+1}) has the lowest estimated mine probability (~${pct}%). This is still a gamble.`
    };
  }

  return null; // board is likely solved
}