## Context

See `proposal.md` — Why for motivation, and `specs/lint-scope/spec.md` for the behavior.

Two facts about the current code shape the approach:

- `Adapter.load(root)` returns a whole `SpecProject`, and the OpenSpec adapter appends the
  living spec as a `SpecChange` with the id `(living spec)`. Scope is therefore a property
  of *loading*, not of linting — by the time `lint()` runs, the living spec is
  indistinguishable from a real change except by that id string.
- `config.ignore` is declared, defaulted, and merged, but never read. Any design that
  quietly reuses it would be building on something that does not work.

## Goals / Non-Goals

**Goals:**

- Make the narrowing explicit and visible, so a scoped run cannot be mistaken for a full one.
- Keep scope entirely out of rule code. No rule should learn what a scope is.
- Fail loudly on any selection that cannot be honoured, rather than linting a surprising set.

**Non-Goals:**

- Reworking the adapter interface beyond what scoping needs.
- Making `generic` support changes. Declaring that it has none is the whole of its
  participation here.

## Decisions

### Scope resolves to a document filter applied at load, not a rule input

`Scope` becomes a small resolved value — `{ kind: "all" | "changes" | "living" } | { kind: "change"; id: string }` —
computed in the CLI from the flag and config, then passed to `adapter.load(root, scope)`.
The adapter returns only the changes in scope. `lint()` and every rule are untouched.

*Why:* it makes SCOPE-007 true by construction rather than by discipline. If scope never
reaches a rule, a rule cannot behave differently under it, so "same findings at any scope"
needs no per-rule care and cannot regress as rules are added.

*Alternatives considered:* filtering the `SpecProject` after `load()` — simpler to write,
but it reads and parses every markdown file in the living spec only to discard it, which is
the bulk of the work in a large project and defeats half the point. This is what
`src/mcp/server.ts` does today, and moving it onto the shared path is part of this change
rather than a separate cleanup: leaving two narrowing implementations is how the two
surfaces drift apart again. Filtering diagnostics after `lint()` — worse still, and it
would let a cross-document rule see documents the user excluded, making findings depend on
out-of-scope content.

### `--change <id>` is a scope, not a separate mechanism

Selecting one change resolves to `{ kind: "change", id }` and travels the same path.
`--scope` and `--change` are mutually exclusive; passing both is a usage error.

*Why:* one concept with one resolution point. Two parallel narrowing mechanisms would each
need their own empty-selection handling, their own reporting, and their own interaction
rules with config.

### Adapters declare whether they have changes

`Adapter` gains `hasChanges: boolean`. `openspec` sets it true; `generic` sets it false.
The CLI refuses a change-based scope against an adapter with `hasChanges: false`.

*Why:* SCOPE-004 needs a check that is a property of the adapter rather than a name
comparison in the CLI, so a third adapter added later gets the correct behavior by
declaring one field instead of by someone remembering to update a conditional.

*Alternative considered:* letting the adapter throw. That spreads CLI error formatting into
adapter code and makes the message harder to keep consistent.

### The living spec stops being identified by a magic string

The pseudo-change keeps its display id, but `SpecChange` gains `kind: "change" | "living"`.
Filtering reads the field.

*Why:* `(living spec)` is currently load-bearing as an identifier while also being a label
shown to users. Renaming the label would silently change filtering. Splitting identity from
presentation removes a trap the codebase has already fallen into: `src/mcp/server.ts`
matches `c.id === change`, so `lint_specs` with `change: "(living spec)"` selects the
pseudo-change today. `--change "(living spec)"` must not, and the field makes that obvious
rather than relying on someone remembering to special-case the string.

### Empty selections are errors, and the exit code is 2

Exit `2` is what the CLI already uses for "could not run" — unknown format, nothing found —
as distinct from `1` for "ran and found problems".

*Why:* the distinction already exists in the code and CI depends on it. An empty selection
is a failure to run, not a clean result. Pointedly, `--change add-ath` with a typo must not
exit `0`; SCOPE-002 and SCOPE-003 exist to prevent exactly that silent pass.

### The default stays `all`

*Why:* changing it would alter the exit code of existing CI on the first upgrade, for
projects that never asked for scoping. The README recommends `"scope": "changes"` in
`.specsyrc.json` for change-driven workflows, which is an opt-in a project makes once.

*Trade-off:* the better default for the tool's main workflow is arguably `changes`, and
keeping `all` means most users never discover the feature. Accepted for this change;
revisit at a major version, where the migration can be stated up front.

## Risks / Trade-offs

- **Scope silently narrows a CI run and a real regression goes unreported** → SCOPE-003 and
  SCOPE-005 exist for this: an empty selection is an error, and a narrowed run states its
  scope and document count in the summary rather than printing a bare "no problems".

- **`hasChanges` drifts out of sync when an adapter changes shape** → It sits on the adapter
  definition beside `autoDetect`, and the generic adapter's scope-refusal path is covered by
  a test, so a wrong value fails the suite rather than surfacing as a confusing message.

- **Adding a parameter to `Adapter.load` breaks any out-of-tree adapter** → The signature is
  internal and unexported from the package entry, and scope is optional with `all` as the
  default, so an adapter ignoring it keeps today's behavior.

- **Two ways to narrow (`--scope`, `--change`) invite confusion about precedence** →
  Mutually exclusive and refused together, so there is no precedence to learn.

## Migration Plan

- **Deploy:** additive. No configuration file needs to change, and no existing invocation
  changes behavior or exit code.
- **Adopt:** a project opting in adds `"scope": "changes"` to `.specsyrc.json`.
- **Rollback:** remove the flags and the `scope` key; nothing persists any state.

## Open Questions

None that affect these specs, the approach, or the task breakdown.

`config.ignore` being dead is a real defect, but it is recorded in the proposal's Impact and
fixing it changes nothing here: scoping selects whole changes, and `ignore` would filter
files within them. The two compose whichever order they land in.
