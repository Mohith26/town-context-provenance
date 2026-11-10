import * as C from './src/core.js';

const [ws, sim] = await Promise.all([
  fetch('data/workspace.json').then((r) => r.json()),
  fetch('data/sim.json').then((r) => r.json()),
]);
const idx = C.buildIndex(ws);
const byId = Object.fromEntries(ws.sources.map((s) => [s.id, s]));
const NOW = Date.parse(ws.now);
const TYPE = { slack: 'Slack', linear: 'Linear', notion: 'Notion', github: 'GitHub' };
const TYPE_COLOR = { slack: '#a17cb9', linear: '#625fff', notion: '#79716b', github: '#2b2b28' };
const COL = { ok: '#5e9662', old: '#a87420', bad: '#c9502a', stale: '#4569a5', muted: '#737166', grid: '#ebece6' };
const $ = (id) => document.getElementById(id);
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif';
Chart.defaults.font.family = FONT;
Chart.defaults.color = '#737166';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const daysAgo = (iso) => Math.max(0, Math.round((NOW - Date.parse(iso)) / C.DAY));
const ago = (iso) => { const d = daysAgo(iso); return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
const valLabel = (v) => (v === C.OTHER ? 'Something no source mentions' : v);

function shortName(s) {
  if (s.type === 'linear') { const m = s.title.match(/^(ENG-\d+)/); return m ? `${m[1]} in Linear` : `${s.title.replace('Project update: ', '')} project in Linear`; }
  if (s.type === 'github') { const m = s.title.match(/^PR #\d+/); return m ? `${m[0]} (${s.container.split('/')[1]})` : s.title; }
  if (s.type === 'slack') return `${s.author.split(' ')[0]} in ${s.container}`;
  return `“${s.title}” in Notion`;
}
const tchip = (type) => `<span class="tchip t-${type}">${TYPE[type]}</span>`;

// ---------- precompute ----------
const results = {};
for (const q of ws.questions) {
  const g = C.guardAnswer(ws, q);
  const n = C.naiveAnswer(ws, idx, q);
  const judged = q.slots.map((s, i) => C.judgeNaive(n.claims[i], g.claims[i]));
  results[q.id] = { g, n, judged, follow: C.followUps(ws, g.claims) };
}
const fromHash = ws.questions.find((q) => '#' + q.id === location.hash);
const state = { q: (fromHash || ws.questions[0]).id, mode: 'guard', slot: null, budget: 500 };
const defaultSlot = (qid) => {
  const r = results[qid];
  const i = r.judged.findIndex((j) => j !== 'agrees');
  return ws.questions.find((q) => q.id === qid).slots[Math.max(0, i)];
};
state.slot = defaultSlot(state.q);

// ---------- sidebar + top stats ----------
const counts = {};
ws.sources.forEach((s) => (counts[s.type] = (counts[s.type] || 0) + 1));
$('conn').innerHTML = Object.keys(TYPE).map((t) => `<div class="conn"><span>${tchip(t)}</span><span>${counts[t] || 0} items</span></div>`).join('');

{
  let total = 0, naiveOk = 0, guardOk = 0;
  const updates = new Set();
  for (const q of ws.questions) {
    const r = results[q.id];
    q.slots.forEach((s, i) => {
      total++;
      if (C.scoreClaim(ws.truth[s], 'naive', r.n.claims[i])) naiveOk++;
      if (C.scoreClaim(ws.truth[s], 'guard', r.g.claims[i])) guardOk++;
    });
    r.follow.filter((f) => f.kind === 'update').forEach((f) => updates.add(f.sourceId));
  }
  $('stats').innerHTML = [
    ['Claims checked', `${total}`, `across ${ws.questions.length} questions and ${ws.sources.length} items in 4 tools`],
    ['Freshness-blind retrieval', `${naiveOk} / ${total} right`, `${total - naiveOk} stale, wrong, or hid a disagreement`],
    ['With provenance guard', `${guardOk} / ${total} right`, 'answered correctly or flagged correctly'],
    ['Out-of-date records found', `${updates.size}`, 'Linear issues and Notion docs to update'],
  ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
}

// ---------- thread ----------
function verdictClass(c) { return c.verdict === 'current' ? 'current' : c.verdict === 'conflict' ? 'conflict' : c.verdict === 'stale' ? 'aging' : 'missing'; }
function guardText(c) {
  if (c.verdict === 'current') return c.map;
  if (c.verdict === 'conflict') return `either ${c.contenders[0]} or ${c.contenders[1]}`;
  if (c.verdict === 'stale') { const last = c.classified[c.classified.length - 1]; return `${c.map} (last confirmed ${C.fmtDate(byId[last.id].ts)})`; }
  return 'unknown';
}
function citesFor(c) {
  const ids = c.classified.filter((o) => ['current', 'contested', 'aging'].includes(o.status)).map((o) => o.id);
  const types = [...new Set(ids.map((id) => byId[id].type))];
  return `<span class="cite">${types.map((t) => `<i style="background:${TYPE_COLOR[t]}">${TYPE[t]}</i>`).join('')}</span>`;
}
const VERDICT_LABEL = { current: 'Current', conflict: 'Sources disagree', stale: 'Needs re-check', none: 'No evidence' };
const NAIVE_LABEL = { agrees: 'Matches', stale: 'Stale', 'hides-conflict': 'Hid a disagreement', unverified: 'Unflagged, aging', missing: 'Not found' };

function renderTabs() {
  $('qtabs').innerHTML = ws.questions.map((q, i) => {
    const r = results[q.id];
    const bad = r.judged.some((j) => j !== 'agrees');
    const col = r.g.claims.some((c) => c.verdict === 'conflict') ? COL.bad : r.g.claims.some((c) => c.verdict === 'stale') ? COL.stale : bad ? COL.old : COL.ok;
    const short = q.text.length > 46 ? q.text.slice(0, 44).replace(/\s+\S*$/, '') + '…' : q.text;
    return `<button class="qtab ${q.id === state.q ? 'active' : ''}" data-q="${q.id}"><span class="dot" style="background:${col}"></span>${i + 1}. ${esc(short)}</button>`;
  }).join('');
  $('qtabs').querySelectorAll('.qtab').forEach((b) => b.addEventListener('click', () => {
    state.q = b.dataset.q; state.slot = defaultSlot(state.q); history.replaceState(null, '', '#' + state.q); renderAll();
  }));
}

function renderThread() {
  const q = ws.questions.find((x) => x.id === state.q);
  const r = results[q.id];
  let html = q.template;
  q.slots.forEach((slot, i) => {
    const gc = r.g.claims[i];
    const nc = r.n.claims[i];
    let span;
    if (state.mode === 'guard') {
      span = `<span class="claim ${verdictClass(gc)} ${slot === state.slot ? 'sel' : ''}" data-slot="${slot}">${esc(guardText(gc))}</span>${citesFor(gc)}`;
    } else {
      const j = r.judged[i];
      const src = nc.sourceId ? byId[nc.sourceId] : null;
      span = `<span class="claim ${j} ${slot === state.slot ? 'sel' : ''}" data-slot="${slot}">${esc(nc.value ?? 'unknown')}</span>${src ? `<span class="cite"><i style="background:${TYPE_COLOR[src.type]}">${TYPE[src.type]}</i></span>` : ''}`;
    }
    html = html.replace(`{${slot}}`, span);
  });

  const checks = q.slots.map((slot, i) => {
    const gc = r.g.claims[i], nc = r.n.claims[i], j = r.judged[i];
    const src = nc.sourceId ? byId[nc.sourceId] : null;
    const barCol = gc.verdict === 'current' ? COL.ok : gc.verdict === 'conflict' ? COL.bad : COL.stale;
    return `<div class="check ${slot === state.slot ? 'sel' : ''}" data-slot="${slot}">
      <div class="lbl">${esc(ws.slots[slot].label)}<small>${ws.kinds[ws.slots[slot].kind].label} · ${gc.obs.length} sources</small></div>
      <div class="val"><span class="badge b-${gc.verdict}">${VERDICT_LABEL[gc.verdict]}</span> ${esc(gc.verdict === 'conflict' ? gc.contenders.join(' vs ') : gc.map)}
        <div class="confbar"><div style="width:${pct(gc.conf)};background:${barCol}"></div></div><small>${pct(gc.conf)} belief in top value now</small></div>
      <div class="val"><span class="badge b-${j}">${NAIVE_LABEL[j]}</span> ${esc(nc.value ?? '')}<small>${src ? `from ${esc(shortName(src))}, ${C.fmtDate(src.ts)}` : 'no retrieved source mentions it'}</small></div>
      <div class="chev">›</div></div>`;
  }).join('');

  const fu = r.follow.map((f) => {
    if (f.kind === 'update') {
      const s = byId[f.sourceId], n = byId[f.byId];
      const old = r.g.claims.find((c) => c.slotId === f.slotId).classified.find((o) => o.id === f.sourceId).value;
      const map = r.g.claims.find((c) => c.slotId === f.slotId).map;
      return `<div class="fu"><div class="ico" style="background:var(--old-bg);color:var(--old)">↻</div><div><b>${esc(shortName(s))}</b> still says “${esc(old)}”. ${esc(shortName(n))} (${C.fmtDate(n.ts)}) says “${esc(map)}”. Draft an update for your approval?</div></div>`;
    }
    if (f.kind === 'conflict') return `<div class="fu"><div class="ico" style="background:var(--bad-bg);color:var(--bad)">!</div><div>${esc(f.text)}</div></div>`;
    return `<div class="fu"><div class="ico" style="background:var(--stale-bg);color:var(--stale)">?</div><div>${esc(f.text)}</div></div>`;
  }).join('');

  $('thread').innerHTML = `
    <div class="msg user"><div class="bubble-user">${esc(q.text)}</div><div class="avatar me">DO</div></div>
    <div class="msg"><div class="avatar asst">AI</div><div class="asst-body">
      <div class="asst-meta"><div class="asst-name">Assistant <span>· ${state.mode === 'guard' ? 'with provenance guard' : 'freshness-blind retrieval (top 6 by relevance)'}</span></div>
        <div class="seg"><button data-m="guard" class="${state.mode === 'guard' ? 'on' : ''}">With guard</button><button data-m="naive" class="${state.mode === 'naive' ? 'on' : ''}">Without</button></div></div>
      <div class="answer">${html}</div>
      <div class="checks"><div class="checks-head"><div>Claim</div><div>With guard</div><div>Freshness-blind</div><div></div></div>${checks}</div>
      ${fu ? `<div class="follow"><div class="follow-title">Suggested follow-ups · asks before acting</div>${fu}</div>` : ''}
    </div></div>`;
  $('thread').querySelectorAll('[data-slot]').forEach((el) => el.addEventListener('click', () => { state.slot = el.dataset.slot; renderThread(); renderDetail(); }));
  $('thread').querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.m; renderThread(); }));
}

// ---------- detail panel ----------
function explain(q, r, i) {
  const c = r.g.claims[i], nc = r.n.claims[i], j = r.judged[i];
  const kind = ws.slots[c.slotId].kind;
  const every = Math.round(1 / ws.kinds[kind].lambda);
  if (c.verdict === 'current' && j === 'stale') {
    const o = c.classified.find((x) => x.id === nc.sourceId);
    const by = byId[o.latestCurrent || o.supersededBy];
    return `Freshness-blind retrieval answered “${esc(nc.value)}” from ${esc(shortName(byId[nc.sourceId]))} because it matched the question's words best. ${esc(shortName(by))} said “${esc(c.map)}” on ${C.fmtDate(by.ts)}, and the guard weighs newer, more authoritative sources higher. Belief in “${esc(c.map)}” now: ${pct(c.conf)}.`;
  }
  if (c.verdict === 'current') {
    const newest = byId[c.classified[c.classified.length - 1].id];
    return `Fresh evidence agrees. ${c.obs.length} sources mention this; the newest is ${esc(shortName(newest))} (${ago(newest.ts)}). Belief in “${esc(c.map)}” now: ${pct(c.conf)}.`;
  }
  if (c.verdict === 'conflict') {
    return `The newest sources disagree (“${esc(c.contenders[0])}” vs “${esc(c.contenders[1])}”) and neither is clearly more authoritative or newer by enough to settle it. Retrieval just used whichever doc ranked higher for the question; the guard says they disagree and asks the doc owners.`;
  }
  const last = byId[c.classified[c.classified.length - 1].id];
  return `The newest evidence is ${daysAgo(last.ts)} days old, and ${ws.kinds[kind].label.toLowerCase()} changes about every ${every} days here, so belief decayed from ${pct(c.confAtLast)} right after that message to ${pct(c.conf)} now. The guard answers with a caveat instead of stating it as fact.`;
}

function timelineSVG(c) {
  const W = 392, laneH = 30, curveH = 96, pad = 8;
  const vals = c.res.values.filter((v) => v !== C.OTHER);
  const t0 = Math.min(...c.obs.map((o) => o.t)) - 2 * C.DAY, t1 = NOW;
  const x = (t) => 12 + ((t - t0) / (t1 - t0)) * (W - 24);
  const lanesTop = 6, curveTop = lanesTop + vals.length * laneH + 10, H = curveTop + curveH + 26;
  const colorFor = (v) => (c.verdict === 'current' ? (v === c.map ? COL.ok : COL.old) : c.verdict === 'conflict' ? (v === vals[0] ? COL.bad : '#d98a6a') : COL.stale);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evidence timeline and belief over time">`;
  vals.forEach((v, li) => {
    const y = lanesTop + li * laneH + 20;
    s += `<text x="12" y="${y - 9}" font-size="10.5" fill="${COL.muted}">${esc(v)}</text><line x1="12" x2="${W - 12}" y1="${y}" y2="${y}" stroke="${COL.grid}"/>`;
  });
  // supersession links
  for (const o of c.classified) {
    if (o.status !== 'superseded' || !o.supersededBy) continue;
    const b = c.classified.find((x) => x.id === o.supersededBy);
    const ya = lanesTop + vals.indexOf(o.value) * laneH + 20, yb = lanesTop + vals.indexOf(b.value) * laneH + 20;
    s += `<path d="M${x(o.t)},${ya} C${x(o.t) + 20},${ya} ${x(b.t) - 20},${yb} ${x(b.t)},${yb}" fill="none" stroke="${COL.old}" stroke-dasharray="3 3" stroke-width="1.2" opacity=".7"/>`;
  }
  for (const o of c.classified) {
    const y = lanesTop + vals.indexOf(o.value) * laneH + 20;
    const live = ['current', 'contested', 'aging'].includes(o.status);
    s += `<circle cx="${x(o.t)}" cy="${y}" r="${3 + 4 * o.r}" fill="${TYPE_COLOR[o.type]}" opacity="${live ? 1 : 0.4}" stroke="#fff" stroke-width="1.5"><title>${esc(TYPE[o.type])} · ${C.fmtDate(new Date(o.t).toISOString())} · says “${esc(o.value)}” · ${o.status}</title></circle>`;
  }
  // belief curves
  const N = 140, times = Array.from({ length: N + 1 }, (_, k) => t0 + ((t1 - t0) * k) / N);
  const curve = C.beliefCurve(c.obs, ws.kinds[ws.slots[c.slotId].kind].lambda, c.res.values, times);
  const yv = (p) => curveTop + curveH - p * curveH;
  s += `<rect x="12" y="${curveTop}" width="${W - 24}" height="${curveH}" fill="#fafaf6" rx="4"/>`;
  s += `<line x1="12" x2="${W - 12}" y1="${yv(ws.thresholds.ok)}" y2="${yv(ws.thresholds.ok)}" stroke="${COL.muted}" stroke-dasharray="2 3" opacity=".6"/><text x="${W - 14}" y="${yv(ws.thresholds.ok) - 3}" font-size="9.5" text-anchor="end" fill="${COL.muted}">answer threshold ${pct(ws.thresholds.ok)}</text>`;
  vals.forEach((v) => {
    const vi = c.res.values.indexOf(v);
    const d = times.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${yv(curve[k][vi]).toFixed(1)}`).join('');
    s += `<path d="${d}" fill="none" stroke="${colorFor(v)}" stroke-width="${v === c.map ? 2.2 : 1.4}" opacity="${v === c.map ? 1 : 0.75}"/>`;
  });
  s += `<line x1="${x(NOW)}" x2="${x(NOW)}" y1="${lanesTop}" y2="${curveTop + curveH}" stroke="${COL.muted}" stroke-width="1"/>`;
  // axis ticks
  const span = t1 - t0, step = span > 30 * C.DAY ? 14 * C.DAY : 7 * C.DAY;
  for (let t = t1; t > t0 + 3 * C.DAY; t -= step) {
    const label = t === t1 ? 'now' : C.fmtDate(new Date(t).toISOString());
    s += `<text x="${x(t)}" y="${H - 8}" font-size="10" text-anchor="${t === t1 ? 'end' : 'middle'}" fill="${COL.muted}">${label}</text>`;
  }
  return s + '</svg>';
}

function renderDetail() {
  const q = ws.questions.find((x) => x.id === state.q);
  const r = results[q.id];
  const i = q.slots.indexOf(state.slot);
  const c = r.g.claims[i];
  const kind = ws.slots[c.slotId].kind;
  const bars = c.ranked.map((x) => {
    const col = x.value === C.OTHER ? '#c9c7bd' : c.verdict === 'current' ? (x.value === c.map ? COL.ok : COL.old) : c.verdict === 'conflict' ? COL.bad : COL.stale;
    return `<div class="pbar"><div>${esc(valLabel(x.value))}</div><div class="pct">${pct(x.p)}</div><div class="track"><div style="width:${pct(x.p)};background:${col}"></div></div></div>`;
  }).join('');
  const STATUS = { current: ['current', 'Current'], superseded: ['superseded', 'Superseded'], contested: ['contested', 'Contested'], aging: ['aging', 'Aging'], outlier: ['outlier', 'Outlier'] };
  const cards = [...c.classified].reverse().map((o) => {
    const s = byId[o.id];
    const [cls, lab] = STATUS[o.status];
    const ageD = (NOW - o.t) / C.DAY;
    const w = o.r * Math.exp(-ws.kinds[kind].lambda * ageD);
    let txt = esc(s.text.split('\n\n')[0]);
    if (txt.length > 260) txt = txt.slice(0, 257) + '…';
    const needle = esc(o.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = o.value.split(' ')[0];
    txt = txt.replace(new RegExp(needle, 'i'), (m) => `<mark>${m}</mark>`);
    if (!txt.includes('<mark>') && first.length > 2) txt = txt.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), (m) => `<mark>${m}</mark>`);
    const sup = o.status === 'superseded' && o.supersededBy ? ` by ${esc(shortName(byId[o.supersededBy]))}` : '';
    return `<div class="srccard ${o.status === 'superseded' ? 'dim' : ''}">
      <div class="h">${tchip(s.type)} <b>${esc(s.container)}</b> · ${esc(s.author)} · ${C.fmtDate(s.ts)}</div>
      <div class="ttl">${esc(s.title)}</div><div class="txt">${txt}</div>
      <div class="f"><span>says “${esc(o.value)}” · reliability ${o.r.toFixed(2)} · weight now ${w.toFixed(2)}</span><span class="badge b-${cls}">${lab}${sup}</span></div></div>`;
  }).join('');
  $('detail').innerHTML = `
    <div class="d-kicker">Claim ${i + 1} of ${q.slots.length} · ${ws.kinds[kind].label} · changes about every ${Math.round(1 / ws.kinds[kind].lambda)} days</div>
    <div class="d-title">${esc(ws.slots[c.slotId].label)} <span class="badge b-${c.verdict}">${VERDICT_LABEL[c.verdict]}</span></div>
    <div class="d-explain">${explain(q, r, i)}</div>
    <div class="sec">Belief now</div>${bars}
    <div class="sec">Evidence timeline</div><div class="timeline">${timelineSVG(c)}</div>
    <div class="cap">Top: what each source said and when (dot size = source reliability, faded = superseded, dashed = what replaced it). Bottom: belief in each value over time, decaying between messages.</div>
    <div class="sec">Sources (${c.classified.length}), newest first</div>${cards}`;
}

// ---------- budget ----------
let budgetChart, selChart, calChart;
function statusFor(q, id) {
  const r = results[q.id];
  const order = ['current', 'contested', 'aging', 'superseded', 'outlier'];
  let best = null;
  for (const c of r.g.claims) for (const o of c.classified) if (o.id === id && (best === null || order.indexOf(o.status) < order.indexOf(best))) best = o.status;
  return best || 'noise';
}
const STATUS_TXT = { current: 'fresh evidence', contested: 'one side of a disagreement', aging: 'aging evidence', superseded: 'superseded', outlier: 'outlier', noise: 'no claim for this question' };
function miniList(q, sel) {
  if (!sel.length) return '<div class="empty">Nothing fits in this budget.</div>';
  return sel.map((cnd) => {
    const s = byId[cnd.id];
    const st = statusFor(q, s.id);
    return `<div class="src-mini"><div class="t">${esc(s.title)}</div><div class="tok">${s.tokens} tok</div>
      <div class="m">${tchip(s.type)}<span>${C.fmtDate(s.ts)}</span><span class="badge b-${st}">${STATUS_TXT[st]}</span></div></div>`;
  }).join('');
}
function renderBudget() {
  const q = ws.questions.find((x) => x.id === state.q);
  const B = state.budget;
  $('budgetOut').textContent = B;
  const p = C.contextPlan(ws, idx, q, B);
  const fg = p.greedy.fidelity.filter((x) => x.same).length, fn = p.naive.fidelity.filter((x) => x.same).length, n = q.slots.length;
  $('kpis').innerHTML = [
    ['Tokens used', `${p.greedy.cost} <small>/ ${B}</small>`, ''],
    ['Evidence coverage', `${pct(p.greedy.coverage)} <small>vs ${pct(p.naive.coverage)} top-k</small>`, ''],
    ['Certified vs. optimum', `≥ ${pct(p.boundRatio)}`, ''],
    ['Same answer as full context', `${fg}/${n} <small>vs ${fn}/${n} top-k</small>`, ''],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('selGreedy').innerHTML = miniList(q, p.greedy.selected);
  $('selNaive').innerHTML = miniList(q, p.naive.selected);

  const budgets = []; for (let b = 100; b <= 1500; b += 50) budgets.push(b);
  const plans = budgets.map((b) => C.contextPlan(ws, idx, q, b));
  const radius = budgets.map((b) => (b === B ? 5 : 0));
  const data = {
    labels: budgets,
    datasets: [
      { label: 'Optimizer (lazy greedy)', data: plans.map((x) => x.greedy.coverage * 100), borderColor: COL.ok, backgroundColor: COL.ok, pointRadius: radius, borderWidth: 2, tension: 0 },
      { label: 'Top results by relevance', data: plans.map((x) => x.naive.coverage * 100), borderColor: COL.old, backgroundColor: COL.old, pointRadius: radius, borderWidth: 2, tension: 0 },
      { label: 'Upper bound on optimum', data: plans.map((x) => Math.min(100, (x.greedy.upperBound / x.full) * 100)), borderColor: '#9a988e', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5, tension: 0 },
    ],
  };
  if (budgetChart) { budgetChart.data = data; budgetChart.update('none'); return; }
  budgetChart = new Chart($('budgetChart'), {
    type: 'line', data,
    options: {
      animation: false, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: FONT, size: 11.5 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } } },
      scales: {
        x: { title: { display: true, text: 'Token budget', font: { family: FONT, size: 11 } }, ticks: { maxTicksLimit: 8, font: { family: FONT, size: 11 } }, grid: { color: COL.grid } },
        y: { min: 0, max: 100, title: { display: true, text: 'Evidence coverage (%)', font: { family: FONT, size: 11 } }, ticks: { font: { family: FONT, size: 11 } }, grid: { color: COL.grid } },
      },
    },
  });
}
$('budget').addEventListener('input', (e) => { state.budget = +e.target.value; renderBudget(); });

// ---------- evaluation ----------
function renderEval() {
  const e = C.evaluateHistories(sim.histories, ws, C.mulberry32(7));
  const g20 = e.selective.guard.find((x) => x.coverage === 0.2).accuracy, l20 = e.selective.latest.find((x) => x.coverage === 0.2).accuracy;
  $('evalSub').textContent = `${e.n} simulated claim histories from a seeded simulator that is deliberately misspecified against the guard's priors: real change rates vary 0.5 to 2x, sources are less reliable than assumed, and most wrong reports are stale copies of an older value.`;
  $('evalKpis').innerHTML = [
    ['Top 20% most-trusted answers', `${pct(g20)} <small>vs ${pct(l20)} newest-source</small>`],
    ['Answered without a caveat', `${pct(e.guardConfidentShare)} <small>${pct(e.guardConfidentAccuracy)} right</small>`],
    ['Flagged cases where newest source was wrong', `${pct(e.flaggedWhereLatestWrong)}`],
    ['Calibration error (ECE)', `${e.ece.toFixed(3)}`],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const a = e.accuracy;
  $('evalNote').textContent = `Forced to always answer, the guard is no better than "newest source wins" (${pct(a.guard, 1)} vs ${pct(a.latest, 1)}; relevance-only ${pct(a.relevance, 1)}, most-authoritative ${pct(a.authority, 1)}): when the truth changed after the last message, nothing can know it. The value is in knowing when to trust the answer. Ranking by belief instead of recency gives a higher accuracy at every coverage level, and the guard is somewhat overconfident in the 70 to 80% band because the simulator's stale-copy errors are correlated in a way the model does not assume.`;
  const font = { family: FONT, size: 11 };
  selChart = new Chart($('selChart'), {
    type: 'line',
    data: { labels: e.selective.guard.map((x) => pct(x.coverage)), datasets: [
      { label: 'Guard (ranked by belief)', data: e.selective.guard.map((x) => x.accuracy * 100), borderColor: COL.ok, backgroundColor: COL.ok, borderWidth: 2, pointRadius: 2.5 },
      { label: 'Newest source wins (ranked by recency)', data: e.selective.latest.map((x) => x.accuracy * 100), borderColor: COL.old, backgroundColor: COL.old, borderWidth: 2, pointRadius: 2.5 },
    ] },
    options: { animation: false, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
      scales: { x: { title: { display: true, text: 'Share of questions answered', font }, ticks: { font }, grid: { color: COL.grid } }, y: { min: 40, max: 100, title: { display: true, text: 'Accuracy (%)', font }, ticks: { font }, grid: { color: COL.grid } } } },
  });
  const pts = e.bins.filter((b) => b.n > 0);
  calChart = new Chart($('calChart'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Guard', data: pts.map((b) => ({ x: b.conf * 100, y: b.acc * 100, n: b.n })), backgroundColor: COL.ok, pointRadius: pts.map((b) => 3 + Math.sqrt(b.n) / 2) },
      { label: 'Perfect calibration', type: 'line', data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: '#9a988e', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
    ] },
    options: { animation: false, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font } }, tooltip: { callbacks: { label: (c) => c.raw.n ? `confidence ${c.parsed.x.toFixed(0)}%, right ${c.parsed.y.toFixed(0)}% (n=${c.raw.n})` : '' } } },
      scales: { x: { min: 20, max: 100, title: { display: true, text: 'Stated confidence (%)', font }, ticks: { font }, grid: { color: COL.grid } }, y: { min: 20, max: 100, title: { display: true, text: 'Actually right (%)', font }, ticks: { font }, grid: { color: COL.grid } } } },
  });
}

function renderAll() { renderTabs(); renderThread(); renderDetail(); renderBudget(); }
renderAll();
renderEval();
