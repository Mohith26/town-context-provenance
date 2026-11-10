// Seeded generator for the synthetic team workspace + simulated claim histories.
// Usage: node scripts/generate.mjs   (writes data/workspace.json and data/sim.json)
// Everything here is fictional. "Fieldstone" is a made-up 40-person fintech team.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, estimateTokens } from '../src/core.js';

const SEED = 20261106;
const rng = mulberry32(SEED);
const pick = (a) => a[Math.floor(rng() * a.length)];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'data');
mkdirSync(out, { recursive: true });

const NOW = '2026-11-06T17:00:00Z'; // Fri Nov 6, 9:00 AM PT
const people = ['Priya Raman', 'Marcus Lee', 'Dana Ortiz', 'Sam Okafor', 'Jules Martin', 'Wen Li', 'Arjun Mehta', 'Tess Huang'];

// Attribute kinds: lambda = expected changes per day (prior; would be learned per workspace in production).
const kinds = {
  status:   { lambda: 1 / 10,  label: 'Issue status' },
  owner:    { lambda: 1 / 45,  label: 'Owner' },
  date:     { lambda: 1 / 30,  label: 'Target date' },
  decision: { lambda: 1 / 90,  label: 'Technical decision' },
  limit:    { lambda: 1 / 120, label: 'Config / limit' },
  oncall:   { lambda: 1 / 7,   label: 'On-call' },
};
// Reliability priors r(source type, kind): P(the source states the true value at its own timestamp).
const reliability = {
  linear: { status: 0.95, owner: 0.97, date: 0.9,  decision: 0.6,  limit: 0.5,  oncall: 0.7 },
  github: { status: 0.95, owner: 0.7,  date: 0.5,  decision: 0.85, limit: 0.85, oncall: 0.5 },
  notion: { status: 0.7,  owner: 0.8,  date: 0.8,  decision: 0.85, limit: 0.8,  oncall: 0.75 },
  slack:  { status: 0.75, owner: 0.75, date: 0.75, decision: 0.8,  limit: 0.7,  oncall: 0.85 },
};

const slots = {
  'ls2.launch_date': { kind: 'date', label: 'Ledger Sync v2 launch date' },
  'eng398.status':   { kind: 'status', label: 'ENG-398 status' },
  'eng412.owner':    { kind: 'owner', label: 'ENG-412 owner' },
  'eng412.status':   { kind: 'status', label: 'ENG-412 status' },
  'api.rate_limit':  { kind: 'limit', label: 'Public API rate limit' },
  'cdc.approach':    { kind: 'decision', label: 'CDC approach' },
  'payments.oncall': { kind: 'oncall', label: 'Payments on-call' },
};

// ---- Long-form doc filler: real-sounding paragraphs, seeded order (no lorem ipsum) ----
const docParas = [
  'Scope. Ledger Sync keeps customer general ledgers in step with bank and card activity. v2 replaces the nightly batch with near-real-time sync, so balances in the dashboard match the bank within minutes instead of the next morning.',
  'Non-goals. We are not changing the chart-of-accounts mapping UI in this release, and multi-currency remains on the roadmap for Q1. Customers on the legacy CSV importer keep it until they opt in.',
  'Rollout. Tenants move behind the ledger_sync_v2 flag in three waves: internal and design partners, then Starter, then everyone else. Each wave waits for a clean week of drift metrics below 0.05 percent.',
  'Risks. Duplicate webhook deliveries from upstream processors can double-post entries; idempotency is required before wave two. Large backfills can saturate the replication consumer and need throttling.',
  'Support. Support needs a runbook for drift alerts, a macro for "my balance looks wrong", and a way to trigger a re-sync for one account without engineering.',
  'Metrics. We track sync latency at p50 and p95, drift between our ledger and the bank feed, webhook retry rate, and the number of manual re-syncs per thousand accounts.',
  'Open questions. Do we expose sync status in the public API on day one, or wait for feedback from design partners? Who signs off on wave three?',
  'Dependencies. Requires the change-data-capture pipeline from the platform team and the new idempotency keys on the webhook ingestion path.',
  'Authentication. All endpoints require a secret key sent as a bearer token. Keys are scoped to one environment; sandbox keys cannot read live data.',
  'Errors. The API uses conventional HTTP codes. 4xx means the request was wrong, 5xx means we broke something. Every error body includes a request id for support.',
  'Pagination. List endpoints are cursor-based. Pass the next_cursor value back unchanged; cursors expire after 24 hours.',
  'Idempotency. POST requests accept an Idempotency-Key header. Replaying the same key within 24 hours returns the original response instead of creating a duplicate.',
  'Versioning. Breaking changes ship under a new version prefix. We give at least 90 days of notice before retiring an old version.',
  'Plans. Starter includes one sandbox and one live environment. Pro adds SSO, audit logs, and priority support. Enterprise adds custom contracts and a dedicated success manager.',
  'Escalation. If the primary does not acknowledge a page within 10 minutes, it escalates to the secondary, then to the engineering manager on duty.',
  'Handoff. Rotations hand off Monday at 10am PT. The outgoing primary writes a short summary of open incidents and anything flaky in the handoff notes.',
];
const docBody = (lead, n, extra = []) => [lead, ...shuffle(docParas).slice(0, n), ...extra].join('\n\n');

let srcN = 0;
const sources = [];
function add(type, o) {
  const s = { id: `${type}-${String(++srcN).padStart(3, '0')}`, type, ...o };
  s.tokens = estimateTokens(`${s.title}\n${s.text}`);
  sources.push(s);
  return s;
}

// ================= Scenario 1: launch date + webhook fix =================
add('notion', { title: 'Ledger Sync v2: Launch Plan', container: 'Notion / Product', record: 'ls2-plan', author: 'Dana Ortiz', ts: '2026-10-01T18:20:00Z',
  text: docBody('Target launch date: November 12, 2026 for general availability of Ledger Sync v2. The launch depends on the webhook retry dedupe work (ENG-398) landing first.', 6),
  assertions: [{ slot: 'ls2.launch_date', value: 'Nov 12' }] });
add('slack', { title: '#ledger-sync', container: '#ledger-sync', author: 'Sam Okafor', ts: '2026-10-20T16:42:00Z',
  text: 'heads up: we are slipping Ledger Sync v2 GA by a week to Nov 19. the webhook dedupe issue (ENG-398) is bigger than we thought and I do not want to launch with double-posting risk',
  assertions: [{ slot: 'ls2.launch_date', value: 'Nov 19' }] });
add('linear', { title: 'Project update: Ledger Sync v2', container: 'Linear / Ledger Sync v2', author: 'Dana Ortiz', ts: '2026-10-28T21:05:00Z',
  text: 'Target date changed from Nov 12 to Nov 19. Health: at risk. Blocking issue ENG-398 (webhook retries) in progress, launch checklist ENG-415 open.',
  assertions: [{ slot: 'ls2.launch_date', value: 'Nov 19' }] });
add('slack', { title: '#ledger-sync', container: '#ledger-sync', author: 'Marcus Lee', ts: '2026-10-24T19:10:00Z',
  text: 'still working on the webhook retry thing for ENG-398, I think I will have a PR up early next week. plan is idempotency keys on ingestion',
  assertions: [{ slot: 'eng398.status', value: 'In Progress', hedge: true }] });
add('linear', { title: 'ENG-398 Webhook retries create duplicate ledger entries', container: 'Linear / ENG', record: 'ENG-398', author: 'Marcus Lee', ts: '2026-10-30T17:30:00Z',
  text: 'Status: In Progress. Assignee: Marcus Lee. Priority: Urgent. When the processor retries a webhook after a timeout we post the transaction twice. Repro on sandbox tenant 4411. Blocks Ledger Sync v2 launch.',
  assertions: [{ slot: 'eng398.status', value: 'In Progress' }] });
add('github', { title: 'PR #1287 Dedupe webhook retries with idempotency keys (fixes ENG-398)', container: 'fieldstone/ledger-api', author: 'Marcus Lee', ts: '2026-11-04T22:14:00Z',
  text: 'Merged into main by Sam Okafor. Adds an idempotency key derived from processor event id + account, stores it with a 72h TTL, and drops replays at ingestion. Includes a regression test that replays the same webhook 5 times. Fixes ENG-398.',
  assertions: [{ slot: 'eng398.status', value: 'Done' }] });

// ================= Scenario 2: ENG-412 owner/status =================
add('slack', { title: '#eng', container: '#eng', author: 'Sam Okafor', ts: '2026-10-15T16:05:00Z',
  text: 'Priya is taking ENG-412, the SSO redirect loop for Okta tenants. ping her if a customer reports the loop',
  assertions: [{ slot: 'eng412.owner', value: 'Priya Raman' }] });
add('slack', { title: '#eng', container: '#eng', author: 'Priya Raman', ts: '2026-10-16T22:40:00Z',
  text: 'picked up the SSO loop (ENG-412). looks like our session cookie is SameSite=Strict so the IdP POST back drops it. testing a fix',
  assertions: [{ slot: 'eng412.owner', value: 'Priya Raman' }, { slot: 'eng412.status', value: 'In Progress' }] });
add('slack', { title: '#support-escalations', container: '#support-escalations', author: 'Jules Martin', ts: '2026-10-21T18:30:00Z',
  text: 'Okta customer Brightline hit the SSO redirect loop again. Priya owns ENG-412 right? routing it to her',
  assertions: [{ slot: 'eng412.owner', value: 'Priya Raman', hedge: true }] });
add('linear', { title: 'ENG-412 SSO redirect loop for Okta tenants', container: 'Linear / ENG', record: 'ENG-412', author: 'Sam Okafor', ts: '2026-11-02T18:12:00Z',
  text: 'Status: In Progress. Assignee: Marcus Lee. Updated Nov 2. Customers on Okta get bounced between /login and the IdP after their session expires. Seen by 3 tenants. Latest comment from Priya: handing off, repro steps and the SameSite finding are in the description.',
  assertions: [{ slot: 'eng412.owner', value: 'Marcus Lee' }, { slot: 'eng412.status', value: 'In Progress' }] });
add('slack', { title: '#eng', container: '#eng', author: 'Priya Raman', ts: '2026-11-03T17:01:00Z',
  text: 'handed ENG-412 to Marcus since I am out next week. he has the repro and the cookie theory',
  assertions: [{ slot: 'eng412.owner', value: 'Marcus Lee' }] });

// ================= Scenario 3: rate limit conflict =================
add('notion', { title: 'Public API Guidelines', container: 'Notion / Engineering', author: 'Arjun Mehta', ts: '2026-10-22T20:30:00Z',
  text: docBody('Rate limits. The public API allows 100 requests per minute per API key. Bursts above the limit return 429 with a Retry-After header.', 5),
  assertions: [{ slot: 'api.rate_limit', value: '100 req/min' }] });
add('notion', { title: 'Pricing & Limits FAQ', container: 'Notion / Go-to-market', author: 'Tess Huang', ts: '2026-10-25T18:45:00Z',
  text: docBody('What is the API rate limit? Every plan gets 300 requests per minute per API key, and Enterprise can request more.', 4),
  assertions: [{ slot: 'api.rate_limit', value: '300 req/min' }] });
add('slack', { title: '#api', container: '#api', author: 'Jules Martin', ts: '2026-10-26T17:20:00Z',
  text: 'customer asking what our API rate limit is. the guidelines doc and the pricing FAQ say different numbers, which one do I send?',
  assertions: [] });

// ================= Scenario 4: CDC decision reversed =================
add('notion', { title: 'RFC-014: Change data capture for Ledger Sync', container: 'Notion / RFCs', author: 'Wen Li', ts: '2026-09-30T21:00:00Z',
  text: docBody('Proposal: use Debezium with Kafka Connect to stream change data capture events from the ledger Postgres cluster into the sync service. Status: Accepted.', 6),
  assertions: [{ slot: 'cdc.approach', value: 'Debezium + Kafka Connect' }] });
add('slack', { title: '#platform', container: '#platform', author: 'Wen Li', ts: '2026-10-02T23:15:00Z',
  text: 'Debezium POC for CDC is up in staging, connector config is in the RFC. lag looks fine at our volume',
  assertions: [{ slot: 'cdc.approach', value: 'Debezium + Kafka Connect' }] });
add('slack', { title: '#platform (thread)', container: '#platform', author: 'Arjun Mehta', ts: '2026-10-27T18:35:00Z',
  text: 'decision from today: dropping Debezium for CDC. we are going with native Postgres logical replication and our own consumer. fewer moving parts, and we do not want to run Kafka Connect just for this. Wen agreed',
  assertions: [{ slot: 'cdc.approach', value: 'Native Postgres logical replication' }] });
add('github', { title: 'PR #1279 Add logical replication slot consumer for ledger_events', container: 'fieldstone/ledger-sync', author: 'Arjun Mehta', ts: '2026-11-03T19:50:00Z',
  text: 'Merged. Consumes the ledger_events publication through a logical replication slot (pgoutput), checkpoints LSNs, and replaces the Debezium connector config. Removes kafka-connect from docker-compose.',
  assertions: [{ slot: 'cdc.approach', value: 'Native Postgres logical replication' }] });

// ================= Scenario 5: stale on-call =================
add('notion', { title: 'On-call handbook', container: 'Notion / Engineering', author: 'Jules Martin', ts: '2026-09-15T17:00:00Z',
  text: docBody('Current rotation. Payments primary on-call: Wen Li. Platform primary: Arjun Mehta. The rotation table below is updated by whoever hands off.', 4),
  assertions: [{ slot: 'payments.oncall', value: 'Wen Li' }] });
add('slack', { title: '#payments-oncall', container: '#payments-oncall', author: 'Jules Martin', ts: '2026-10-12T17:10:00Z',
  text: 'this week\'s payments on-call is Wen. handoff notes are in the on-call doc',
  assertions: [{ slot: 'payments.oncall', value: 'Wen Li' }] });

// ================= Seeded background noise (no assertions on question slots) =================
const slackBank = [
  ['#eng', 'anyone else seeing flaky tests in ledger-api CI? retrying fixed it for me'],
  ['#eng', 'reminder: deploy freeze starts Friday 5pm PT for quarter close'],
  ['#eng', 'postmortem doc for Tuesday\'s reconciliation delay is up, comments welcome'],
  ['#eng', 'can someone review my PR for the export job? small one, mostly tests'],
  ['#eng', 'staging DB was restarted at 2pm, if your migrations look weird that is why'],
  ['#eng', 'SSO login is slow for some Google Workspace tenants, probably the JWKS fetch, will look after lunch'],
  ['#ledger-sync', 'customer Brightline asked whether Ledger Sync v2 will support multi-currency at launch. I said not yet'],
  ['#ledger-sync', 'updated the launch checklist, still need sign-off from support on the runbook'],
  ['#ledger-sync', 'sync dashboard is showing 0.3% drift on sandbox accounts again, filing it'],
  ['#ledger-sync', 'webhook volume spiked 4x after the Acme import, retries look healthy though'],
  ['#ledger-sync', 'launch comms draft for Ledger Sync v2 is in the doc, Dana can you take a look'],
  ['#ledger-sync', 'what does launch day look like for support? want to staff the queue'],
  ['#api', 'docs for the new /v2/transactions endpoint are live'],
  ['#api', 'support ticket about 429s from a customer on Starter, they were hammering the list endpoint without a cursor'],
  ['#api', 'rate limit headers are missing on the batch endpoint, filed ENG-405'],
  ['#api', 'pagination cursor format changes next sprint, heads up to anyone with integrations'],
  ['#payments-oncall', 'paged for the card processor timeout again, resolved by failover to the secondary'],
  ['#payments-oncall', 'quiet night, one false alarm from the settlement job'],
  ['#platform', 'replication lag alert thresholds are too tight, bumping p95 to 30s'],
  ['#platform', 'Postgres minor version upgrade on the ledger cluster is scheduled for Sunday 6am'],
  ['#platform', 'kafka disk usage at 71%, not urgent but worth a look'],
  ['#eng', 'who wants to pair on the export timeout? it is the 50k row accounts again'],
  ['#ledger-sync', 'design partner Northwind is happy with the sandbox sync latency, p95 under 2 minutes'],
  ['#api', 'Pro customers keep asking for webhooks on balance changes, adding to the roadmap doc'],
];
for (const [ch, text] of shuffle(slackBank)) {
  const day = 1 + Math.floor(rng() * 36); // Oct 1 - Nov 6
  const ts = new Date(Date.UTC(2026, 9, day, 15 + Math.floor(rng() * 9), Math.floor(rng() * 60))).toISOString();
  if (Date.parse(ts) > Date.parse(NOW)) continue;
  add('slack', { title: ch, container: ch, author: pick(people), ts, text, assertions: [] });
}
const linearBank = [
  ['ENG-371 Export job times out for accounts with 50k+ rows', 'In Review', 'Export to CSV runs in one query and times out at 30s for large accounts. Plan: page through in 5k-row chunks.'],
  ['ENG-385 Add Retry-After to 429 responses on list endpoints', 'Todo', 'Clients cannot back off correctly without it. Applies to every list endpoint in the public API.'],
  ['ENG-402 Sync dashboard shows drift on sandbox accounts', 'In Progress', 'Sandbox accounts use synthetic bank feeds that do not settle, so drift never converges. Exclude them from the metric.'],
  ['ENG-405 Rate limit headers missing on /v2/batch', 'Todo', 'X-RateLimit-Limit and X-RateLimit-Remaining are not set on the batch endpoint. Other endpoints are fine.'],
  ['ENG-409 Flaky test: reconcile_concurrent', 'Backlog', 'Fails about 1 in 30 runs on CI. Looks like a race in the test fixture, not the reconciler.'],
  ['ENG-415 Launch checklist: support runbook for Ledger Sync v2', 'Todo', 'Support needs a runbook for drift alerts and a re-sync macro before the Ledger Sync v2 launch.'],
  ['ENG-418 Multi-currency support for Ledger Sync', 'Backlog', 'Customers with EUR and GBP accounts need FX-aware matching. Not in v2 scope.'],
  ['ENG-421 Okta SCIM provisioning creates duplicate users', 'Todo', 'When a user is renamed in Okta, SCIM creates a second user instead of updating. Related to SSO work but separate code path.'],
];
for (const [title, status, body] of linearBank) {
  const day = 5 + Math.floor(rng() * 31);
  const ts = new Date(Date.UTC(2026, 9, day, 16 + Math.floor(rng() * 8), Math.floor(rng() * 60))).toISOString();
  add('linear', { title, container: 'Linear / ENG', author: pick(people), ts, text: `Status: ${status}. Assignee: ${pick(people)}. ${body}`, assertions: [] });
}
const ghBank = [
  ['PR #1262 Page export job in 5k-row chunks (ENG-371)', 'Open. Streams rows with a server-side cursor instead of loading the whole account into memory.'],
  ['PR #1270 Bump pg driver to 3.2', 'Merged. Picks up the prepared statement cache fix. No API changes.'],
  ['PR #1275 Add X-RateLimit headers to batch endpoint (ENG-405)', 'Open. Moves rate limit header logic into shared middleware so every route gets it. Does not change the limit itself.'],
  ['PR #1290 Exclude sandbox accounts from drift metric (ENG-402)', 'Merged. Filters tenants flagged as sandbox before computing drift.'],
  ['PR #1294 Gate ledger_sync_v2 behind tenant allowlist', 'Merged. Adds the launch flag and an admin toggle per tenant for the staged rollout.'],
  ['PR #1298 Fix SameSite on session cookie for IdP-initiated login', 'Draft. Work in progress for the SSO redirect loop. Needs tests for Okta and Google.'],
];
for (const [title, body] of ghBank) {
  const day = 8 + Math.floor(rng() * 29);
  const ts = new Date(Date.UTC(2026, 9, day, 17 + Math.floor(rng() * 7), Math.floor(rng() * 60))).toISOString();
  if (Date.parse(ts) > Date.parse(NOW)) continue;
  add('github', { title, container: pick(['fieldstone/ledger-api', 'fieldstone/ledger-sync', 'fieldstone/web']), author: pick(people), ts, text: body, assertions: [] });
}
const notionBank = [
  ['Ledger Sync v2: Support Runbook (draft)', 'How support handles drift alerts and re-sync requests once Ledger Sync v2 launches.'],
  ['Q4 Engineering Priorities', 'Q4 focus: ship Ledger Sync v2, harden SSO, and cut p95 API latency by 30 percent.'],
  ['Customer FAQ: Ledger Sync', 'Answers to common customer questions about how Ledger Sync works and what changes in v2.'],
];
for (const [title, lead] of notionBank) {
  const day = 3 + Math.floor(rng() * 30);
  const ts = new Date(Date.UTC(2026, 9, day, 18, Math.floor(rng() * 60))).toISOString();
  add('notion', { title, container: 'Notion / Engineering', author: pick(people), ts, text: docBody(lead, 4), assertions: [] });
}

const questions = [
  { id: 'q1', text: 'When is the Ledger Sync v2 launch date, and is the webhook retry fix done?', slots: ['ls2.launch_date', 'eng398.status'],
    template: 'Ledger Sync v2 is scheduled to launch on {ls2.launch_date}. The webhook retry fix (ENG-398) is {eng398.status}.' },
  { id: 'q2', text: 'Who owns ENG-412, the SSO redirect loop for Okta tenants, and what is its status?', slots: ['eng412.owner', 'eng412.status'],
    template: 'ENG-412 (SSO redirect loop) is owned by {eng412.owner} and is {eng412.status}.' },
  { id: 'q3', text: 'What is the public API rate limit per key?', slots: ['api.rate_limit'],
    template: 'The public API rate limit is {api.rate_limit} per key.' },
  { id: 'q4', text: 'Are we using Debezium for change data capture in Ledger Sync?', slots: ['cdc.approach'],
    template: 'Ledger Sync change data capture uses {cdc.approach}.' },
  { id: 'q5', text: 'Who is on call for payments this week?', slots: ['payments.oncall'],
    template: 'Payments on-call this week is {payments.oncall}.' },
];
// Ground truth known to the simulator (for scoring only; never read by the guard).
const truth = {
  'ls2.launch_date': { expect: 'answer', value: 'Nov 19' },
  'eng398.status':   { expect: 'answer', value: 'Done' },
  'eng412.owner':    { expect: 'answer', value: 'Marcus Lee' },
  'eng412.status':   { expect: 'answer', value: 'In Progress' },
  'api.rate_limit':  { expect: 'flag', value: null, note: 'Two current docs genuinely disagree.' },
  'cdc.approach':    { expect: 'answer', value: 'Native Postgres logical replication' },
  'payments.oncall': { expect: 'flag', value: null, note: 'Rotation moved on (Arjun, per PagerDuty, which is not connected).' },
};

sources.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
const ws = { seed: SEED, now: NOW, org: 'Fieldstone', people, kinds, reliability, thresholds: { ok: 0.7, conflictRatio: 0.5 }, slots, sources, questions, truth };
writeFileSync(join(out, 'workspace.json'), JSON.stringify(ws, null, 1));

// ================= Simulated claim histories (for calibration / accuracy) =================
// Deliberately misspecified vs the guard's priors: true change rates are lambda * U(0.5, 2),
// true reliabilities are the priors shifted by U(-0.12, +0.05), and wrong reports are usually
// a stale copy of the previous value (people repeating what used to be true).
const simRng = mulberry32(SEED + 1);
const kindKeys = Object.keys(kinds);
const typeW = [['slack', 0.45], ['linear', 0.2], ['notion', 0.2], ['github', 0.15]];
const drawType = () => { let u = simRng(); for (const [t, w] of typeW) { if ((u -= w) < 0) return t; } return 'slack'; };
const histories = [];
for (let h = 0; h < 600; h++) {
  const kind = kindKeys[Math.floor(simRng() * kindKeys.length)];
  const lam = kinds[kind].lambda * (0.5 + 1.5 * simRng());
  const pool = ['A', 'B', 'C', 'D'].slice(0, 2 + Math.floor(simRng() * 3));
  // value path over [-90, 0] days
  const path = [{ t: -90, v: pool[Math.floor(simRng() * pool.length)] }];
  let t = -90;
  for (;;) {
    t += -Math.log(1 - simRng()) / lam;
    if (t >= 0) break;
    const prev = path[path.length - 1].v;
    const choices = pool.filter((x) => x !== prev);
    path.push({ t, v: choices[Math.floor(simRng() * choices.length)] });
  }
  const valueAt = (tt) => { let v = path[0].v; let before = null; for (const p of path) { if (p.t <= tt) { before = v; v = p.v; } } return { v, before }; };
  const m = 2 + Math.floor(simRng() * 6);
  const obs = [];
  for (let i = 0; i < m; i++) {
    const tt = -90 * Math.pow(simRng(), 1.3);
    const type = drawType();
    const rTrue = Math.max(0.4, Math.min(0.99, reliability[type][kind] - 0.12 + 0.17 * simRng()));
    const { v, before } = valueAt(tt);
    let said = v;
    if (simRng() > rTrue) {
      if (before && before !== v && simRng() < 0.6) said = before;
      else { const others = pool.filter((x) => x !== v); said = others[Math.floor(simRng() * others.length)]; }
    }
    obs.push({ t: Math.round(tt * 100) / 100, value: said, type });
  }
  histories.push({ kind, truth: valueAt(0).v, obs });
}
writeFileSync(join(out, 'sim.json'), JSON.stringify({ seed: SEED + 1, histories }));
console.log(`sources=${sources.length} questions=${questions.length} histories=${histories.length}`);
