# Context provenance and staleness guard (concept demo for Town)

**Live demo:** https://mohith26.github.io/town-context-provenance/

> Unofficial concept demo by Mohith Gajjela. Not affiliated with Town. All data is synthetic ("Fieldstone" is a made-up team).

A team assistant that reads Slack, Linear, Notion and GitHub runs into a quiet failure: the most *relevant* source is often not the most *current* one. The launch plan in Notion still says Nov 12, a Slack thread says it slipped, the Linear project says Nov 19. An issue is still "In Progress" in Linear even though the PR that fixes it merged two days ago. Two docs give different API rate limits. Retrieval ranks by relevance, so the assistant confidently repeats whichever one matched the question's words best.

This demo adds a check between retrieval and the answer:

1. **Split the answer into atomic claims** (launch date, issue status, owner, ...). Each claim is a *slot*: one fact about one entity.
2. **Gather every assertion about each slot across tools**, not just the top-k retrieved, with its timestamp and source type.
3. **Infer the current value with a temporal belief model** that knows newer evidence beats older evidence, some sources are more authoritative for some facts (Linear for status, merged PRs for "is it fixed", Slack for on-call), and facts go stale at different rates.
4. **Return a verdict per claim**: *current* (answer it, with citations), *sources disagree* (say so, name the doc owners), or *needs re-check* (old evidence on a fast-changing fact, answer with a caveat).
5. **Suggest follow-ups**: records that are now out of date ("ENG-398 in Linear still says In Progress; PR #1287 merged Nov 4"), conflicts to resolve, facts to re-verify. Nothing is changed without approval.
6. **Pick the context under a token budget**: choose the smallest, freshest set of sources that still decides every claim, with a certified bound on how close it is to optimal.

## What the demo shows (all numbers computed in the browser from `data/`)

- 5 questions, 7 claims, 61 synthetic items across 4 tools. Freshness-blind retrieval (BM25 top 6) gets **2 / 7** right; the guard answers or flags **7 / 7** correctly, and finds 3 out-of-date Linear/Notion records.
- At a 500-token budget the optimizer reproduces the full-evidence answer for every claim using 1,494 tokens across the 5 questions (relevance packing at the same budget uses 2,333 tokens and changes 3 of the 7 answers; all candidates total 11,062 tokens).
- On 600 simulated claim histories from a deliberately misspecified simulator: forced to always answer, the guard is no better than "newest source wins" (56% vs 57%), because nothing can know about a change that happened after the last message. Its value is knowing when to trust itself: its top 20% most-confident answers are right 86% of the time vs 74% for the 20% with the freshest source, and it is somewhat overconfident (ECE 0.095).

## How it works

All logic is in [`src/core.js`](src/core.js) (no dependencies; runs in the browser and in Node).

**Temporal belief per slot (continuous-time HMM filter).** The true value is piecewise constant and changes as a Poisson process with rate λ (per fact type: issue status about every 10 days, owner every 45, target date every 30, technical decision every 90, on-call every 7). When it changes it moves uniformly over the K states: every value anyone has asserted plus OTHER ("something nobody wrote down"). Each assertion is a noisy reading of the value *at its own timestamp*: P(says v | true v) = r(source type, fact type), errors spread over the other states. Forward filtering in time order gives P(value now). Between readings the belief decays toward uniform with weight e^(-λΔt), which is what makes old evidence lose authority and makes "last confirmed 25 days ago" visible as low confidence.

**Verdicts.** `current` if the top value has ≥ 70% belief now. Otherwise compare the belief right after the last assertion: if the top two values were both strong (ratio ≥ 0.5), it is a `conflict`; if one value was strong and has since decayed, it is `stale`. Each source is then labeled current, superseded (and by which later source), contested, or aging.

**Budgeted context selection.** Evidence value of source i for slot j is q_ij = r · (0.2 + 0.8 · e^(-λ·age)). The objective f(S) = Σ_j (1 − Π_{i∈S}(1 − q_ij)) is monotone submodular (probabilistic coverage). We run lazy (CELF) cost-benefit greedy and take the better of that and the best single source, which guarantees ≥ (1 − 1/e)/2 of the optimum (Leskovec et al. 2007). We also report a data-dependent upper bound on the optimum: f(S) plus a fractional knapsack over the marginal gains, which is what the "Certified vs. optimum" number shows.

**Baseline.** BM25 over title + text, top 6; each claim comes from the highest-ranked source that says anything about it.

## Run it

```bash
node scripts/generate.mjs             # regenerate data/ (seeded, deterministic)
node --test tests/core.test.mjs       # 14 tests
python3 -m http.server 8000           # then open http://localhost:8000
```

Tests cover: decay and mass conservation, supersession, conflict and staleness verdicts, order invariance, BM25 behavior, the scenario outcomes, follow-up targeting, randomized monotonicity and submodularity checks, greedy vs. brute-force optimum on 25 random instances (guarantee and bound both hold), context-plan fidelity, and the simulation result.

## Honest limitations

- **Claim extraction is annotated, not learned.** Each synthetic item carries structured assertions (slot, value). In production that is an LLM extraction pass plus entity linking; its errors would feed into the same model (r already absorbs some of that).
- **Question → slots is given.** A planner would produce the slot list; here each question lists its slots.
- **Priors are hand-set.** λ per fact type and r per (tool, fact type) are reasonable guesses. They should be learned per workspace, e.g. EM over observed edits and corrections, or from how often a Slack claim is later contradicted by Linear.
- **The error model is simple.** Real wrong reports are usually stale copies of a previous value, not random. The simulator includes that on purpose, and it is why the guard is somewhat overconfident in the 70 to 80% band. A model with an explicit "repeating old news" term would fix part of that.
- **Single-valued facts only.** Sets ("who is on the launch team") and numeric drift need different likelihoods.
- **Synthetic data.** Fieldstone, its people and every message are invented. No Town data, APIs or assets are used.

## Files

```
index.html, styles.css, app.js   UI (vanilla JS + Chart.js from CDN)
src/core.js                      algorithms
scripts/generate.mjs             seeded generator for data/workspace.json and data/sim.json
tests/core.test.mjs              node:test suite
```

MIT license.
