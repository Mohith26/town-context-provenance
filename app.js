import * as C from './src/core.js';

const [ws, sim] = await Promise.all([
  fetch('data/workspace.json').then((r) => r.json()),
  fetch('data/sim.json').then((r) => r.json()),
]);
const idx = C.buildIndex(ws);
const byId = Object.fromEntries(ws.sources.map((s) => [s.id, s]));
const NOW = Date.parse(ws.now);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const daysAgo = (iso) => Math.max(0, Math.round((NOW - Date.parse(iso)) / C.DAY));
const ago = (iso) => { const d = daysAgo(iso); return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
const valLabel = (v) => (v === C.OTHER ? 'Something no source mentions' : v);

const FONT = getComputedStyle(document.body).fontFamily;
const TYPE = { slack: 'Slack', linear: 'Linear', notion: 'Notion', github: 'GitHub' };
const TYPE_COLOR = { slack: '#a17cb9', linear: '#625fff', notion: '#79716b', github: '#24292f' };
// Integration icons as Town's app shows them (served from town.com, not copied here).
const ICON = { slack: 'https://www.town.com/integrations/slack.png', linear: 'https://www.town.com/integrations/linear_light.png', notion: 'https://www.town.com/integrations/notion.png', github: 'https://www.town.com/integrations/github_light.png' };
const ico = (t) => `<img src="${ICON[t]}" alt="${TYPE[t]}" title="${TYPE[t]}" />`;
const COL = { ok: '#4f8a55', old: '#a26c12', bad: '#c9452b', stale: '#3f63a0', muted: '#6f706a', grid: '#efefec', ink: '#252525' };
const BUD = 'https://www.town.com/images/brand/home/townies/bud.webp';
const PEOPLE_COL = { 'Dana Ortiz': '#c2410c', 'Sam Okafor': '#4569a5', 'Jules Martin': '#5e9662', 'Priya Raman': '#a17cb9', 'Arjun Mehta': '#b88022', 'Tess Huang': '#df5583', 'Marcus Lee': '#509578', 'Wen Li': '#625fff' };
const initials = (n) => n.split(' ').map((x) => x[0]).join('');

Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 11;
Chart.defaults.color = COL.muted;
const TOOLTIP = { backgroundColor: '#ffffff', titleColor: '#141412', bodyColor: '#3f403b', borderColor: '#e6e6e1', borderWidth: 1, padding: 8, cornerRadius: 8, displayColors: true, boxWidth: 8, boxHeight: 8, usePointStyle: true, titleFont: { family: FONT, weight: '500', size: 12 }, bodyFont: { family: FONT, size: 12 } };
const LEGEND = { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { family: FONT, size: 11.5 } } };
const axis = (title, extra = {}) => ({ title: { display: true, text: title, font: { family: FONT, size: 11 }, color: COL.muted }, grid: { color: COL.grid, drawTicks: false }, border: { display: false }, ticks: { padding: 6, font: { family: FONT, size: 11 } }, ...extra });

function shortName(s) {
  if (s.type === 'linear') { const m = s.title.match(/^(ENG-\d+)/); return m ? `${m[1]} in Linear` : `${s.title.replace('Project update: ', '')} project in Linear`; }
  if (s.type === 'github') { const m = s.title.match(/^PR #\d+/); return m ? `${m[0]} (${s.container.split('/')[1]})` : s.title; }
  if (s.type === 'slack') return `${s.author.split(' ')[0]} in ${s.container}`;
  return `“${s.title}” in Notion`;
}

// ---------- precompute ----------
const results = {};
for (const q of ws.questions) {
  const g = C.guardAnswer(ws, q);
  const n = C.naiveAnswer(ws, idx, q);
  const judged = q.slots.map((s, i) => C.judgeNaive(n.claims[i], g.claims[i]));
  results[q.id] = { g, n, judged, follow: C.followUps(ws, g.claims) };
}
const THREAD_TITLES = { q1: 'Ledger Sync v2 launch and webhook fix', q2: 'Who owns the Okta SSO loop', q3: 'Public API rate limit for Brightline', q4: 'CDC approach for Ledger Sync', q5: 'Payments on-call this week' };
const ASKER = { q1: 'Dana Ortiz', q2: 'Jules Martin', q3: 'Tess Huang', q4: 'Sam Okafor', q5: 'Jules Martin' };
const ASK_TIME = { q1: '9:02 AM', q2: '8:47 AM', q3: '8:31 AM', q4: '8:10 AM', q5: '7:55 AM' };
const fromHash = ws.questions.find((q) => '#' + q.id === location.hash);
const state = { q: (fromHash || ws.questions[0]).id, slot: null, budget: 500, tab: 'sources', compare: false };
const defaultSlot = (qid) => {
  const r = results[qid];
  const i = r.judged.findIndex((j) => j !== 'agrees');
  return ws.questions.find((q) => q.id === qid).slots[Math.max(0, i)];
};
state.slot = defaultSlot(state.q);

const VERDICT_LABEL = { current: 'Current', conflict: 'Sources disagree', stale: 'Needs re-check', none: 'No evidence' };
const NAIVE_LABEL = { agrees: 'Same', stale: 'Stale', 'hides-conflict': 'Hid a disagreement', unverified: 'Unflagged, aging', missing: 'Not found' };
const verdictClass = (c) => (c.verdict === 'current' ? 'current' : c.verdict === 'conflict' ? 'conflict' : c.verdict === 'stale' ? 'aging' : 'missing');

// ---------- thread list ----------
function threadMarker(qid) {
  const r = results[qid];
  if (r.g.claims.some((c) => c.verdict === 'conflict')) return `<span class="t-dot" style="background:var(--dot-amber)" title="Sources disagree"></span>`;
  if (r.g.claims.some((c) => c.verdict === 'stale')) return `<span class="t-dot" style="background:var(--dot-blue)" title="Needs re-check"></span>`;
  const n = r.judged.filter((j) => j === 'stale').length;
  return n ? `<span class="t-badge" title="${n} corrected">${n}</span>` : '';
}
const FILLER = ['Weekly client summary', 'Prep for Brightline QBR', 'Draft launch comms for v2', 'Board update outline', 'Q4 hiring plan review', 'Reply to Northwind about sandbox', 'Travel for the Denver offsite', 'Clean up the shared drive'];
function renderThreads() {
  const live = ws.questions.map((q) => `<div class="t-item live ${q.id === state.q ? 'sel' : ''}" data-q="${q.id}"><span class="t-txt">${esc(THREAD_TITLES[q.id])}</span>${threadMarker(q.id)}</div>`).join('');
  const fill = FILLER.map((t) => `<div class="t-item"><span class="t-txt">${esc(t)}</span></div>`).join('');
  $('threadList').innerHTML = live + fill;
  $('threadList').querySelectorAll('.t-item.live').forEach((el) => el.addEventListener('click', () => {
    state.q = el.dataset.q; state.slot = defaultSlot(state.q); state.compare = false;
    history.replaceState(null, '', '#' + state.q); renderAll();
  }));
}

// ---------- conversation ----------
function guardText(c) {
  if (c.verdict === 'current') return c.map;
  if (c.verdict === 'conflict') return `either ${c.contenders[0]} or ${c.contenders[1]}`;
  if (c.verdict === 'stale') { const last = c.classified[c.classified.length - 1]; return `${c.map} (last confirmed ${C.fmtDate(byId[last.id].ts)})`; }
  return 'unknown';
}
function srcIcons(ids) {
  const types = [...new Set(ids.map((id) => byId[id].type))];
  return `<span class="src-ico">${types.map(ico).join('')}</span>`;
}
const liveIds = (c) => c.classified.filter((o) => ['current', 'contested', 'aging'].includes(o.status)).map((o) => o.id);

function renderConvo() {
  const q = ws.questions.find((x) => x.id === state.q);
  const r = results[q.id];
  const asker = ASKER[q.id];
  const allSrc = new Set(r.g.claims.flatMap((c) => c.obs.map((o) => o.id)));
  const types = [...new Set([...allSrc].map((id) => byId[id].type))];
  $('thTitle').innerHTML = `<i class="hgi-stroke hgi-bubble-chat"></i>${esc(THREAD_TITLES[q.id])}<span class="chan">${types.map(ico).join('')}</span>`;
  $('thAvatars').innerHTML = `<div class="av" style="background:${PEOPLE_COL[asker]}">${initials(asker)}</div><div class="av" style="background:#f1ead6"><img src="${BUD}" alt="" style="width:22px;height:22px;object-fit:cover;object-position:50% 4%;border-radius:999px" /></div>`;
  $('composerPh').textContent = `Message ${THREAD_TITLES[q.id]}`;

  let answer = q.template;
  q.slots.forEach((slot, i) => {
    const gc = r.g.claims[i];
    answer = answer.replace(`{${slot}}`, `<span class="claim ${verdictClass(gc)} ${slot === state.slot ? 'sel' : ''}" data-slot="${slot}">${esc(guardText(gc))}</span>${srcIcons(liveIds(gc))}`);
  });
  const notes = r.follow.filter((f) => f.kind !== 'update').map((f) => `<p>${esc(f.text)}</p>`).join('');
  const corrected = r.judged.filter((j) => j === 'stale').length;
  const flagged = r.g.claims.filter((c) => c.verdict !== 'current').length;
  const nSrc = allSrc.size;
  const sub = [corrected ? `${corrected} corrected` : '', flagged ? `${flagged} flagged` : '', !corrected && !flagged ? 'all current' : ''].filter(Boolean).join(' · ');

  const rows = q.slots.map((slot, i) => {
    const gc = r.g.claims[i], nc = r.n.claims[i], j = r.judged[i];
    const src = nc.sourceId ? byId[nc.sourceId] : null;
    let meta;
    if (j === 'stale') meta = `Top search result said <s>${esc(nc.value)}</s> (${esc(shortName(src))}, ${C.fmtDate(src.ts)}), superseded by newer sources`;
    else if (j === 'hides-conflict') meta = `Top search result only showed ${esc(nc.value)} (${esc(shortName(src))})`;
    else if (j === 'unverified') meta = `Newest source is ${daysAgo(byId[gc.classified[gc.classified.length - 1].id].ts)} days old on a fact that changes about weekly`;
    else meta = `${gc.obs.length} sources agree; newest ${ago(byId[gc.classified[gc.classified.length - 1].id].ts)}`;
    return `<div class="cc-row ${slot === state.slot ? 'sel' : ''}" data-slot="${slot}">
      <div class="cc-label">${esc(ws.slots[slot].label)}</div>
      <div class="cc-val"><span class="pill p-${gc.verdict}">${VERDICT_LABEL[gc.verdict]} · ${pct(gc.conf)}</span></div>
      <div class="cc-meta">${meta}</div></div>`;
  }).join('');

  let naiveTxt = q.template;
  q.slots.forEach((slot, i) => { naiveTxt = naiveTxt.replace(`{${slot}}`, `<b style="display:inline;color:inherit;font-size:inherit">${esc(r.n.claims[i].value ?? 'unknown')}</b>`); });

  $('messages').innerHTML = `
    <div class="day">Today</div>
    <div class="msg"><div class="m-av" style="background:${PEOPLE_COL[asker]}">${initials(asker)}</div>
      <div><div class="m-head"><span class="m-name">${esc(asker.split(' ')[0])}</span><span class="m-time">${ASK_TIME[q.id]}</span></div>
      <div class="m-text"><p>@Bud ${esc(q.text)}</p></div></div></div>
    <div class="msg"><div class="m-av townie"><img src="${BUD}" alt="" /></div>
      <div><div class="m-head"><span class="m-name">Bud</span><span class="m-time">${ASK_TIME[q.id].replace(/:(\d\d)/, (m, mm) => ':' + String(+mm + 1).padStart(2, '0'))}</span></div>
      <div class="m-text"><p>${answer}</p>${notes}</div>
      <div class="check-card">
        <div class="cc-head"><i class="hgi-stroke hgi-security-check"></i><span>Checked ${q.slots.length} claim${q.slots.length > 1 ? 's' : ''} against ${nSrc} sources</span><span class="cc-sub">· ${sub}</span>
          <label class="cc-toggle" id="cmp"><span>Compare unchecked</span><span class="switch ${state.compare ? 'on' : ''}"></span></label></div>
        ${rows}
        ${state.compare ? `<div class="naive"><b>Without the check (top 6 search results by relevance), Bud would have said:</b>${naiveTxt}</div>` : ''}
      </div>
      <div class="m-actions"><i class="hgi-stroke hgi-share-08"></i><i class="hgi-stroke hgi-copy-01"></i></div>
      </div></div>`;

  const ups = r.follow.filter((f) => f.kind === 'update').map((f) => {
    const s = byId[f.sourceId], c = r.g.claims.find((x) => x.slotId === f.slotId);
    return `<span class="sg" title="${esc(f.text)}">${ico(s.type).replace('<img', '<img style="width:14px;height:14px"')}Update ${esc(shortName(s).replace(/ in (Linear|Notion)$/, ''))} to “${esc(c.map)}”</span>`;
  });
  const others = r.follow.filter((f) => f.kind !== 'update').map((f) => f.kind === 'conflict'
    ? `<span class="sg"><i class="hgi-stroke hgi-mail-01"></i>Ask the doc owners which limit is right</span>`
    : `<span class="sg"><i class="hgi-stroke hgi-refresh"></i>Re-check with the team before relying on it</span>`);
  $('suggest').innerHTML = [...ups, ...others].join('');

  $('messages').querySelectorAll('[data-slot]').forEach((el) => el.addEventListener('click', () => { state.slot = el.dataset.slot; setTab('sources'); renderConvo(); renderSources(); }));
  $('cmp').addEventListener('click', (e) => { e.preventDefault(); state.compare = !state.compare; renderConvo(); });
}

// ---------- panel: sources ----------
function explain(r, i) {
  const c = r.g.claims[i], nc = r.n.claims[i], j = r.judged[i];
  const kind = ws.slots[c.slotId].kind;
  const every = Math.round(1 / ws.kinds[kind].lambda);
  if (c.verdict === 'current' && j === 'stale') {
    const o = c.classified.find((x) => x.id === nc.sourceId);
    const by = byId[o.latestCurrent || o.supersededBy];
    return `The top search result, ${esc(shortName(byId[nc.sourceId]))}, says “${esc(nc.value)}”: it matched the question's words best. ${esc(shortName(by))} said “${esc(c.map)}” on ${C.fmtDate(by.ts)}, and Bud weighs newer, more authoritative sources higher.`;
  }
  if (c.verdict === 'current') {
    const newest = byId[c.classified[c.classified.length - 1].id];
    return `Fresh evidence agrees. ${c.obs.length} sources mention this; the newest is ${esc(shortName(newest))} (${ago(newest.ts)}).`;
  }
  if (c.verdict === 'conflict') return `The newest sources disagree (“${esc(c.contenders[0])}” vs “${esc(c.contenders[1])}”), and neither is newer or more authoritative by enough to settle it. Search would have used whichever doc ranked higher; Bud says they disagree and suggests asking the doc owners.`;
  const last = byId[c.classified[c.classified.length - 1].id];
  return `The newest evidence is ${daysAgo(last.ts)} days old, and ${ws.kinds[kind].label.toLowerCase()} changes about every ${every} days here, so belief fell from ${pct(c.confAtLast)} right after that message to ${pct(c.conf)} now. Bud answers with a caveat instead of stating it as fact.`;
}

function timelineSVG(c) {
  const W = 410, laneH = 30, curveH = 92;
  const vals = c.res.values.filter((v) => v !== C.OTHER);
  const t0 = Math.min(...c.obs.map((o) => o.t)) - 2 * C.DAY, t1 = NOW;
  const x = (t) => 10 + ((t - t0) / (t1 - t0)) * (W - 20);
  const lanesTop = 4, curveTop = lanesTop + vals.length * laneH + 8, H = curveTop + curveH + 24;
  const colorFor = (v) => (c.verdict === 'current' ? (v === c.map ? COL.ok : COL.old) : c.verdict === 'conflict' ? (v === vals[0] ? COL.bad : '#d98a6a') : COL.stale);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evidence timeline and belief over time" font-family="${esc(FONT)}">`;
  vals.forEach((v, li) => {
    const y = lanesTop + li * laneH + 20;
    s += `<text x="10" y="${y - 9}" font-size="10.5" fill="${COL.muted}">${esc(v)}</text><line x1="10" x2="${W - 10}" y1="${y}" y2="${y}" stroke="${COL.grid}"/>`;
  });
  for (const o of c.classified) {
    if (o.status !== 'superseded' || !o.supersededBy) continue;
    const b = c.classified.find((z) => z.id === o.supersededBy);
    const ya = lanesTop + vals.indexOf(o.value) * laneH + 20, yb = lanesTop + vals.indexOf(b.value) * laneH + 20;
    s += `<path d="M${x(o.t)},${ya} C${x(o.t) + 20},${ya} ${x(b.t) - 20},${yb} ${x(b.t)},${yb}" fill="none" stroke="${COL.old}" stroke-dasharray="3 3" stroke-width="1.2" opacity=".7"/>`;
  }
  for (const o of c.classified) {
    const y = lanesTop + vals.indexOf(o.value) * laneH + 20;
    const live = ['current', 'contested', 'aging'].includes(o.status);
    s += `<circle cx="${x(o.t)}" cy="${y}" r="${3 + 4 * o.r}" fill="${TYPE_COLOR[o.type]}" opacity="${live ? 1 : 0.4}" stroke="#fff" stroke-width="1.5"><title>${esc(TYPE[o.type])} · ${C.fmtDate(new Date(o.t).toISOString())} · says “${esc(o.value)}” · ${o.status}</title></circle>`;
  }
  const N = 140, times = Array.from({ length: N + 1 }, (_, k) => t0 + ((t1 - t0) * k) / N);
  const curve = C.beliefCurve(c.obs, ws.kinds[ws.slots[c.slotId].kind].lambda, c.res.values, times);
  const yv = (p) => curveTop + curveH - p * curveH;
  s += `<rect x="10" y="${curveTop}" width="${W - 20}" height="${curveH}" fill="#fafaf7" rx="6"/>`;
  s += `<line x1="10" x2="${W - 10}" y1="${yv(ws.thresholds.ok)}" y2="${yv(ws.thresholds.ok)}" stroke="${COL.muted}" stroke-dasharray="2 3" opacity=".55"/><text x="${W - 12}" y="${yv(ws.thresholds.ok) - 4}" font-size="9.5" text-anchor="end" fill="${COL.muted}">answer threshold ${pct(ws.thresholds.ok)}</text>`;
  vals.forEach((v) => {
    const vi = c.res.values.indexOf(v);
    const d = times.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${yv(curve[k][vi]).toFixed(1)}`).join('');
    s += `<path d="${d}" fill="none" stroke="${colorFor(v)}" stroke-width="${v === c.map ? 2 : 1.3}" opacity="${v === c.map ? 1 : 0.75}"/>`;
  });
  s += `<line x1="${x(NOW)}" x2="${x(NOW)}" y1="${lanesTop}" y2="${curveTop + curveH}" stroke="${COL.muted}" stroke-width="1" opacity=".6"/>`;
  const step = t1 - t0 > 30 * C.DAY ? 14 * C.DAY : 7 * C.DAY;
  for (let t = t1; t > t0 + 3 * C.DAY; t -= step) {
    const label = t === t1 ? 'now' : C.fmtDate(new Date(t).toISOString());
    s += `<text x="${x(t)}" y="${H - 7}" font-size="10" text-anchor="${t === t1 ? 'end' : 'middle'}" fill="${COL.muted}">${label}</text>`;
  }
  return s + '</svg>';
}

function renderSources() {
  const q = ws.questions.find((x) => x.id === state.q);
  const r = results[q.id];
  const i = q.slots.indexOf(state.slot);
  const c = r.g.claims[i];
  const kind = ws.slots[c.slotId].kind;
  const bars = c.ranked.map((z) => {
    const col = z.value === C.OTHER ? '#cfcfc9' : c.verdict === 'current' ? (z.value === c.map ? COL.ok : COL.old) : c.verdict === 'conflict' ? COL.bad : COL.stale;
    return `<div class="pbar"><div>${esc(valLabel(z.value))}</div><div class="pct">${pct(z.p)}</div><div class="track"><div style="width:${pct(z.p)};background:${col}"></div></div></div>`;
  }).join('');
  const STATUS = { current: ['current', 'Current'], superseded: ['superseded', 'Superseded'], contested: ['contested', 'Contested'], aging: ['aging', 'Aging'], outlier: ['outlier', 'Outlier'] };
  const cards = [...c.classified].reverse().map((o) => {
    const s = byId[o.id];
    const [cls, lab] = STATUS[o.status];
    const w = o.r * Math.exp(-ws.kinds[kind].lambda * ((NOW - o.t) / C.DAY));
    let txt = esc(s.text.split('\n\n')[0]);
    if (txt.length > 240) txt = txt.slice(0, 237) + '…';
    const reEsc = (z) => z.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    txt = txt.replace(new RegExp(reEsc(esc(o.value)), 'i'), (m) => `<mark>${m}</mark>`);
    const first = o.value.split(' ')[0];
    if (!txt.includes('<mark>') && first.length > 2) txt = txt.replace(new RegExp(`\\b${reEsc(first)}\\b`, 'i'), (m) => `<mark>${m}</mark>`);
    const sup = o.status === 'superseded' && o.supersededBy ? ` by ${esc(shortName(byId[o.supersededBy]))}` : '';
    return `<div class="srccard ${o.status === 'superseded' ? 'dim' : ''}">
      <div class="sc-h">${ico(s.type)}<b>${esc(s.container)}</b><span>· ${esc(s.author)} · ${C.fmtDate(s.ts)}</span></div>
      <div class="sc-t">${esc(s.title)}</div><div class="sc-x">${txt}</div>
      <div class="sc-f"><span>Says “${esc(o.value)}” · reliability ${o.r.toFixed(2)} · weight now ${w.toFixed(2)}</span><span class="pill p-${cls}">${lab}${sup}</span></div></div>`;
  }).join('');
  $('tab-sources').innerHTML = `
    <div class="d-kicker">Claim ${i + 1} of ${q.slots.length} · ${ws.kinds[kind].label} · changes about every ${Math.round(1 / ws.kinds[kind].lambda)} days</div>
    <div class="d-title">${esc(ws.slots[c.slotId].label)} <span class="pill p-${c.verdict}">${VERDICT_LABEL[c.verdict]}</span></div>
    <div class="d-explain">${explain(r, i)}</div>
    <div class="sub-h">Belief now</div>${bars}
    <div class="sub-h">Evidence timeline</div><div class="timeline">${timelineSVG(c)}</div>
    <div class="cap">Top: what each source said and when (dot size = reliability, faded = superseded, dashed = what replaced it). Bottom: belief in each value over time.</div>
    <div class="sub-h">Sources (${c.classified.length}), newest first</div>${cards}`;
}

// ---------- panel: budget ----------
let budgetChart, selChart, calChart;
function statusFor(q, id) {
  const order = ['current', 'contested', 'aging', 'superseded', 'outlier'];
  let best = null;
  for (const c of results[q.id].g.claims) for (const o of c.classified) if (o.id === id && (best === null || order.indexOf(o.status) < order.indexOf(best))) best = o.status;
  return best || 'noise';
}
const STATUS_TXT = { current: 'Fresh', contested: 'Contested', aging: 'Aging', superseded: 'Superseded', outlier: 'Outlier', noise: 'No claim' };
function tbl(q, sel) {
  if (!sel.length) return '<div class="empty">Nothing fits in this budget.</div>';
  return sel.map((cnd) => {
    const s = byId[cnd.id];
    const st = statusFor(q, s.id);
    return `<div class="tr">${ico(s.type)}<div class="tt">${esc(s.title)}<small>${C.fmtDate(s.ts)}</small></div><div class="tk"><span class="pill p-${st === 'current' ? 'current' : st}">${STATUS_TXT[st]}</span>${s.tokens}</div></div>`;
  }).join('');
}
function renderBudget() {
  const q = ws.questions.find((x) => x.id === state.q);
  const B = state.budget;
  $('budgetOut').textContent = B;
  const p = C.contextPlan(ws, idx, q, B);
  const fg = p.greedy.fidelity.filter((z) => z.same).length, fn = p.naive.fidelity.filter((z) => z.same).length, n = q.slots.length;
  $('kpis').innerHTML = [
    ['Tokens used', `${p.greedy.cost} <small>/ ${B}</small>`],
    ['Evidence coverage', `${pct(p.greedy.coverage)} <small>vs ${pct(p.naive.coverage)} search</small>`],
    ['Certified vs. best possible', `≥ ${pct(p.boundRatio)}`],
    ['Same answer as all evidence', `${fg}/${n} <small>vs ${fn}/${n} search</small>`],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('selGreedy').innerHTML = tbl(q, p.greedy.selected);
  $('selNaive').innerHTML = tbl(q, p.naive.selected);

  const budgets = []; for (let b = 100; b <= 1500; b += 50) budgets.push(b);
  const plans = budgets.map((b) => C.contextPlan(ws, idx, q, b));
  const radius = budgets.map((b) => (b === B ? 4 : 0));
  const data = {
    labels: budgets,
    datasets: [
      { label: 'Bud (lazy greedy)', data: plans.map((z) => z.greedy.coverage * 100), borderColor: COL.ink, backgroundColor: COL.ink, pointRadius: radius, borderWidth: 1.8, tension: 0 },
      { label: 'Top results by relevance', data: plans.map((z) => z.naive.coverage * 100), borderColor: '#c9a46a', backgroundColor: '#c9a46a', pointRadius: radius, borderWidth: 1.8, tension: 0 },
      { label: 'Upper bound on best', data: plans.map((z) => Math.min(100, (z.greedy.upperBound / z.full) * 100)), borderColor: '#b9bab4', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.2, tension: 0 },
    ],
  };
  if (budgetChart) { budgetChart.data = data; budgetChart.update('none'); return; }
  budgetChart = new Chart($('budgetChart'), {
    type: 'line', data,
    options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: LEGEND, tooltip: { ...TOOLTIP, callbacks: { title: (it) => `${it[0].label} tokens`, label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } } },
      scales: { x: axis('Token budget', { ticks: { maxTicksLimit: 8, padding: 6 } }), y: axis('Coverage (%)', { min: 0, max: 100 }) } },
  });
}
$('budget').addEventListener('input', (e) => { state.budget = +e.target.value; renderBudget(); });

// ---------- panel: accuracy ----------
function renderAccuracy() {
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
    ['Claims checked', `${total} <small>in ${ws.questions.length} threads</small>`],
    ['Items across 4 tools', `${ws.sources.length}`],
    ['Search alone, right', `${naiveOk} / ${total}`],
    ['With context check, right', `${guardOk} / ${total}`],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('') +
    `<div class="kpi" style="grid-column:1/-1"><div class="k">Out-of-date records found</div><div class="v">${updates.size} <small>Linear issues and Notion docs Bud can offer to update</small></div></div>`;

  const e = C.evaluateHistories(sim.histories, ws, C.mulberry32(7));
  const g20 = e.selective.guard.find((z) => z.coverage === 0.2).accuracy, l20 = e.selective.latest.find((z) => z.coverage === 0.2).accuracy;
  $('evalSub').textContent = `${e.n} simulated claim histories from a seeded simulator that is deliberately different from Bud's assumptions: real change rates vary 0.5 to 2x, sources are less reliable than assumed, and most wrong reports are stale copies of an older value.`;
  $('evalKpis').innerHTML = [
    ['Top 20% most-trusted answers', `${pct(g20)} <small>vs ${pct(l20)} newest-source</small>`],
    ['Answered without a caveat', `${pct(e.guardConfidentShare)} <small>${pct(e.guardConfidentAccuracy)} right</small>`],
    ['Flagged where newest source was wrong', `${pct(e.flaggedWhereLatestWrong)}`],
    ['Calibration error (ECE)', `${e.ece.toFixed(3)}`],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const a = e.accuracy;
  $('evalNote').textContent = `Forced to always answer, the check is no better than "newest source wins" (${pct(a.guard, 1)} vs ${pct(a.latest, 1)}; relevance-only ${pct(a.relevance, 1)}, most-authoritative ${pct(a.authority, 1)}): when the truth changed after the last message, nothing can know it. The value is in knowing when to trust the answer. It is somewhat overconfident in the 70 to 80% band because the simulator's stale-copy errors are correlated in a way the model does not assume.`;
  selChart = new Chart($('selChart'), {
    type: 'line',
    data: { labels: e.selective.guard.map((z) => pct(z.coverage)), datasets: [
      { label: 'Context check (by belief)', data: e.selective.guard.map((z) => z.accuracy * 100), borderColor: COL.ink, backgroundColor: COL.ink, borderWidth: 1.8, pointRadius: 2.5 },
      { label: 'Newest source (by recency)', data: e.selective.latest.map((z) => z.accuracy * 100), borderColor: '#c9a46a', backgroundColor: '#c9a46a', borderWidth: 1.8, pointRadius: 2.5 },
    ] },
    options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: LEGEND, tooltip: { ...TOOLTIP, callbacks: { title: (it) => `Answering ${it[0].label} of questions`, label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
      scales: { x: axis('Share of questions answered'), y: axis('Accuracy (%)', { min: 40, max: 100 }) } },
  });
  const pts = e.bins.filter((b) => b.n > 0);
  calChart = new Chart($('calChart'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Context check', data: pts.map((b) => ({ x: b.conf * 100, y: b.acc * 100, n: b.n })), backgroundColor: COL.ink, pointRadius: pts.map((b) => 2.5 + Math.sqrt(b.n) / 2.2) },
      { label: 'Perfect calibration', type: 'line', data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: '#b9bab4', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.2 },
    ] },
    options: { animation: false, maintainAspectRatio: false,
      plugins: { legend: LEGEND, tooltip: { ...TOOLTIP, callbacks: { label: (c) => (c.raw.n ? ` confidence ${c.parsed.x.toFixed(0)}%, right ${c.parsed.y.toFixed(0)}% (n=${c.raw.n})` : '') } } },
      scales: { x: axis('Stated confidence (%)', { min: 20, max: 100 }), y: axis('Actually right (%)', { min: 20, max: 100 }) } },
  });
}

// ---------- tabs ----------
let accuracyDone = false;
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['sources', 'budget', 'accuracy'].forEach((k) => { $('tab-' + k).hidden = k !== t; });
  if (t === 'accuracy' && !accuracyDone) { accuracyDone = true; renderAccuracy(); }
  if (t === 'budget') renderBudget();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
const showPanel = (on) => { $('panel').hidden = !on; $('detailToggle').classList.toggle('on', on); };
$('detailToggle').addEventListener('click', () => showPanel($('panel').hidden));
$('panelClose').addEventListener('click', () => showPanel(false));

// Panel footer: the approval-gated follow-up for this thread (Town asks before acting).
function renderFoot() {
  const r = results[state.q];
  const up = r.follow.find((f) => f.kind === 'update');
  const cf = r.follow.find((f) => f.kind !== 'update');
  let label, icon;
  if (up) { const s = byId[up.sourceId]; label = `Draft update to ${shortName(s)}`; icon = 'hgi-edit-02'; }
  else if (cf && cf.kind === 'conflict') { label = 'Draft a question to the doc owners'; icon = 'hgi-mail-01'; }
  else if (cf) { label = 'Ask the team to confirm'; icon = 'hgi-mail-01'; }
  $('panelFoot').innerHTML = (label ? `<button class="pf-primary" id="pfGo"><i class="hgi-stroke ${icon}"></i>${esc(label)}</button>` : '') +
    `<button class="pf-ghost"><i class="hgi-stroke hgi-share-08"></i>Share</button><div class="pf-note" id="pfNote" hidden>Concept demo: Bud would draft this and wait for your approval before anything is sent.</div>`;
  const go = $('pfGo'); if (go) go.addEventListener('click', () => { $('pfNote').hidden = false; });
}

function renderAll() { renderThreads(); renderConvo(); renderSources(); renderFoot(); if (state.tab === 'budget') renderBudget(); }
renderAll();
const tabFromQuery = new URLSearchParams(location.search).get('tab');
setTab(['sources', 'budget', 'accuracy'].includes(tabFromQuery) ? tabFromQuery : 'sources');
