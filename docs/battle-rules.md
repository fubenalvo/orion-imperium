# Battle Rules

## Trigger Conditions

A battle is triggered when two active (non-destroyed) fleets occupy the same grid cell:
1. Both fleets must have matching `gridCol` and `gridRow`.
2. Both fleets must have valid faction references.
3. Neither faction can be neutral (team 0).
4. Factions must be on different teams.
5. The fleet pair must not have already triggered a battle (tracked by `triggeredBattles` Set).

## Resolution

Battles are resolved instantaneously when triggered:

```
fleet1Attack = sum of attack stats of all ships in fleet1
fleet1Shield = sum of shield stats of all ships in fleet1
fleet2Attack = sum of attack stats of all ships in fleet2
fleet2Shield = sum of shield stats of all ships in fleet2

fleet1Score = max(0, fleet1Attack - fleet2Shield)
fleet2Score = max(0, fleet2Attack - fleet1Shield)
```

- The fleet with the higher score wins.
- Ties go to fleet1 (the fleet with the lower ID, due to `>=` comparison).

## Outcome

- Winner: Survives, no state change.
- Loser: `destroyed = true` is set. The fleet is filtered from active fleets.
- Draw: Possible only if both scores are 0 (both fleets have zero effective attack or the enemy shield completely negates all attack). In this case fleet1 is still marked as winner.

## Edge Cases

- If a ship type is not found in the ShipService lookup, its attack/shield contributes 0.
- A fleet with only unrecognized ship types will have 0 attack and 0 shield.
- Multiple battles can trigger in sequence, but only one per frame (the function returns after the first battle).

## Limitations

- No shield regeneration during battle.
- No ship destruction during battle; the entire fleet is either destroyed or survives.
- No weapon type effectiveness (weakness field is defined but unused).
- No critical hits, evasion, or random factors.
