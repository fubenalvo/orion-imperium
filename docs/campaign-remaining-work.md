# Story Campaign — Remaining Work

Status on 2026-11-10: all seven missions are implemented and merged into `main` (Phases 1a–8, see
[Campaign Design](./campaign-design.md#implementation-status)). Phase 9 (balance, QA, polish) has
started: Mission 7 is measured on every difficulty. This document lists what is left, in the order
it should be done, so work can resume from here.

**Cost scale.** Relative to what the earlier phases took (one mission phase such as Phase 5 or 6 =
**1 unit**):

| Cost | Meaning |
|---|---|
| **XS** | under 0.1 unit — a few edits, one test run |
| **S** | about 0.2 unit — one focused change with tests |
| **M** | about 0.5 unit — several files, a measurement loop or a long read |
| **L** | about 1 unit — comparable to a mission phase |

Long simulations cost little to run (they print a few lines) but cost more when their results
need tuning loops; every step below says which part is expensive.

## How to resume

1. `git checkout campaign && git merge --ff-only main` (work on `campaign`, merge into `main` at the end).
2. While working: `npx ng test --watch=false --include <spec>`; before committing: `npm test`, and
   `npm run test:long` after AI, economy, diplomacy or balance changes (AGENTS.md).
3. A long spec can be run on another difficulty with a temporary copy that swaps
   `startMission('<id>', 'normal', 1)` for `'easy'` / `'hard'` (how Mission 7 was measured).
   A long spec that is run on its own needs `--include` with the exact file name (a glob is
   excluded by the default configuration) and the `}, 600_000);` timeout.
4. Write the measured numbers into the mission's section of `campaign-design.md`.

## Steps

### 1. Measure Missions 3–6 on Easy and Hard — M

Missions 3–6 have a long spec each (`m3-first-contact.long.spec.ts` … `m6-silent-remnant.long.spec.ts`),
measured on Normal only. Run each on Easy and Hard (step 3 of *How to resume*) and record:

- M3: when the tribute and the ultimatum come, whether Varkon goes to war after a refusal;
- M4: Varkon raid orders and kills (minutes 10–30), no assault on a protected League world;
- M5: minutes of Concordium–Varkon war, the League's credits, posts and raids;
- M6: who claims which archive and when (the passive run ends at minute 25 on Normal).

Cost: running is cheap (8 runs, 1–2 minutes each); the M part is reading and recording. Tuning
is step 2.

### 2. Tune what the measurements show — M to L

Only where step 1 shows a real problem. Known candidates:
- **M6, the player's time window**: the passive run is lost at minute 25 (two AI archives). Check in
  a scripted run that a player who heads for archives III and I at once can make it on Normal; if
  not, move the Concordium's `after` later or raise the wardens' strength.
- **M4, the Hub defense is trivial**: Varkon never moved on the Meridian Hub after minute 35.
  `spawn_fleet` exists now: give the `varkon_moves` event a Varkon strike fleet near the Hub (S).
- **M7 numbers**: stipends (Easy has its own Observer stipend, `aiStipendsByDifficulty`),
  `anchorUpkeepFactor` 0.05, `constructorCostFactor` 0.04 and the pulse constructors were set from
  Normal runs, checked on Easy and Hard without player action only.

Cost depends on how many missions need it: about S per mission, more if a fix needs new engine work.

### 3. Concordium raiding League traders (Mission 4) — S

The technologist AI raids civilian traders from minute 26 in Mission 4 (the ordinary raid role).
Story-wise odd. Options: an `aiRestraint`-like mission rule "no raids on civilian traders" for a
faction, read in `EnemyFleetService.planRaid` (the `raids` personality flag exists already), or
leave it. Recommended: a mission-level `noRaids: ['concordium']` list.

### 4. Text pass — M

Read the briefing, objective, event, choice and ending texts of all seven missions
(`src/app/campaign/missions/m1…m7`, about 3,000 lines) against the tone rules in
[§5](./campaign-design.md#5-campaign-narrative). Also the contact dialogue (`contact-dialogue.ts`)
and the demand texts of the campaign-only personalities. Expensive part: reading everything once.
Small known items:
- the Concordium greets as "We are The Concordium" (the faction name includes "The");
- Mission 7's summit choices are fixed; the design wanted them to depend on the ring.

### 5. Player playtest feedback — owner

Nothing replaces playing the missions. The owner's notes from a play-through should decide step 2's
priorities. Cost for the agent: S per round of fixes, depending on the notes.

### 6. Move the settled rules into system docs — M

`campaign-design.md` is design and implementation log in one (2,500+ lines). Per Phase 9 of the
design:
- a new `docs/campaign.md` system doc: the engine as built (mission definition, conditions,
  effects, events, endings, sites, AI directives, restraint, protection, value sources, Dyson
  rules, stipends, session state, progress and carry), short and current;
- contact rules: keep in `first-contact.md` (already the source of truth);
- trim `campaign-design.md` to design, decisions and measurements, linking to `campaign.md`;
- add `campaign.md` to the list in `AGENTS.md`.

Expensive part: writing `campaign.md` (reading the engine files once, about 2,500 lines).

### 7. Optional: Playwright smoke suite — M

A browser smoke test per mission: start from the campaign screen, the first message, the tracker,
no console errors (see [§17](./campaign-design.md#17-testing-strategy)). Needs the dev server in
the test setup; the Playwright MCP checks done so far were manual.

### 8. Later expansions — L each

Not part of Phase 9; listed so they are not lost:
- Mission 7 endings **Military Supremacy** and **Independent Frontier** (§6: data work plus balancing
  on the existing ring and instability rules);
- a campaign completion screen (today the last mission's debrief says the campaign is complete);
- the Mission 3 optional stealth objective (chart the Varkon border without a border incident);
- a "via … wormhole" line in the fleet panel; AI strategic distances that know wormholes;
- a planetary Aegis Grid building (today a station-turret bonus).

## Suggested order and budget

| Order | Step | Cost |
|---|---|---|
| 1 | Measure M3–M6 on Easy and Hard | M |
| 2 | Tune what step 1 shows (M4 Hub strike fleet, M6 window first) | M–L |
| 3 | Concordium raids in M4 | S |
| 4 | Text pass | M |
| 5 | Rules into `campaign.md` | M |
| 6 | Playwright smoke suite (optional) | M |

Steps 1–3 together are roughly one mission phase (about 1 unit). Steps 4–6 are another unit.
If the budget is tight, do step 1 first: it turns guesses into numbers, and every later step uses them.

Done: pushing `main` (2026-11-10); the Observers' Easy economy in Mission 7
(`aiStipendsByDifficulty`, measured in campaign-design.md, Phase 9).
