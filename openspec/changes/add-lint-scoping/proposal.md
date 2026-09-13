## Why

`specsy` lints everything the adapter finds. For an OpenSpec project that means every
in-flight change **and** the whole living spec under `specs/**`, loaded as a pseudo-change
with the id `(living spec)`.

That is the wrong default for the workflow the tool is built for. When you are working on
one change, findings in the living spec are noise: they describe behavior that already
shipped, they are not yours to fix in this change, and they drown the handful of findings
that actually block you. The problem compounds — every archived change folds more content
into `specs/`, so the signal-to-noise ratio of a run gets monotonically worse over the life
of a project. A linter that reports mostly un-actionable findings gets run with `--quiet`,
then not at all.

There is no way to narrow the run today. Two things a user would reasonably try both fail:

- `specsy openspec/changes` exits 2 with "No spec format detected". `specRoot()` looks for a
  `changes` directory directly beneath the path it is given, or for `openspec/changes`
  beneath it. The changes directory itself contains neither, so pointing the path argument
  at it finds nothing.
- `"ignore"` in `.specsyrc.json` does nothing. It is declared on `Config`, defaulted in
  `defaultConfig`, and merged in `resolveConfig` — and then never read by any adapter,
  rule, or scan. It is dead config that reads like a working feature.

## What Changes

- Introduce a **lint scope**: an explicit choice of what a run covers, rather than always
  covering everything discoverable.
- Add `--scope <all|changes|living>` to the CLI, and a matching `"scope"` key in
  `.specsyrc.json`. The CLI flag overrides the config file.
- Add `--change <id>` to lint exactly one in-flight change by its directory name.
- Report the active scope in the summary line, so a run that finds nothing says what it
  actually checked rather than leaving the reader to assume.
- Treat a scope that selects **nothing** as an error, not a successful run. A gate that
  silently passes because it linted zero documents is worse than no gate.
- Treat a scope that the active adapter cannot honour as an error, for the same reason.
  The `generic` adapter has no concept of a change, so `--scope changes` against it is a
  user mistake worth reporting rather than ignoring.

### Non-goals

- **Changing the default.** Scope stays `all`, so existing runs and existing CI exit codes
  are unaffected. Projects that want the narrow behavior opt in via `.specsyrc.json`.
- **Fixing `config.ignore`.** It is a real defect found while scoping this work, but it is
  a separate concern with a separate fix, and folding it in here would make this change
  about two things. Recorded in Impact below so it is not lost.
- **Per-rule scoping.** Turning individual rules on for changes and off for the living spec
  is a different feature; per-rule severity already exists for the cases that matter today.
- **Changing which rules fire, or any rule's severity.** This change decides what gets
  linted, never how it is judged. The same document in scope must produce exactly the
  findings it produces today.
- Watch mode, incremental linting, and git-diff-aware scoping.

## Capabilities

### New Capabilities

- `lint-scope`: Selecting which spec documents a run covers — by kind (in-flight changes
  versus the living spec) and by individual change id — including how an empty or
  unsupported selection is reported.

### Modified Capabilities

None. This is the first change recorded for this project; `openspec list --specs` reports
no existing specs.

## Impact

- **Affected code**: `src/cli.ts` (two new options), `src/engine/types.ts` (`scope` on
  `Config`), `src/adapters/types.ts` and `src/adapters/openspec.ts` (honour the scope when
  loading), `src/adapters/generic.ts` (declare that it has no changes), and `src/report/`
  (surface the active scope).
- **Behavior**: no change for any existing invocation. `--scope all` is the default and is
  what every current run already does.
- **Exit codes**: unchanged for existing runs. Two new exit-2 conditions, both for
  selections that cannot be honoured, consistent with how an unknown `--format` already
  exits 2.
- **Dependencies**: none. `commander` already parses options.
- **Docs**: README needs the new flags and a recommended `.specsyrc.json` for
  change-driven workflows.
- **Discovered defect, deliberately out of scope**: `config.ignore` is declared, defaulted,
  and merged, but never applied anywhere. It should either be implemented or removed from
  `Config` — it currently misleads anyone reading the type.
