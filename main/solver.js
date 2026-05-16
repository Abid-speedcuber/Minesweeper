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
    1: { label: "Easy", emoji: "🟢", desc: "Solvable with basic logic" },
    2: { label: "Difficult", emoji: "🟡", desc: "Requires constraint chaining" },
    3: { label: "Insane", emoji: "🔴", desc: "Requires combinatorial solving" },
    4: { label: "Abomination", emoji: "💀", desc: "Requires full SAT / deep enumeration" },
    5: { label: "Guess", emoji: "🎲", desc: "Contains forced guesses" }
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
        const flagged = ns.filter(n => cells[n].flag).length;
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
        const flagged = ns.filter(n => cells[n].flag).length;
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

// ── TIER 1b: Last-mines elimination ──────────
// When remaining mines === frontier size, all frontier cells are mines (already T1).
// When remaining mines < frontier size, try eliminating candidates by checking
// whether placing a mine there would violate any constraint.
function tier1bMoves(cells, W, H, M) {
    const totalFlagged = cells.filter(c => c.flag).length;
    const remaining = M - totalFlagged;
    if (remaining <= 0) return { toFlag: new Set(), toOpen: new Set(), explanation: null };

    const constraints = buildConstraints(cells, W, H);
    const allFrontier = [...new Set(constraints.flatMap(c => [...c.cells]))];
    if (allFrontier.length === 0) return { toFlag: new Set(), toOpen: new Set(), explanation: null };

    // For each frontier cell, test: "if this cell is NOT a mine, is the board still satisfiable?"
    // If placing 0 here makes some constraint impossible → it must be a mine.
    // For each frontier cell, test: "if this cell IS a mine, is the board still satisfiable?"
    // If placing 1 here makes some constraint impossible → it must be safe.

    const toFlag = new Set();
    const toOpen = new Set();
    const flagReasons = new Map();
    const openReasons = new Map();

    for (const cell of allFrontier) {
        // Test: assume cell is SAFE → does any constraint become impossible?
        const safeViolation = checkViolation(cell, false, constraints, remaining, allFrontier);
        if (safeViolation) {
            toFlag.add(cell);
            flagReasons.set(cell, safeViolation);
        }

        // Test: assume cell is a MINE → does any constraint become impossible?
        const mineViolation = checkViolation(cell, true, constraints, remaining, allFrontier);
        if (mineViolation) {
            toOpen.add(cell);
            openReasons.set(cell, mineViolation);
        }
    }

    return { toFlag, toOpen, flagReasons, openReasons };
}

// Check if forcing `cell` to `isMine` creates a contradiction.
// Returns a reason string if contradiction found, null otherwise.
function checkViolation(cell, isMine, constraints, remaining, allFrontier) {
    // Build reduced constraints with this cell fixed
    const reduced = constraints.map(con => {
        if (!con.cells.has(cell)) return { ...con, cells: new Set(con.cells) };
        const newCells = new Set(con.cells);
        newCells.delete(cell);
        return { cells: newCells, mines: isMine ? con.mines - 1 : con.mines };
    });

    // Check each reduced constraint for impossibility
    for (const con of reduced) {
        if (con.mines < 0) return `placing a mine here would exceed the limit of a neighboring number cell`;
        if (con.mines > con.cells.size) return `placing a mine here would leave a neighboring number cell unable to reach its mine count`;
    }

    // Check global mine count feasibility
    const otherFrontier = allFrontier.filter(c => c !== cell);
    const minesNeededElsewhere = isMine ? remaining - 1 : remaining;
    if (minesNeededElsewhere < 0) return `there are no mines left to place`;
    if (minesNeededElsewhere > otherFrontier.length) return `there aren't enough remaining cells to place all mines`;

    return null;
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
            if (cnt === 0) toOpen.add(cell);
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
                else if (k >= idx) possible++;
            }
            if (placed > con.mines) return;
            if (placed + possible < con.mines) return;
        }

        assignment[idx] = false; backtrack(idx + 1);
        assignment[idx] = true; backtrack(idx + 1);
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
    const partitions = buildPartitions(constraints.length ? constraints : []);

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

    // T1b: elimination by contradiction on frontier
    const t1b = tier1bMoves(cells, W, H, M);
    if (t1b.toFlag.size || t1b.toOpen.size) return { tier: TIER.T1, ...t1b };

    // T2
    const totalFlagged = cells.filter(c => c.flag).length;
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

// ── Explanation helpers ───────────────────────

function cellLabel(i, W) {
    return `(row ${Math.floor(i / W) + 1}, col ${(i % W) + 1})`;
}

function listCells(arr, W) {
    if (arr.length === 1) return cellLabel(arr[0], W);
    if (arr.length === 2) return `${cellLabel(arr[0], W)} and ${cellLabel(arr[1], W)}`;
    return arr.slice(0, -1).map(c => cellLabel(c, W)).join(", ") + ", and " + cellLabel(arr[arr.length - 1], W);
}

function findSourceCell(cells, W, H, constraintCells) {
    for (const c of cells) {
        if (!c.open || c.mine || c.num <= 0) continue;
        const unknown = [];
        const x = c.i % W, y = Math.floor(c.i / W);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const ni = ny * W + nx;
                if (!cells[ni].open && !cells[ni].flag) unknown.push(ni);
            }
        }
        if (unknown.length !== constraintCells.size) continue;
        let match = true;
        for (const u of unknown) if (!constraintCells.has(u)) { match = false; break; }
        if (match) return c;
    }
    return null;
}

function explainT1Flag(c, unknown, W) {
    const loc = cellLabel(c.i, W);
    const flagged = /* already computed outside */ 0;
    const lines = [];
    lines.push(`Look at the ${c.num} at ${loc}.`);
    lines.push(`It needs exactly ${c.num} mine${c.num > 1 ? "s" : ""} among its unrevealed neighbors, and it has exactly ${unknown.length} unrevealed unflagged neighbor${unknown.length > 1 ? "s" : ""}: ${listCells(unknown, W)}.`);
    lines.push(`Since the count of required mines equals the count of available cells, every single one of those neighbors must be a mine.`);
    lines.push(`Flag ${unknown.length > 1 ? "all of them" : "it"}.`);
    return lines.join(" ");
}

function explainT1Open(c, unknown, flagged, W) {
    const loc = cellLabel(c.i, W);
    const lines = [];
    lines.push(`Look at the ${c.num} at ${loc}.`);
    lines.push(`It needs ${c.num} mine${c.num > 1 ? "s" : ""} among its neighbors, and you've already flagged ${flagged} neighbor${flagged > 1 ? "s" : ""} next to it — that's exactly ${c.num}.`);
    lines.push(`So all the mines touching this cell are accounted for.`);
    if (unknown.length === 1) {
        lines.push(`The remaining unflagged neighbor at ${cellLabel(unknown[0], W)} cannot be a mine. Open it safely.`);
    } else {
        lines.push(`The remaining ${unknown.length} unflagged neighbors — ${listCells(unknown, W)} — cannot be mines. Open them all safely.`);
    }
    return lines.join(" ");
}

function explainT1bFlag(cell, reason, remaining, W) {
    const loc = cellLabel(cell, W);
    const lines = [];
    lines.push(`There ${remaining === 1 ? "is" : "are"} ${remaining} mine${remaining > 1 ? "s" : ""} left to place on the entire board.`);
    lines.push(`Consider the cell at ${loc}.`);
    lines.push(`Suppose it were safe — then the ${remaining} mine${remaining > 1 ? "s" : ""} would have to go elsewhere. But ${reason}.`);
    lines.push(`That's a contradiction, so the assumption is wrong: ${loc} must be a mine. Flag it.`);
    return lines.join(" ");
}

function explainT1bOpen(cell, reason, remaining, W) {
    const loc = cellLabel(cell, W);
    const lines = [];
    lines.push(`There ${remaining === 1 ? "is" : "are"} ${remaining} mine${remaining > 1 ? "s" : ""} left to place on the entire board.`);
    lines.push(`Consider the cell at ${loc}.`);
    lines.push(`Suppose it were a mine — then ${reason}.`);
    lines.push(`That's a contradiction, so ${loc} cannot be a mine. It is safe to open.`);
    return lines.join(" ");
}

function explainT2(A, B, diff, diffMines, cells, W, H) {
    const srcA = findSourceCell(cells, W, H, A.cells);
    const srcB = findSourceCell(cells, W, H, B.cells);

    const aLabel = srcA ? `the ${srcA.num} at ${cellLabel(srcA.i, W)}` : "a numbered cell";
    const bLabel = srcB ? `the ${srcB.num} at ${cellLabel(srcB.i, W)}` : "another numbered cell";

    const aList = listCells([...A.cells], W);
    const bList = listCells([...B.cells], W);
    const diffList = listCells(diff, W);

    const lines = [];
    lines.push(`This uses a technique called constraint subtraction. Let's walk through it step by step.`);
    lines.push(`\n\nFirst, look at ${aLabel}. Its unknown neighbors are: ${aList}. Exactly ${A.mines} of those ${A.cells.size} cell${A.cells.size > 1 ? "s" : ""} ${A.mines === 1 ? "is a mine" : "are mines"}.`);
    lines.push(`\n\nNow look at ${bLabel}. Its unknown neighbors are: ${bList}. Exactly ${B.mines} of those ${B.cells.size} cell${B.cells.size > 1 ? "s" : ""} ${B.mines === 1 ? "is a mine" : "are mines"}.`);
    lines.push(`\n\nNotice that ${aLabel}'s group is entirely contained within ${bLabel}'s group. That means we can subtract: the cells that belong to ${bLabel} but NOT to ${aLabel} are: ${diffList}.`);

    if (diffMines === 0) {
        lines.push(`\n\nSince ${aLabel} already accounts for all ${A.mines} mine${A.mines > 1 ? "s" : ""} in the shared region, the leftover cell${diff.length > 1 ? "s" : ""} — ${diffList} — must contain exactly 0 mines.`);
        lines.push(`They are all safe. Open ${diff.length > 1 ? "them" : "it"}.`);
    } else {
        lines.push(`\n\nAfter subtracting ${aLabel}'s ${A.mines} mine${A.mines > 1 ? "s" : ""} from ${bLabel}'s ${B.mines}, the leftover region of ${diff.length} cell${diff.length > 1 ? "s" : ""} must contain exactly ${diffMines} mine${diffMines > 1 ? "s" : ""}.`);
        if (diffMines === diff.length) {
            lines.push(`And since that's the same as the number of leftover cells, every single one — ${diffList} — must be a mine. Flag ${diff.length > 1 ? "them all" : "it"}.`);
        } else {
            lines.push(`So ${diffMines} of the ${diff.length} cells in ${diffList} are mines, but we can't determine which ones yet. Keep this in mind for further deductions.`);
        }
    }

    return lines.join("");
}

function explainT3(cells, type, targets, W) {
    const targetList = listCells(targets, W);
    const lines = [];
    lines.push(`This requires enumerating all possible mine arrangements — let's walk through the logic.`);
    lines.push(`\n\nThe highlighted cell${targets.length > 1 ? "s" : ""} — ${targetList} — ${targets.length > 1 ? "are" : "is"} part of a constrained region where we can test every valid way to distribute the remaining mines.`);
    if (type === "flag") {
        lines.push(`\n\nNo matter how you arrange the mines to satisfy all the numbered cells in this region, ${targets.length > 1 ? "these cells end up as mines in every single valid arrangement" : "this cell ends up as a mine in every single valid arrangement"}.`);
        lines.push(`When a cell is a mine in 100% of valid configurations, it must be a mine. Flag ${targets.length > 1 ? "them" : "it"}.`);
    } else {
        lines.push(`\n\nNo matter how you arrange the mines to satisfy all the numbered cells in this region, ${targets.length > 1 ? "these cells are always mine-free in every valid arrangement" : "this cell is always mine-free in every valid arrangement"}.`);
        lines.push(`When a cell is safe in 100% of valid configurations, it must be safe. Open ${targets.length > 1 ? "them" : "it"}.`);
    }
    return lines.join("");
}

function explainT4(type, targets, remaining, W) {
    const targetList = listCells(targets, W);
    const lines = [];
    if (type === "open") {
        lines.push(`Global deduction: there are ${remaining} mines left on the board, and they are all already accounted for by cells on the constraint frontier (the numbered cells you can see).`);
        lines.push(`\n\nThat means the cells with no numbered neighbors at all — the "dark" unexplored region — contain zero mines.`);
        lines.push(`\n\nSpecifically, ${targetList} ${targets.length > 1 ? "are" : "is"} in that dark region and guaranteed safe. Open ${targets.length > 1 ? "them" : "it"}.`);
    } else {
        lines.push(`Global deduction: count the mines remaining (${remaining}) and count the unrevealed cells outside the constraint frontier.`);
        lines.push(`\n\nThey match exactly — so every single cell in the unexplored dark region must be a mine.`);
        lines.push(`\n\n${targetList} ${targets.length > 1 ? "are" : "is"} in that region. Flag ${targets.length > 1 ? "them" : "it"}.`);
    }
    return lines.join("");
}

function explainGuess(cell, prob, W) {
    const loc = cellLabel(cell, W);
    const pct = (prob * 100).toFixed(1);
    const lines = [];
    lines.push(`No deterministic move exists anywhere on this board. Every remaining unrevealed cell either has an unknown mine probability or is part of an unsolvable configuration. You have to guess.`);
    lines.push(`\n\nThe best available guess is ${loc}, with an estimated mine probability of ${pct}%. This was calculated by enumerating all valid mine configurations across the constraint frontier and counting how often this cell appears as a mine.`);
    lines.push(`\n\nA lower percentage is better. There may be other cells with similar odds — this is just the best option the solver found. Good luck.`);
    return lines.join("");
}

// ── Main: getNextHint ─────────────────────────
// Returns a hint object for the current live board state.
// { tier, type, cells[], explanation, prob? }
export function getNextHint(cells, W, H, M) {
    // T1 check
    for (const c of cells) {
        if (!c.open || c.mine || c.num <= 0) continue;
        const ns = nbrs(c.i, W, H);
        const unknown = ns.filter(n => !cells[n].open && !cells[n].flag);
        const flagged = ns.filter(n => cells[n].flag).length;
        const rem = c.num - flagged;

        if (rem === 0 && unknown.length > 0) {
            return {
                tier: TIER.T1, type: "open", cells: unknown, source: c.i,
                explanation: explainT1Open(c, unknown, flagged, W)
            };
        }
        if (rem === unknown.length && rem > 0) {
            return {
                tier: TIER.T1, type: "flag", cells: unknown, source: c.i,
                explanation: explainT1Flag(c, unknown, W)
            };
        }
    }

    // T1b check — elimination by contradiction
    const t1b = tier1bMoves(cells, W, H, M);
    if (t1b.toFlag.size) {
        const cell = [...t1b.toFlag][0];
        const reason = t1b.flagReasons?.get(cell) || "it must be a mine";
        const totalFlagged0 = cells.filter(c => c.flag).length;
        return {
            tier: TIER.T1, type: "flag", cells: [...t1b.toFlag],
            explanation: explainT1bFlag(cell, reason, M - totalFlagged0, W)
        };
    }
    if (t1b.toOpen.size) {
        const cell = [...t1b.toOpen][0];
        const reason = t1b.openReasons?.get(cell) || "it cannot be a mine";
        const totalFlagged0 = cells.filter(c => c.flag).length;
        return {
            tier: TIER.T1, type: "open", cells: [...t1b.toOpen],
            explanation: explainT1bOpen(cell, reason, M - totalFlagged0, W)
        };
    }

    // T2 check — inject global mine count as extra constraint
    const totalFlaggedH = cells.filter(c => c.flag).length;
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
            if (diffMines === 0 || diffMines === diff.length) {
                return {
                    tier: TIER.T2,
                    type: diffMines === 0 ? "open" : "flag",
                    cells: diff,
                    explanation: explainT2(A, B, diff, diffMines, cells, W, H)
                };
            }
        }
    }

    // T3 check
    const totalFlagged = cells.filter(c => c.flag).length;
    const t3 = tier3Moves(constraints, cells, W, H, M - totalFlagged);
    if (t3.toFlag.size) {
        return {
            tier: TIER.T3, type: "flag", cells: [...t3.toFlag],
            explanation: explainT3(cells, "flag", [...t3.toFlag], W)
        };
    }
    if (t3.toOpen.size) {
        return {
            tier: TIER.T3, type: "open", cells: [...t3.toOpen],
            explanation: explainT3(cells, "open", [...t3.toOpen], W)
        };
    }

    // T4 check
    const t4 = tier4Moves(cells, W, H, M, new Set(), new Set());
    const remT4 = M - cells.filter(c => c.flag).length;
    if (t4.toFlag.size) {
        return {
            tier: TIER.T4, type: "flag", cells: [...t4.toFlag],
            explanation: explainT4("flag", [...t4.toFlag], remT4, W)
        };
    }
    if (t4.toOpen.size) {
        return {
            tier: TIER.T4, type: "open", cells: [...t4.toOpen],
            explanation: explainT4("open", [...t4.toOpen], remT4, W)
        };
    }

    // Guess
    const { cell, prob } = bestGuess(cells, W, H, M);
    if (cell !== null) {
        return {
            tier: TIER.GUESS, type: "guess", cells: [cell], prob,
            explanation: explainGuess(cell, prob, W)
        };
    }

    return null; // board is likely solved
}