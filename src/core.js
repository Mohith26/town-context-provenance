// Context provenance + staleness guard: core algorithms.
// Pure ES module, no dependencies. Runs in the browser (index.html) and in Node (tests, scripts).
//
// 1. bm25Index / bm25Search   - the "naive" freshness-blind retriever used as the baseline.
// 2. slotPosterior            - continuous-time HMM filter over every assertion made about one fact
//                               ("slot"), across tools. Gives P(current value) with decay for age.
// 3. slotVerdict / classify   - turns the posterior into current / conflict / stale, and marks each
//                               source as current, superseded (and by what), contested or aging.
// 4. guardAnswer / naiveAnswer - claim-level answers for a question, with and without the guard.
// 5. selectContext            - budgeted monotone-submodular source selection (lazy greedy + best
//                               singleton) with a data-dependent upper bound on the optimum.
// 6. evaluateHistories        - accuracy / calibration of the guard vs simple policies on simulated
//                               claim histories.

export const DAY = 86400000;
export const OTHER = '__other__';

// ---------- utilities ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const normalize = (p) => {
  const s = p.reduce((a, b) => a + b, 0);
  return s > 0 ? p.map((x) => x / s) : p.map(() => 1 / p.length);
};
export const estimateTokens = (text) => Math.ceil(text.length / 4) + 12; // ~4 chars/token + metadata header

// ---------- 1. BM25 baseline retriever ----------
const STOP = new Set(
  ('a an the and or of to for in on at is are was were be by with it this that what who whom when where which how does do did ' +
    'we our us you your i me my any there their its as from has have had will would should can could about these those than then so if not no yes ' +
    'whats who\'s whos right now currently current still').split(' ')
);
export function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []).filter((w) => !STOP.has(w));
}
export function bm25Index(docs) {
  const toks = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, N);
  const df = new Map();
  toks.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const tf = toks.map((t) => {
    const m = new Map();
    t.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
    return m;
  });
  return { N, avgdl, df, tf, len: toks.map((t) => t.length), ids: docs.map((d) => d.id) };
}
export function bm25Search(idx, query, k = 6, k1 = 1.2, b = 0.75) {
  const q = [...new Set(tokenize(query))];
  const scored = idx.ids.map((id, i) => {
    let s = 0;
    for (const w of q) {
      const f = idx.tf[i].get(w);
      if (!f) continue;
      const n = idx.df.get(w);
      const idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * idx.len[i]) / idx.avgdl));
    }
    return { id, score: s };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, k);
}

// ---------- 2. Temporal belief over one slot ----------
// Hidden state: the slot's true value, piecewise constant; it changes as a Poisson process with rate
// lambda (per day) and, when it changes, lands uniformly on one of K states (the K-1 values anyone
// has asserted plus OTHER = "something nobody wrote down"). Each assertion is a noisy reading of the
// value at its own timestamp: P(says v | true v) = r, otherwise spread over the other K-1 states.
// Forward filtering to `now` gives the posterior; transitions between readings make old evidence
// decay toward uniform, which is exactly "this might be stale".
export function transition(p, rateTimesDays) {
  const stay = Math.exp(-Math.max(0, rateTimesDays));
  const K = p.length;
  return p.map((v) => v * stay + (1 - stay) / K);
}

export function slotPosterior(obs, { lambda, now }) {
  const values = [...new Set(obs.map((o) => o.value))];
  values.push(OTHER);
  const K = values.length;
  let p = values.map(() => 1 / K);
  const sorted = [...obs].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  let tPrev = sorted.length ? sorted[0].t : now;
  const trace = [];
  for (const o of sorted) {
    p = transition(p, (lambda * (o.t - tPrev)) / DAY);
    tPrev = o.t;
    const j = values.indexOf(o.value);
    const r = clamp(o.r, 1 / K + 1e-6, 0.995);
    p = normalize(p.map((x, i) => x * (i === j ? r : (1 - r) / (K - 1))));
    trace.push({ id: o.id, t: o.t, post: [...p] });
  }
  const atLast = [...p];
  const post = transition(p, (lambda * (now - tPrev)) / DAY);
  return { values, post, atLast, lastT: tPrev, trace, n: sorted.length };
}

// Belief over time (for plotting): filtered posterior at each requested time, using only
// assertions made at or before that time. Matches slotPosterior at t = now.
export function beliefCurve(obs, lambda, values, times) {
  const sorted = [...obs].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const K = values.length;
  let p = values.map(() => 1 / K);
  let tPrev = sorted.length ? sorted[0].t : times[0];
  let i = 0;
  return times.map((g) => {
    while (i < sorted.length && sorted[i].t <= g) {
      const o = sorted[i++];
      p = transition(p, (lambda * (o.t - tPrev)) / DAY);
      tPrev = o.t;
      const j = values.indexOf(o.value);
      const r = clamp(o.r, 1 / K + 1e-6, 0.995);
      p = normalize(p.map((x, k) => x * (k === j ? r : (1 - r) / (K - 1))));
    }
    return g < tPrev ? values.map(() => 1 / K) : transition(p, (lambda * (g - tPrev)) / DAY);
  });
}

function ranked(values, p) {
  return values
    .map((v, i) => ({ value: v, p: p[i] }))
    .sort((a, b) => b.p - a.p);
}

// verdict: 'current' | 'conflict' | 'stale' | 'none'
export function slotVerdict(res, { ok = 0.7, conflictRatio = 0.5 } = {}) {
  if (!res.n) return { verdict: 'none', map: null, conf: 0, ranked: [] };
  const nowRank = ranked(res.values, res.post).filter((x) => x.value !== OTHER);
  const lastRank = ranked(res.values, res.atLast).filter((x) => x.value !== OTHER);
  const top = nowRank[0];
  const conf = top.p;
  if (conf >= ok) return { verdict: 'current', map: top.value, conf, ranked: ranked(res.values, res.post) };
  const l1 = lastRank[0], l2 = lastRank[1];
  if (l2 && l2.p / l1.p >= conflictRatio)
    return { verdict: 'conflict', map: top.value, conf, contenders: [l1.value, l2.value], ranked: ranked(res.values, res.post) };
  if (l1.p >= ok) return { verdict: 'stale', map: top.value, conf, confAtLast: l1.p, ranked: ranked(res.values, res.post) };
  return { verdict: 'conflict', map: top.value, conf, contenders: lastRank.slice(0, 2).map((x) => x.value), ranked: ranked(res.values, res.post) };
}

// Per-source status for one slot's assertions.
export function classifyObservations(obs, v) {
  const sorted = [...obs].sort((a, b) => a.t - b.t);
  return sorted.map((o) => {
    if (v.verdict === 'current') {
      if (o.value === v.map) return { ...o, status: 'current' };
      const later = sorted.filter((x) => x.t > o.t && x.value === v.map);
      return later.length
        ? { ...o, status: 'superseded', supersededBy: later[0].id, latestCurrent: later[later.length - 1].id }
        : { ...o, status: 'outlier' };
    }
    if (v.verdict === 'conflict') {
      if (v.contenders.includes(o.value)) {
        const laterSame = sorted.find((x) => x.t > o.t && x.value === o.value);
        return { ...o, status: 'contested', latestForValue: !laterSame };
      }
      return { ...o, status: 'superseded' };
    }
    return { ...o, status: 'aging' };
  });
}

// ---------- 3. Workspace-level helpers ----------
export function observationsForSlot(ws, slotId, sourceFilter) {
  const kind = ws.slots[slotId].kind;
  const out = [];
  for (const s of ws.sources) {
    if (sourceFilter && !sourceFilter.has(s.id)) continue;
    for (const a of s.assertions || []) {
      if (a.slot !== slotId) continue;
      const base = ws.reliability[s.type][kind];
      out.push({ id: s.id, t: Date.parse(s.ts), value: a.value, r: base * (a.hedge ? 0.85 : 1), type: s.type });
    }
  }
  return out;
}

export function analyzeSlot(ws, slotId, sourceFilter) {
  const now = Date.parse(ws.now);
  const kind = ws.slots[slotId].kind;
  const obs = observationsForSlot(ws, slotId, sourceFilter);
  const res = slotPosterior(obs, { lambda: ws.kinds[kind].lambda, now });
  const v = slotVerdict(res, ws.thresholds);
  return { slotId, obs, res, ...v, classified: classifyObservations(obs, v) };
}

export function buildIndex(ws) {
  return bm25Index(ws.sources.map((s) => ({ id: s.id, text: `${s.title} ${s.text}` })));
}

// Freshness-blind baseline: take the top-k sources by relevance; each claim comes from the
// highest-ranked retrieved source that says anything about it.
export function naiveAnswer(ws, idx, q, k = 6) {
  const hits = bm25Search(idx, q.text, k);
  const byId = Object.fromEntries(ws.sources.map((s) => [s.id, s]));
  const claims = q.slots.map((slotId) => {
    for (const h of hits) {
      const a = (byId[h.id].assertions || []).find((x) => x.slot === slotId);
      if (a) return { slotId, value: a.value, sourceId: h.id };
    }
    return { slotId, value: null, sourceId: null };
  });
  return { hits, claims };
}

export function guardAnswer(ws, q) {
  return { claims: q.slots.map((slotId) => analyzeSlot(ws, slotId)) };
}

// Compare a naive claim with the guard's verdict for the same slot.
export function judgeNaive(naiveClaim, g) {
  if (naiveClaim.value == null) return 'missing';
  if (g.verdict === 'current') return naiveClaim.value === g.map ? 'agrees' : 'stale';
  if (g.verdict === 'conflict') return 'hides-conflict';
  if (g.verdict === 'stale') return 'unverified';
  return 'agrees';
}

// Score against ground truth: expect 'answer' (value must match) or 'flag' (must not assert one value).
export function scoreClaim(truth, mode, claim) {
  if (mode === 'naive') {
    if (truth.expect === 'flag') return false;
    return claim.value === truth.value;
  }
  if (truth.expect === 'flag') return claim.verdict === 'conflict' || claim.verdict === 'stale';
  return claim.verdict === 'current' && claim.map === truth.value;
}

// Proactive follow-ups: out-of-date records to fix, conflicts to resolve, facts to re-verify.
export function followUps(ws, guardClaims) {
  const byId = Object.fromEntries(ws.sources.map((s) => [s.id, s]));
  const out = [];
  for (const c of guardClaims) {
    const slot = ws.slots[c.slotId];
    if (c.verdict === 'current') {
      for (const o of c.classified) {
        if (o.status !== 'superseded') continue;
        const src = byId[o.id];
        if (src.type !== 'linear' && src.type !== 'notion') continue;
        // skip if the same record was re-read later (the record itself is already up to date)
        if (src.record && c.classified.some((x) => x.t > o.t && byId[x.id].record === src.record)) continue;
        const newer = byId[o.latestCurrent];
        out.push({ kind: 'update', slotId: c.slotId, sourceId: o.id, byId: newer.id,
          text: `${src.title} still says "${o.value}" (${slot.label}). ${newer.title}, ${fmtDate(newer.ts)}, says "${c.map}". Update it?` });
      }
    } else if (c.verdict === 'conflict') {
      const docs = c.classified.filter((o) => o.status === 'contested' && o.latestForValue).map((o) => byId[o.id]);
      out.push({ kind: 'conflict', slotId: c.slotId,
        text: `${docs.map((d) => d.title).join(' and ')} disagree on the ${slot.label}. Ask ${[...new Set(docs.map((d) => d.author))].join(' or ')} which is right before answering.` });
    } else if (c.verdict === 'stale') {
      const last = c.classified[c.classified.length - 1];
      out.push({ kind: 'stale', slotId: c.slotId,
        text: `${slot.label} was last confirmed ${fmtDate(byId[last.id].ts)} and changes often. Re-check before relying on it.` });
    }
  }
  return out;
}
export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

// ---------- 4. Budgeted context selection ----------
// Evidence value of source i for slot j: q_ij = r * (floor + (1-floor) * exp(-lambda * age)).
// Objective (probabilistic coverage, monotone submodular):
//   f(S) = sum_j w_j * (1 - prod_{i in S} (1 - q_ij))
export function candidateMatrix(ws, slotIds, candidateIds, floor = 0.2) {
  const now = Date.parse(ws.now);
  const byId = Object.fromEntries(ws.sources.map((s) => [s.id, s]));
  return candidateIds.map((id) => {
    const s = byId[id];
    const q = {};
    for (const a of s.assertions || []) {
      if (!slotIds.includes(a.slot)) continue;
      const kind = ws.slots[a.slot].kind;
      const r = ws.reliability[s.type][kind] * (a.hedge ? 0.85 : 1);
      const age = (now - Date.parse(s.ts)) / DAY;
      q[a.slot] = Math.max(q[a.slot] || 0, r * (floor + (1 - floor) * Math.exp(-ws.kinds[kind].lambda * age)));
    }
    return { id, cost: s.tokens, q };
  });
}

export function coverageFn(slotIds, weights = {}) {
  return (S) => {
    let total = 0;
    for (const j of slotIds) {
      let miss = 1;
      for (const c of S) if (c.q[j]) miss *= 1 - c.q[j];
      total += (weights[j] ?? 1) * (1 - miss);
    }
    return total;
  };
}

// Lazy (CELF) cost-benefit greedy, compared with the best single affordable element.
// Guarantee for budgeted monotone submodular maximization: >= (1 - 1/e)/2 of optimum
// (Leskovec et al. 2007). We also return a data-dependent upper bound on OPT.
export function selectContext(cands, budget, f) {
  let S = [], cost = 0, fS = f([]), evals = 0;
  let pq = cands.filter((c) => c.cost <= budget).map((c) => ({ c, ub: Infinity, stamp: -1 }));
  for (;;) {
    pq = pq.filter((x) => cost + x.c.cost <= budget);
    if (!pq.length) break;
    pq.sort((a, b) => b.ub - a.ub || (a.c.id < b.c.id ? -1 : 1));
    const top = pq[0];
    if (top.stamp === S.length) {
      if (top.ub <= 1e-12) break;
      S.push(top.c); cost += top.c.cost; fS = f(S); pq.shift();
      continue;
    }
    top.ub = (f([...S, top.c]) - fS) / top.c.cost; evals++;
    top.stamp = S.length;
  }
  let best = null, fBest = -1;
  for (const c of cands) {
    if (c.cost > budget) continue;
    const v = f([c]); evals++;
    if (v > fBest) { fBest = v; best = c; }
  }
  if (best && fBest > fS) { S = [best]; cost = best.cost; fS = fBest; }
  return { selected: S, cost, value: fS, upperBound: onlineBound(cands, S, budget, f), evals };
}

// OPT <= f(S) + max { sum_{i in T} delta_i : cost(T) <= B }, delta_i = f(S + i) - f(S) (submodularity);
// relaxed to a fractional knapsack, which is solvable greedily and still an upper bound.
export function onlineBound(cands, S, budget, f) {
  const inS = new Set(S.map((c) => c.id));
  const fS = f(S);
  const deltas = cands
    .filter((c) => !inS.has(c.id))
    .map((c) => ({ d: f([...S, c]) - fS, cost: c.cost }))
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d / b.cost - a.d / a.cost);
  let room = budget, extra = 0;
  for (const x of deltas) {
    if (room <= 0) break;
    const take = Math.min(1, room / x.cost);
    extra += take * x.d; room -= take * x.cost;
  }
  return fS + extra;
}

// Exhaustive optimum, for tests on small instances only.
export function bruteForceOpt(cands, budget, f) {
  let best = 0;
  const n = cands.length;
  for (let m = 0; m < 1 << n; m++) {
    let cost = 0; const S = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) { cost += cands[i].cost; S.push(cands[i]); }
    if (cost <= budget) best = Math.max(best, f(S));
  }
  return best;
}

// Relevance-ranked packing baseline: take retrieved sources in rank order while they fit.
export function packByRank(rankedIds, cands, budget) {
  const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
  const S = []; let cost = 0;
  for (const id of rankedIds) {
    const c = byId[id];
    if (!c || cost + c.cost > budget) continue;
    S.push(c); cost += c.cost;
  }
  return { selected: S, cost };
}

// Full context plan for one question at a budget.
export function contextPlan(ws, idx, q, budget, k = 30) {
  const hits = bm25Search(idx, q.text, k).map((h) => h.id);
  const slotSources = ws.sources.filter((s) => (s.assertions || []).some((a) => q.slots.includes(a.slot))).map((s) => s.id);
  const candIds = [...new Set([...hits, ...slotSources])];
  const cands = candidateMatrix(ws, q.slots, candIds);
  const f = coverageFn(q.slots);
  const full = f(cands);
  const greedy = selectContext(cands, budget, f);
  const naive = packByRank(hits, cands, budget);
  const fidelity = (sel) => {
    const filt = new Set(sel.map((c) => c.id));
    return q.slots.map((sid) => {
      const all = analyzeSlot(ws, sid);
      const sub = analyzeSlot(ws, sid, filt);
      return { slotId: sid, same: sub.verdict === all.verdict && (all.verdict !== 'current' || sub.map === all.map) };
    });
  };
  return {
    candidates: cands, full,
    greedy: { ...greedy, coverage: greedy.value / full, fidelity: fidelity(greedy.selected) },
    naive: { ...naive, value: f(naive.selected), coverage: f(naive.selected) / full, fidelity: fidelity(naive.selected) },
    allTokens: cands.reduce((s, c) => s + c.cost, 0),
    boundRatio: greedy.upperBound > 0 ? greedy.value / greedy.upperBound : 1,
  };
}

// ---------- 5. Evaluation on simulated histories ----------
// Each history: { kind, truth, obs: [{t (days, <= 0), value, type}] }. now = 0.
export function evaluateHistories(histories, ws, rng) {
  const methods = { relevance: 0, latest: 0, authority: 0, guard: 0 };
  let confident = 0, confidentRight = 0, flaggedWrongAvoided = 0, flagged = 0, flaggedLatestWrong = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  const rowsGuard = [], rowsLatest = [];
  for (const h of histories) {
    const lambda = ws.kinds[h.kind].lambda;
    const obs = h.obs.map((o, i) => ({ id: 'o' + i, t: o.t * DAY, value: o.value, r: ws.reliability[o.type][h.kind], type: o.type }));
    const pick = obs[Math.floor(rng() * obs.length)];
    if (pick.value === h.truth) methods.relevance++;
    const latest = [...obs].sort((a, b) => b.t - a.t)[0];
    if (latest.value === h.truth) methods.latest++;
    rowsLatest.push({ score: latest.t, right: latest.value === h.truth });
    const auth = [...obs].sort((a, b) => b.r - a.r || b.t - a.t)[0];
    if (auth.value === h.truth) methods.authority++;
    const res = slotPosterior(obs, { lambda, now: 0 });
    const v = slotVerdict(res, ws.thresholds);
    const right = v.map === h.truth;
    if (right) methods.guard++;
    rowsGuard.push({ score: v.conf, right });
    if (v.verdict === 'current') { confident++; if (right) confidentRight++; }
    else { flagged++; if (!right) flaggedWrongAvoided++; if (latest.value !== h.truth) flaggedLatestWrong++; }
    const b = Math.min(9, Math.floor(v.conf * 10));
    bins[b].n++; bins[b].conf += v.conf; bins[b].acc += right ? 1 : 0;
  }
  const n = histories.length;
  let ece = 0;
  for (const b of bins) if (b.n) ece += (b.n / n) * Math.abs(b.acc / b.n - b.conf / b.n);
  // Selective accuracy: answer only the k% most-trusted cases. Guard ranks by posterior confidence;
  // the latest-wins baseline ranks by how recent its newest source is (its natural trust signal).
  const curve = (rows) => {
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((c) => {
      const k = Math.max(1, Math.round(c * sorted.length));
      return { coverage: c, accuracy: sorted.slice(0, k).filter((r) => r.right).length / k };
    });
  };
  const aurc = (cv) => cv.reduce((s, p) => s + p.accuracy, 0) / cv.length;
  const cg = curve(rowsGuard), cl = curve(rowsLatest);
  return {
    n,
    selective: { guard: cg, latest: cl, meanGuard: aurc(cg), meanLatest: aurc(cl) },
    accuracy: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, v / n])),
    guardConfidentShare: confident / n,
    guardConfidentAccuracy: confident ? confidentRight / confident : 0,
    flaggedShare: flagged / n,
    flaggedThatWereWrong: flagged ? flaggedWrongAvoided / flagged : 0,
    flaggedWhereLatestWrong: flagged ? flaggedLatestWrong / flagged : 0,
    ece,
    bins: bins.map((b, i) => ({ lo: i / 10, n: b.n, conf: b.n ? b.conf / b.n : null, acc: b.n ? b.acc / b.n : null })),
  };
}
