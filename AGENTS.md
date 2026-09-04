# AI Coding Instructions

## Code Documentation

All code comments and documentation must be written in English.

The primary goal of comments is to preserve important context for future developers and AI coding agents.

### When to add comments

Add comments when the intent, reasoning, constraint, or behavior cannot be understood easily from the code itself.

Comments are especially valuable for:

- non-obvious implementation decisions
- the reason behind an unusual approach
- important business or gameplay rules
- invariants and assumptions
- edge cases
- limitations or constraints imposed by external systems
- interactions between different systems
- unintuitive lifecycle or state-management behavior
- performance-related decisions
- workarounds for engine, framework, platform, or third-party limitations
- behavior that a future developer might accidentally break
- code whose correct behavior depends on information that is not obvious from the implementation

### What comments should explain

Prefer explaining why something is done rather than describing what the code does.

Good:

```ts
// We intentionally cache this value because recalculating it every frame
// causes unnecessary allocations when hundreds of entities are active.
```

Bad:

```ts
// Calculate the value.
const value = calculateValue();
```

Do not write comments that merely restate the code, variable names, or function names.

Bad:

```ts
// Get the player.
const player = getPlayer();
```

## Complex systems

Complex systems should be documented at the system level.

When appropriate, add class-level or module-level documentation explaining:

- the purpose of the system
- its responsibilities
- important invariants
- important assumptions
- how it interacts with other systems
- important state transitions
- significant constraints
- non-obvious design decisions

Do not document every function mechanically. Focus on information that would otherwise have to be rediscovered by reading and reasoning through the entire implementation.

## Keep documentation accurate

Comments and documentation are part of the codebase and must remain consistent with the implementation.

Never invent behavior that is not supported by the code or project requirements.

If the intended behavior is unclear, do not guess. Ask for clarification or explicitly mention the uncertainty.

When modifying code:

- update nearby comments if the documented behavior changes
- update relevant documentation files if system behavior, rules, architecture, data models, or invariants change
- remove or correct documentation that becomes obsolete

Documentation should describe the current implementation, not historical behavior, unless the historical context is itself important.

## AI-oriented documentation

Write comments and documentation so that a future AI coding agent can quickly understand the relevant context without having to infer everything from the implementation.

Prefer documenting:

- design intent
- constraints
- invariants
- relationships between systems
- reasons behind architectural decisions
- known edge cases
- important consequences of changing the code
- dependencies between systems
- authoritative sources of truth for game rules and data

Avoid documenting obvious implementation details.

## Documentation files

For sufficiently complex systems, prefer creating dedicated Markdown documentation rather than putting large amounts of information into source-code comments.

Documentation should describe systems, rules, relationships, constraints, and design decisions rather than simply duplicating source code.

The project currently contains the following documentation files:

- `docs/architecture.md` — overall project architecture and major system relationships
- `docs/battle-rules.md` — battle and combat rules
- `docs/data-models.md` — important data structures and domain models
- `docs/game-systems.md` — major gameplay systems and their responsibilities
- `docs/invariants.md` — rules and conditions that must always remain true
- `docs/ship-production.md` — ship production, global stock, and fleet assembly pipeline
- `docs/game-time.md` — centralized game time, pause/speed controls, and scaled delta flow

These files are the current documentation sources of truth for their respective topics.

### Creating new documentation files

If a system, subsystem, feature, rule set, workflow, or other area becomes sufficiently complex that it deserves dedicated documentation, create a new Markdown file under `docs/`.

Do not force unrelated information into an existing documentation file just to avoid creating a new file.

Create a new documentation file when, for example:

- a system has substantial design rules that cannot be explained clearly in `game-systems.md`
- a subsystem has its own lifecycle, state machine, or interactions
- a feature has complex rules or edge cases
- a data subsystem requires detailed explanation beyond `data-models.md`
- an architectural decision requires substantial context
- a technical integration or external constraint needs dedicated documentation
- documenting the system in source comments would create excessive or duplicated comments

Use a clear, descriptive, kebab-case filename:

```text
docs/<topic-name>.md
```

The new documentation file must:

1. Be written in English.
2. Describe the relevant system, rules, constraints, or design decisions.
3. Avoid mechanically duplicating source code.
4. Reference related documentation where useful.
5. Be kept up to date when the implementation changes.
6. Be added to the documentation list in this `AGENTS.md`.

For example, if a new `docs/fleet-management.md` file is created, update this section to include:

```md
- `docs/fleet-management.md` — fleet management rules and system behavior
```

### Choosing the appropriate documentation file

Before creating a new documentation file, check whether the information belongs in one of the existing documents.

Prefer updating an existing document when the new information is naturally part of its scope.

Create a new document only when the topic has enough independent complexity or importance to justify its own source of truth.

Do not create documentation files for trivial features, simple classes, straightforward implementations, or information that is already obvious from the code.

### Documentation links

Documentation files should link to related documentation when there are meaningful dependencies between them.

Use relative Markdown links, for example:

```md
See [Battle Rules](./battle-rules.md) for combat resolution rules.
```

When a new documentation file is created, update this `AGENTS.md` so that the file is discoverable by future AI coding agents.

## Documentation hierarchy

Use the following general responsibility boundaries:

- `architecture.md`

  - overall architecture
  - major modules and system relationships
  - high-level dependency direction
  - architectural decisions

- `game-systems.md`

  - major gameplay systems
  - system responsibilities
  - interactions between gameplay systems
  - important state transitions

- `battle-rules.md`

  - combat rules
  - battle resolution
  - combat-specific calculations
  - combat-related gameplay constraints

- `data-models.md`

  - domain entities
  - important data structures
  - relationships between models
  - authoritative data representation

- `invariants.md`

  - conditions that must always remain true
  - cross-system consistency requirements
  - assumptions that must not be violated

If a topic does not fit cleanly into these responsibilities and is sufficiently complex, create a dedicated documentation file instead of overloading an existing document.

## Documentation maintenance

When implementing a change:

1. Determine whether the change affects documented architecture, systems, rules, data models, or invariants.
2. Update the relevant documentation if necessary.
3. If the change introduces a sufficiently complex new topic, create a dedicated `docs/<topic-name>.md`.
4. Add every newly created documentation file to the documentation list in this `AGENTS.md`.
5. Keep cross-references between documentation files accurate.
6. Do not leave documentation describing behavior that no longer exists.

Documentation changes should be treated as part of the implementation, not as an optional follow-up task.

## Language

All:

- source-code comments
- XML documentation
- Markdown documentation
- architecture documentation
- AI-facing project documentation

must be written in English.

## Minimal noise

Do not add comments merely to increase documentation coverage.

A smaller number of high-value comments is preferable to a large number of low-value comments.

The code should remain readable without excessive commentary.
