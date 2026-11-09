# First Contact (Design)

Status: **implemented** (2026-11-09, Phase 4a of [Campaign Design](./campaign-design.md)); see
[Implementation](#implementation-and-tests) for the code and where it differs from the design below.

The design text follows; the original decisions: Owner decisions of 2026-11-09: every game
mode (skirmish and campaign) starts with the other empires unknown; the first meeting is a short
formal dialogue that decides whether two empires start as friends or enemies; warlike empires
almost never start or keep a lasting peace; a clearly stronger player is attacked less often by
them, but never befriended. The dialogue texts below are meant to be close to final; they are
reviewed with the owner during implementation.

This system replaces today's opening rule ("everyone starts at war with everyone under the
opening war lock", [Diplomacy](./diplomacy.md#peace-truce-and-war-declarations)). When it is
implemented, the treaty and opinion rules here move into [Diplomacy](./diplomacy.md), the
generator change into [New Game Generation](./new-game-generation.md), and this document keeps
the contact lifecycle, the dialogue and its content.

Related: [Campaign Design](./campaign-design.md) (Phase 4a, Mission 3, the tribute pact),
[Diplomacy](./diplomacy.md), [AI Pipeline](./ai-pipeline.md) (fog of war, personalities),
[Game Systems](./game-systems.md#fog-of-war--sensor-range), [Planet Capture](./planet-capture.md#opening-grace-opening-gracets)
(opening grace), [UI Styling](./ui-styling.md).

## Contents

1. [State](#state)
2. [Before contact](#before-contact)
3. [Contact trigger](#contact-trigger)
4. [The contact dialogue](#the-contact-dialogue)
5. [Evaluation](#evaluation)
6. [Warlike empires after contact](#warlike-empires-after-contact)
7. [AI–AI contact](#aiai-contact)
8. [Campaign hooks](#campaign-hooks)
9. [Skirmish balance](#skirmish-balance)
10. [Save compatibility](#save-compatibility)
11. [Implementation and tests](#implementation-and-tests)
12. [Dialogue content](#dialogue-content)

## State

```ts
/* StarMapData.contacts?: string[] — sorted 'a|b' faction id pairs that have met.
 * Missing = every pair in contact (saves from before the feature load unchanged).
 * New games (generator, campaign mission builder) write [] or authored pairs. */
```

- `inContact(a, b)` in `diplomacy.ts` is the single check. Neutral factions (team 0:
  `independent`, `unhabited`) and outlaws (pirates, the campaign Remnant) always count as in
  contact: they are outside diplomacy anyway.
- The chosen replies of the player's dialogues are kept as flags (`contactAnswers?:
  Record<factionId, string[]>` on `StarMapData`, optional), so later diplomacy text and the
  campaign can refer to them. They have no mechanical effect after the evaluation.

## Before contact

- The pair is at `peace` without a lock. The generator writes this instead of the opening war;
  `normalizeRelations` keeps authored symmetric relations. Their fleets never fight, their
  planets cannot be attacked, and nobody can declare war on an empire it has not met.
- **Unknown to the player:** the other empire's fleets, planets, stations, traders and territory
  are drawn in a neutral "unknown" style (grey, name "Unknown"); it is missing from the Diplomacy
  screen; its name appears in no map notice, Dyson news line, planet panel or tooltip. Display
  goes through the faction helpers in `star-map-display.util.ts`, so the rule lives in one place.
  The F9 AI debug panel is exempt (developer tool).
- **AI:** `EnemyDiplomacyService` skips the pair (no proposals, demands or war declarations);
  `BorderService` records no incidents; threat and target logic already ignore factions at peace.

## Contact trigger

- Two empires meet the first time one of them senses an asset of the other: a fleet, a planet, a
  space base, a mining station or a trader inside its sensor coverage, with the normal nebula
  penalty.
- Player: checked in `StarMap.updateSensorVisibility` (it already runs only when sensor cells
  change). AI: checked when `EnemyIntelService` records a sighting (every 2 s).
- If both sides sense each other in the same frame, one contact happens.
- Contact with the player during a battle screen visit is deferred: the dialogue opens after the
  return to the star map (the trigger re-checks on load).
- Several contacts at once queue; one dialogue at a time, oldest first.
- Campaign missions may force or delay contact with an effect ([Campaign hooks](#campaign-hooks)).

## The contact dialogue

The game pauses (like the anomaly event dialog) and resumes on close only if it was running.

```
 ┌─ FIRST CONTACT ───────────────────────────── VARKON DOMINION ─┐
 │ [faction color bar]   Temperament: Militarist   Fleet: Larger │
 │                                                               │
 │ "The Dominion speaks. We have counted your ships, Humanity.   │
 │  Now answer us, and choose your words with care."             │
 │                                                               │
 │ QUESTION 1 OF 2                                               │
 │ "How many warships guard your homeworld?"                     │
 │   ( ) Enough to break any attack.                             │
 │   ( ) We prefer not to say.                                   │
 │   ( ) We are a peaceful people.                               │
 │                                                    [ ANSWER ] │
 └───────────────────────────────────────────────────────────────┘
```

Steps:

1. **Greeting** — in the other empire's voice, with a strength hint (Smaller / Similar /
   Larger, from total fleet strength, the same public-knowledge rule diplomacy already uses).
2. **Questions** — two questions (one when the other empire's pool is a campaign faction's and
   its signature question is asked first: then one signature plus one pool question, still
   two). Each has three replies; the player picks one per question. Reply order is shuffled
   deterministically, so the "nice" reply is not always first.
3. **Stance** — **Welcome**, **Cautious** or **Warning**, plus an optional **gift** of credits:
   none / 300 / 800 / 2,000 (tiers above the treasury are disabled). The gift is paid through the
   existing atomic `transferResources`.
4. **Result** — the other empire's closing line for the outcome (warm peace, cold peace, war),
   a one-line summary ("Peace. Their attitude: Wary."), CLOSE. The numbers are never shown.

No reply or stance is pre-selected, and there is no close button before the result: the meeting
must be answered (like anomaly events). The dialogue shows the other empire's temperament chip
(the same as the Diplomacy screen) so the player can play to it.

**Question choice.** Two distinct questions from the temperament's pool, picked by a seeded draw
from `hash(galaxy seed, sorted pair ids)`. The same game always asks the same questions; a
replay of a campaign mission too.

## Evaluation

All values are first tuning guesses (watch them in play and in the long simulations).

```
disposition = base[temperament]
            + reply(question 1) + reply(question 2)
            + stance[temperament][stance]
            + gift[temperament][tier]
            + strength
            + proximity
```

| Temperament | base | Welcome | Cautious | Warning | gift 300 / 800 / 2,000 |
|---|---|---|---|---|---|
| technologist | +20 | +15 | 0 | −20 | +4 / +8 / +12 |
| balanced | +5 | +15 | 0 | −20 | +4 / +8 / +12 |
| mercantile (campaign) | +25 | +15 | 0 | −25 | +5 / +10 / +15 |
| guardian (campaign) | 0 | +10 | +5 | −25 | +2 / +4 / +6 |
| expansionist (warlike) | −25 | −5 | 0 | +5 if the player is stronger, else −20 | +2 / +4 / +6 |
| militarist (warlike) | −35 | −5 | 0 | +5 if the player is stronger, else −20 | +2 / +4 / +6 |

- Replies are worth −12 … +12, set per reply in the [content](#dialogue-content).
- `strength` = `10 × log2(player strength / their strength)`, clamped to ±15; full for warlike
  temperaments, half for the others. "Stronger" for the Warning bonus means a ratio ≥ 1.25.
- `proximity` = −10 when the two territories are within `WAR_REACH`, otherwise 0.

**Outcome.**

- **Peaceful temperaments** (technologist, balanced, mercantile, guardian): disposition ≥ 0 →
  **peace**, opinion = disposition (capped +40); −25 ≤ disposition < 0 → **cold peace** (peace,
  opinion = disposition); below −25 → **war**.
- **Warlike temperaments** (expansionist, militarist): disposition < 10 → **war**. At ≥ 10 a
  seeded roll (`hash(galaxy seed, pair ids, 'contact')`) gives peace with a chance of
  `5% + (disposition − 10)%`, at most 20%; otherwise war. Peace from the roll is a cold peace
  (opinion = min(disposition − 10, 10)).
- What that means in practice: a militarist reaches ≥ 10 only with both best replies, a gift,
  and a clear strength lead without nearby borders (best case about +11 → ~6%). An expansionist
  reaches about +21 in the best case (~16%). In a typical meeting both start a war.
- War from contact starts with the normal minimum war duration (`WAR_MIN_DURATION_SECONDS`). The
  hidden opening grace still keeps every AI from attacking the player in the first minutes of a
  game, whatever the contact result.
- The gift is paid whatever the outcome (a warlike empire keeps it and fights anyway).

## Warlike empires after contact

Decided 2026-11-09: lasting peace with a warlike empire should be nearly impossible, and a
clearly stronger empire is not befriended but attacked less often.

While a warlike AI is at peace with an empire (after contact, a treaty or an expired truce):

- **No friendship (as built: no special drift).** The design had its opinion drift −0.5 per
  minute toward −50 at peace. Implemented and measured on 2026-11-09, it pushed militarists
  below their treachery threshold (−40), so they broke truces and wars never settled; two
  long simulations had AIs in arrears. Dropped: the normal peace drift applies, and opinion
  simply does not protect (next point).
- **Opinion does not protect:** its restless war check (`minWars` 1) ignores opinion
  (`restlessOpinionMax` 100).
- **Against an equal or weaker empire** (strength ratio ≤ its `restlessWarRatio`): the restless
  rule as today — war soon after any truce ends, if it has the treasury and is not exhausted or
  already at its war limit.
- **Against a clearly stronger empire** (ratio above `restlessWarRatio`), the change: it may still
  declare war, but rarely. A per-pair **grudge clock** starts when peace begins; a war on the
  stronger empire is allowed only after a seeded 15–25 minutes of continuous peace, and at most
  once per 30 minutes per pair. All other conditions (truce, treasury, exhaustion, war limit,
  open demand) still apply.
- **How it fights a stronger enemy:** a war does not mean an all-out invasion. Planet assaults
  still need a winning battle forecast and the AI's existing risk limits, so against a stronger
  enemy it mostly intercepts weaker fleets, raids traders and takes undefended colonies, and its
  war exhaustion makes it accept peace again later. This is the safeguard against the failure
  measured earlier (with restless ratios above 1, militarists attacked stronger empires head-on
  and were broken).
- **Peace from war** follows the existing assessment: a warlike AI settles only when it is
  losing or exhausted, and asks to be paid otherwise.
- Tribute demands still buy time: while a demand between the pair is open the AI does not
  declare war on that target, but nothing makes the peace permanent.

Peaceful temperaments keep today's rules (positive peace drift, opinion limits on war).

## AI–AI contact

- Same evaluation. The AI answers "in character": the reply its own temperament would judge
  best when asked the same question (for warlike askers this is usually the tough reply). Stance
  by personality: technologist and mercantile Welcome, balanced and guardian Cautious,
  expansionist and militarist Warning. No gift.
- Two warlike empires therefore almost always meet at war; a warlike and a peaceful empire
  usually too; two peaceful empires usually at peace.
- It resolves at once with no dialogue. A map notice is posted only when the player knows both
  empires ("The Varkon Dominion and the Concordium have met. They are at war.").

## Campaign hooks

- `contact` effect: force a meeting (an envoy) before any sighting; `delay_contact`: keep a pair
  unknown until a flag (a mission's surprise reveal).
- Per-faction signature questions (below) are asked first.
- Result override: a mission may replace the evaluation's outcome (M3: Varkon starts at a cold
  peace at best, never warm).
- **Tribute pact** (campaign only): a mission rule that suppresses one warlike faction's restless
  war against the player while a periodic tribute is paid (M3 Appeasement, M5 partner role; see
  [Campaign Design](./campaign-design.md#first-contact-all-game-modes)). A missed payment ends it.

## Skirmish balance

To measure in Phase 4a ([Campaign Design](./campaign-design.md#phase-4a--first-contact-all-game-modes)):

- the time of each faction's first contact and first war on small / medium / large maps;
- how often warlike AIs are at war over a game (expected: about as often as today, after a later
  start), and how often a clearly stronger player is attacked by them (expected: rarely, about
  every 30+ minutes);
- AI health (arrears, colonization, research) and the APM report on every difficulty;
- the difficulty tempo values (measured on 2026-11-09 under the old opening-war rule).

Tune `base`, the warlike threshold and roll, the grudge clock and the peace drift. Do not change
the core war and peace assessment for this.

## Save compatibility

`StarMapData.contacts` and `contactAnswers` are optional and additive (no `SAVE_VERSION` bump).
A missing `contacts` field means everyone is in contact (older saves play by the old rules).
The grudge clock is saved per relation (`FactionRelation.grudgeSeconds?`, optional) so a reload
neither restarts nor skips it. A contact queued while a battle screen was open is re-derived on
load from the sensor state, so it is never lost.

## Implementation and tests

**As built (2026-11-09).**

| File | Role |
|---|---|
| `contact-dialogue.ts` | The dialogue content below as data; every reply also has a `tone` (open / neutral / hard) |
| `first-contact.ts` | Pure rules: temperament, seeded question choice and reply order, `evaluateContact`, AI stance and in-character replies |
| `first-contact.service.ts` | `FirstContactService`: detection once per game second, the player's queue, `buildDialogue`, `resolvePlayerContact`, AI–AI resolution, `autoResolvePlayerContacts` for headless games |
| `star-map-first-contact/` | The dialogue (greeting → two questions → stance and gift → their answer) |
| `diplomacy.ts` | `inContact`, `makeContact`; contact, `peaceSeconds`, `grudgeCooldown` in normalization |
| `enemy-diplomacy.service.ts` | No war or demand before contact; restless warlike AIs ignore opinion; the grudge clock (`grudgeAllows`) |

Differences from the design above:

- **State:** the contact flag lives on the relation (`FactionRelation.contact: false`, symmetric, missing = met) instead of a separate `StarMapData.contacts` list; relations are already saved, normalized and symmetric, and older saves need nothing. `contactAnswers` is not saved: the reply flags (e.g. `offered_tribute`) go to a running campaign mission as session flags.
- **Sighting assets:** fleets (not in a wormhole), owned systems and space bases; traders do not trigger a contact.
- **AI–AI asker:** the first empire of the pair in faction order asks; the other answers in character (by reply tone).
- **Pending meetings** are not saved: after a load the meeting is detected again, so it is neither lost nor repeated.
- **Simulations:** `ScenarioOptions.firstContact` (default off) runs contact detection and answers the player's meetings neutrally; the older scenarios keep the opening-war premise they were measured with.
- **Tutorial:** the `diplomacy` hint waits for the first met empire (`TutorialContext.metEmpires`).

**First measurement** (`ai-simulation-first-contact.long.spec.ts`, 30-minute games with a passive player; medium / 3 AIs seed 31337, large / 5 AIs seed 4242):

- meetings from minute 2 to 13 for most pairs (the latest at minute 28); every warlike–warlike meeting ended in war, technologist–balanced and technologist–player in peace, the militarist that met the player at minute 2 in war;
- AIs spend 10–24 of 30 minutes at war with another AI (before, with opening wars, warlike AIs 28–30): wars start later, then run;
- peak war exhaustion of the expansionists 57–68 (before 30–43); others 12–33. Watch whether this needs tuning (the warlike threshold or base).

Planned files (design): `contact-dialogue.ts` (question pools, closing lines; pure data),
`first-contact.ts` (pure evaluation, question choice, seeded roll), the trigger in `StarMap` and
`EnemyIntelService`, `components/star-map/star-map-first-contact/` (dialog), display rule in
`star-map-display.util.ts`, the warlike rules in `diplomacy.ts` / `EnemyDiplomacyService`, the
generator change (no opening war), `save-validation.ts`.

Tests:

- evaluation table per temperament, stance and gift; the warlike threshold and roll
  (deterministic per seed and pair); question choice deterministic;
- trigger: player and AI, nebula penalty, simultaneous sightings, battle return, save/load (the
  dialogue opens exactly once);
- unknown display: every panel that prints a faction name or color;
- warlike rules: negative drift, opinion-blind restless war, the grudge clock against a stronger
  empire (allowed only after 15–25 minutes, once per 30), the weaker-target rule unchanged;
- old saves without `contacts` keep the old rules;
- long simulations re-run (several scenarios assume opening wars; they either omit `contacts`
  to keep the old premise or are updated).

## Dialogue content

Placeholders: `{empire}` the other empire's name, `{player}` the player's empire name. Each
reply's value is its `reply` term in the evaluation. Pools have five questions; two are asked.

### Technologist — curious, scientific, peaceful

Greeting: "Greetings, {player}. We are {empire}. Our instruments have followed your ships for
some time. We would rather understand you than fear you."

| # | Question | Replies (value) |
|---|---|---|
| 1 | "What do your people seek among the stars?" | "Knowledge, above all." (+12) · "New markets and new partners." (+4) · "Room to grow, and the means to defend it." (−10) |
| 2 | "Would you share what your scientists have learned?" | "Openly, with anyone who asks." (+10) · "In exchange for what you have learned." (+5) · "Our discoveries are our own." (−8) |
| 3 | "How do your people settle their disputes?" | "By debate and evidence." (+10) · "By law, and by compromise when the law fails." (+6) · "The stronger argument usually has more ships." (−12) |
| 4 | "This region holds ruins older than both of us. What would you do with them?" | "Study them, and leave them standing." (+10) · "Learn what we can, then decide." (+3) · "Whatever gives us an advantage." (−10) |
| 5 | "Our observatories lie near your borders. Will they be safe?" | "As safe as our own." (+12) · "As long as they only watch the stars." (0) · "Move them, and there will be no question." (−12) |

Closing: warm "Then let us learn from each other. Welcome, {player}." · cold "We will keep
our distance, and our instruments on you." · war "You leave us no choice. We will defend what
we have learned."

### Balanced — pragmatic, peaceful

Greeting: "We are {empire}. We have no quarrel with you yet, {player}. Let us keep it that way."

| # | Question | Replies (value) |
|---|---|---|
| 1 | "Will you respect the borders of others?" | "Yes, gladly." (+8) · "As long as ours are respected." (+5) · "Borders are drawn by strength." (−10) |
| 2 | "What does your government want from us?" | "Peace and honest trade." (+8) · "Nothing yet. We are listening." (+3) · "Your neutrality, if you value your worlds." (−10) |
| 3 | "Your ships have crossed space we consider ours. Was that deliberate?" | "No. We will be more careful." (+8) · "We did not know it was claimed." (+4) · "Space belongs to whoever holds it." (−12) |
| 4 | "Would you stand with us if a third power attacked?" | "If you would do the same for us." (+8) · "We would talk first, then decide." (+5) · "Your wars are your own." (−6) |
| 5 | "How long do your treaties last?" | "As long as both sides keep them." (+8) · "As long as they serve us both." (+3) · "Until they become inconvenient." (−12) |

Closing: warm "Good. Peace serves us both." · cold "Peace, then. Do not test it." · war "So be
it. You chose this."

### Expansionist — land-hungry, warlike

Greeting: "{empire} claims the worlds between our stars. You are late, {player}. Tell us why we
should make room for you."

| # | Question | Replies (value) |
|---|---|---|
| 1 | "These worlds are unclaimed. Do you intend to settle them?" | "Only what we need to survive." (+8) · "We will share them fairly." (−6) · "As many as we can hold." (−10) |
| 2 | "How many colony ships do you launch each year?" | "Enough to hold what we have." (+10) · "Few. We are a small people." (−8) · "More every year." (−10) |
| 3 | "Would you accept a line in space that neither of us crosses?" | "Yes, and we will keep it." (+10) · "Only if it is drawn fairly." (+4) · "We draw our own lines." (−12) |
| 4 | "Our people need more room. What would you give us?" | "Nothing, but we will not stand in your way elsewhere." (+10) · "A share of what we find." (+2) · "A war, if you come for it." (−8) |
| 5 | "Who else have you met out here?" | "We will tell you what we know." (+8) · "That is our business." (0) · "No one worth mentioning." (−6) |

Closing: peace "For now the line holds. Do not cross it." · war "Then we will take the room we
need."

### Militarist — strength is respect, warlike

Greeting: "{empire} speaks. We have counted your ships, {player}. Now answer us, and choose
your words with care."

| # | Question | Replies (value) |
|---|---|---|
| 1 | "How many warships guard your homeworld?" | "Enough to break any attack." (+10) · "We prefer not to say." (0) · "We are a peaceful people." (−12) |
| 2 | "Will you kneel to the strong?" | "Never." (+10) · "We kneel to no one, but we can talk." (+3) · "If we must." (−12) |
| 3 | "Who commands your fleets?" | "Admirals who have won their battles." (+8) · "Our elected council." (−4) · "No one. We have no real navy." (−12) |
| 4 | "What do you do with those who attack you?" | "We break them." (+10) · "We defend ourselves, then we negotiate." (+2) · "We try to reason with them." (−10) |
| 5 | "Our ships will pass through your space. Will you stop them?" | "Try it and find out." (+8) · "Ask first, and we may allow it." (+2) · "We will not interfere." (−12) |

Closing: peace "You are not prey. Not today." · war "Good. We hoped you would say that."

### Mercantile (campaign: Meridian League) — trade first, peaceful

Greeting: "Welcome, {player}! {empire} trades with anyone who pays. Shall we see what you are
worth?"

| # | Question | Replies (value) |
|---|---|---|
| 1 | "What can you offer the markets?" | "Goods and fair prices." (+12) · "Protection for your traders." (+2) · "Nothing you need." (−10) |
| 2 | "Will your warships leave our traders alone?" | "Always." (+12) · "Unless they trade with our enemies." (−2) · "Traders who pay us have nothing to fear." (−10) |
| 3 | "What do you think of tariffs?" | "Low, and the same for everyone." (+10) · "We set them where we need them." (0) · "We prefer to take what we need." (−12) |
| 4 | "Would you open your ports to our ships?" | "Gladly." (+10) · "To some of them, for a fee." (+4) · "Our ports are closed." (−10) |
| 5 | "Do you pay your debts?" | "Every credit, on time." (+10) · "When we can." (0) · "Debts are for the weak." (−12) |

Closing: warm "Splendid! The markets are open to you." · cold "We will trade with you,
carefully." · war "Bad for business. Mostly yours."

### Guardian (campaign: the Observers) — cautious, ancient, peaceful

Greeting: "We are {empire}. We have watched this region for a very long time, {player}. We
have questions."

| # | Question | Replies (value) |
|---|---|---|
| 1 | "Have you touched what the old ones left behind?" | "We study it with care." (+8) · "We do not know what you mean." (0) · "We use what we find." (−10) |
| 2 | "If you found a door that should stay closed, would you open it?" | "No. Some doors are closed for a reason." (+12) · "Only if we understood what lies behind it." (+4) · "Every door can be opened." (−12) |
| 3 | "What do you fear?" | "Our own mistakes." (+10) · "Those who are stronger than us." (+2) · "Nothing." (−8) |
| 4 | "Will you listen when we warn you?" | "Always." (+10) · "We will weigh your warning." (+4) · "We make our own decisions." (−6) |
| 5 | "Why did you come here?" | "By accident. We want to understand where we are." (+8) · "To find a new home." (+4) · "To take what this region offers." (−12) |

Closing: warm "Perhaps you will be different from the others." · cold "We will be watching." · war
"Then we must stop you before you do harm."

### Gift reactions

Peaceful temperaments: "A generous gesture. It will be remembered." · Warlike temperaments:
"Tribute. A wise beginning."

### Campaign signature questions

Asked first when meeting these campaign factions (the second question comes from their
temperament's pool).

| Faction (pool) | Question | Replies (value; flag) |
|---|---|---|
| Concordium (technologist) | "The gate you came through was not built by you. Do you know who built it?" | "No, and we want to learn, with you if you allow it." (+12) · "We have theories. We would share them, for a price." (+2) · "Whoever built it is gone. It is ours now." (−12) |
| Varkon Dominion (militarist) | "The Dominion takes tribute from the weak. Are you weak?" | "Come and find out." (+10) · "We are strong enough to talk as equals." (+4) · "We would rather pay than fight." (−12; flag `offered_tribute`: Varkon's first tribute demand comes sooner and higher) |
| Meridian League (mercantile) | "Every power wants our trade routes. What do you want?" | "Fair access, like everyone else." (+12) · "Safe routes. We can provide the escorts." (+4) · "Control. It is simpler." (−12) |
| Observers (guardian) | "You opened the Lacuna core. What did you learn?" | "That the network must not be opened carelessly." (+12; flag `accord_minded`) · "That it is powerful, and that power can be shared." (0; flag `union_minded`) · "That whoever powers the Heart rules the Frontier." (−12; flag `dominion_minded`) |

If the player has not opened the Lacuna core (an M7 start without it), the Observers ask "You
carry the old ones' knowledge, or soon will. What will you do with it?" with the same replies.
