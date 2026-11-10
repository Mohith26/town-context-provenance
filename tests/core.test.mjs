// Run: node --test tests/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../src/core.js';

const ws = JSON.parse(readFileSync(new URL('../data/workspace.json', import.meta.url)));
const sim = JSON.parse(readFileSync(new URL('../data/sim.json', import.meta.url)));
const idx = C.buildIndex(ws);
const D = C.DAY;

test('transition decays toward uniform and preserves mass', () => {
  const p = C.transition([0.9, 0.05, 0.05], 0);
  assert.deepEqual(p, [0.9, 0.05, 0.05]);
  const q = C.transition([0.9, 0.05, 0.05], 50);
  q.forEach((x) => assert.ok(Math.abs(x - 1 / 3) < 1e-6));
  assert.ok(Math.abs(C.transition([0.7, 0.2, 0.1], 0.4).reduce((a, b) => a + b) - 1) < 1e-12);
});

test('newer authoritative evidence supersedes an older chat message', () => {
  const now = 20 * D;
  const obs = [
    { id: 'slack', t: 1 * D, value: 'Priya', r: 0.75 },
    { id: 'linear', t: 18 * D, value: 'Marcus', r: 0.97 },
  ];
  const res = C.slotPosterior(obs, { lambda: 1 / 45, now });
  const v = C.slotVerdict(res);
  assert.equal(v.verdict, 'current');
  assert.equal(v.map, 'Marcus');
  const cls = C.classifyObservations(obs, v);
  assert.equal(cls.find((o) => o.id === 'slack').status, 'superseded');
  assert.equal(cls.find((o) => o.id === 'slack').supersededBy, 'linear');
});

test('two recent, equally reliable sources that disagree are flagged as a conflict', () => {
  const obs = [
    { id: 'a', t: 10 * D, value: '100', r: 0.8 },
    { id: 'b', t: 13 * D, value: '300', r: 0.8 },
  ];
  const v = C.slotVerdict(C.slotPosterior(obs, { lambda: 1 / 120, now: 25 * D }));
  assert.equal(v.verdict, 'conflict');
  assert.deepEqual([...v.contenders].sort(), ['100', '300']);
});

test('old evidence on a fast-changing fact is flagged stale, not answered', () => {
  const obs = [{ id: 'a', t: 0, value: 'Wen', r: 0.85 }];
  const fresh = C.slotVerdict(C.slotPosterior(obs, { lambda: 1 / 7, now: 1 * D }));
  const old = C.slotVerdict(C.slotPosterior(obs, { lambda: 1 / 7, now: 25 * D }));
  assert.equal(fresh.verdict, 'current');
  assert.equal(old.verdict, 'stale');
  assert.ok(old.conf < fresh.conf);
});

test('posterior is order-invariant in input and sums to 1', () => {
  const obs = [
    { id: 'x', t: 3 * D, value: 'A', r: 0.8 },
    { id: 'y', t: 1 * D, value: 'B', r: 0.7 },
    { id: 'z', t: 5 * D, value: 'A', r: 0.9 },
  ];
  const a = C.slotPosterior(obs, { lambda: 0.05, now: 9 * D });
  const b = C.slotPosterior([...obs].reverse(), { lambda: 0.05, now: 9 * D });
  assert.deepEqual(a.post, b.post);
  assert.ok(Math.abs(a.post.reduce((s, x) => s + x, 0) - 1) < 1e-9);
});

test('beliefCurve ends at the same posterior as slotPosterior', () => {
  const obs = [
    { id: 'x', t: 3 * D, value: 'A', r: 0.8 },
    { id: 'y', t: 1 * D, value: 'B', r: 0.7 },
  ];
  const res = C.slotPosterior(obs, { lambda: 0.05, now: 9 * D });
  const curve = C.beliefCurve(obs, 0.05, res.values, [0, 2 * D, 9 * D]);
  curve[2].forEach((x, i) => assert.ok(Math.abs(x - res.post[i]) < 1e-12));
  curve[0].forEach((x) => assert.ok(Math.abs(x - 1 / 3) < 1e-12));
});

test('bm25 ranks lexical matches and ignores freshness', () => {
  const i = C.bm25Index([
    { id: 'old', text: 'launch date for ledger sync v2 is november 12 launch plan' },
    { id: 'new', text: 'slipping a week to nov 19' },
    { id: 'x', text: 'unrelated deploy freeze reminder' },
  ]);
  const hits = C.bm25Search(i, 'ledger sync launch date', 3);
  assert.equal(hits[0].id, 'old');
  assert.ok(!hits.find((h) => h.id === 'x'));
});

test('workspace: guard answers every scenario correctly, naive retrieval does not', () => {
  let guardRight = 0, naiveRight = 0, total = 0;
  for (const q of ws.questions) {
    const g = C.guardAnswer(ws, q);
    const n = C.naiveAnswer(ws, idx, q);
    q.slots.forEach((s, i) => {
      total++;
      if (C.scoreClaim(ws.truth[s], 'guard', g.claims[i])) guardRight++;
      if (C.scoreClaim(ws.truth[s], 'naive', n.claims[i])) naiveRight++;
    });
  }
  assert.equal(guardRight, total);
  assert.ok(naiveRight < total / 2, `naive got ${naiveRight}/${total}`);
});

test('workspace: specific verdicts', () => {
  const get = (slot) => C.analyzeSlot(ws, slot);
  assert.equal(get('eng398.status').map, 'Done');           // merged PR beats older Linear status
  assert.equal(get('eng412.owner').map, 'Marcus Lee');      // reassignment beats older Slack
  assert.equal(get('api.rate_limit').verdict, 'conflict');  // two docs disagree
  assert.equal(get('cdc.approach').map, 'Native Postgres logical replication');
  assert.equal(get('payments.oncall').verdict, 'stale');    // 3+ weeks old on a weekly rotation
});

test('follow-ups point at the out-of-date record and its newer source', () => {
  const q1 = ws.questions.find((q) => q.id === 'q1');
  const f = C.followUps(ws, C.guardAnswer(ws, q1).claims);
  const upd = f.find((x) => x.slotId === 'eng398.status');
  assert.ok(upd);
  assert.equal(ws.sources.find((s) => s.id === upd.sourceId).type, 'linear');
  assert.equal(ws.sources.find((s) => s.id === upd.byId).type, 'github');
});

// ---- budgeted selection ----
function randomInstance(seed, n, m) {
  const r = C.mulberry32(seed);
  const slots = Array.from({ length: m }, (_, j) => 's' + j);
  const cands = Array.from({ length: n }, (_, i) => {
    const q = {};
    slots.forEach((s) => { if (r() < 0.4) q[s] = 0.1 + 0.85 * r(); });
    return { id: 'c' + i, cost: 20 + Math.floor(r() * 300), q };
  });
  return { slots, cands };
}

test('coverage objective is monotone and submodular (randomized check)', () => {
  const { slots, cands } = randomInstance(11, 10, 4);
  const f = C.coverageFn(slots);
  const r = C.mulberry32(3);
  for (let t = 0; t < 300; t++) {
    const A = cands.filter(() => r() < 0.3);
    const B = [...A, ...cands.filter((c) => !A.includes(c) && r() < 0.3)];
    const e = cands[Math.floor(r() * cands.length)];
    if (B.includes(e)) continue;
    const gA = f([...A, e]) - f(A), gB = f([...B, e]) - f(B);
    assert.ok(f(B) >= f(A) - 1e-12);
    assert.ok(gA >= gB - 1e-12);
  }
});

test('lazy greedy stays within budget, beats the (1-1/e)/2 guarantee, and the bound dominates OPT', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const { slots, cands } = randomInstance(seed, 12, 4);
    const f = C.coverageFn(slots);
    const B = 250 + seed * 13;
    const g = C.selectContext(cands, B, f);
    const opt = C.bruteForceOpt(cands, B, f);
    assert.ok(g.cost <= B);
    assert.ok(g.value >= ((1 - 1 / Math.E) / 2) * opt - 1e-9);
    assert.ok(g.upperBound >= opt - 1e-9, `bound ${g.upperBound} < opt ${opt}`);
    assert.ok(g.value <= opt + 1e-9);
  }
});

test('context plan: greedy reproduces full-evidence answers with fewer tokens than rank packing', () => {
  for (const q of ws.questions) {
    const p = C.contextPlan(ws, idx, q, 600);
    assert.ok(p.greedy.cost <= 600);
    assert.ok(p.greedy.coverage >= p.naive.coverage - 1e-9);
    assert.ok(p.greedy.fidelity.every((x) => x.same), q.id);
  }
});

test('simulation: guard is more accurate than latest-wins on its most confident answers', () => {
  const e = C.evaluateHistories(sim.histories, ws, C.mulberry32(7));
  assert.equal(e.n, 600);
  assert.ok(e.selective.meanGuard > e.selective.meanLatest);
  assert.ok(e.accuracy.guard > e.accuracy.relevance);
  assert.ok(e.ece < 0.15);
});
