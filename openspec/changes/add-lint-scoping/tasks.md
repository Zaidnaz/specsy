## 1. Model and types

- [ ] 1.1 Add `kind: "change" | "living"` to `SpecChange` in `src/model.ts` and set it in the OpenSpec adapter, so the living spec is identified by a field rather than by its `(living spec)` display id; verify with a test asserting the pseudo-change carries `kind: "living"` while a real change carries `kind: "change"` (SCOPE-001)
- [ ] 1.2 Add the resolved `Scope` type (`all`, `changes`, `living`, or a named change) and `scope?: string` on `Config` in `src/engine/types.ts`; verify by typechecking and by a test asserting `defaultConfig` resolves to `all` (SCOPE-001, SCOPE-006)
- [ ] 1.3 Add `hasChanges: boolean` to the `Adapter` interface in `src/adapters/types.ts`, `true` on `openspec` and `false` on `generic`; verify with a test asserting the value for every registered adapter (SCOPE-004)

## 2. Scope resolution

- [ ] 2.1 Add a `resolveScope` function taking the CLI options and the loaded config and returning a resolved `Scope`; verify with unit tests covering each accepted value, the config-only path, the command line overriding config, and the default (SCOPE-001, SCOPE-006)
- [ ] 2.2 Make `resolveScope` reject an unknown value, naming the value and the accepted set, and reject a configured value the same way while naming the config file it came from; verify with tests asserting both messages and that neither path throws an unformatted error (SCOPE-001, SCOPE-006)
- [ ] 2.3 Make `--scope` and `--change` mutually exclusive with a usage error naming both options; verify with a test asserting the error and that neither option alone triggers it (SCOPE-002)

## 3. Scoped loading

- [ ] 3.1 Thread the resolved scope into `Adapter.load(root, scope)` with `all` as the default so an adapter ignoring it keeps current behavior; verify by typechecking and by a test asserting a load with no scope returns what it returns today (SCOPE-001)
- [ ] 3.2 Honour `changes` and `living` in the OpenSpec adapter by selecting on `SpecChange.kind`, and skip reading the excluded files rather than discarding them after parsing; verify with tests asserting the document sets for each scope and that archived changes stay excluded at every scope (SCOPE-001)
- [ ] 3.3 Honour a named change in the OpenSpec adapter by matching the change directory name, excluding the living spec; verify with tests covering a match, exclusion of a sibling change, and that the living spec cannot be selected by its display id (SCOPE-002)

## 4. Refusing selections that cannot be honoured

- [ ] 4.1 Refuse an unknown change id, reporting the id and listing the in-flight change ids that do exist, exiting `2`; verify with tests covering a typo'd id and an archived id, both asserting exit `2` and that the run reports no findings as success (SCOPE-002)
- [ ] 4.2 Refuse a selection that resolves to no documents, reporting that the selection covered nothing and exiting `2`; verify with tests covering a scope of `changes` with no in-flight change and a scope of `living` with no living spec (SCOPE-003)
- [ ] 4.3 Refuse a change-based scope against an adapter whose `hasChanges` is false, exiting `2`; verify with a test running a change-based scope against the generic adapter and asserting the message and exit code (SCOPE-004)

## 5. Reporting

- [ ] 5.1 Carry the active scope and the covered document count on the lint result; verify with a test asserting both are present for a default run and a narrowed one (SCOPE-005)
- [ ] 5.2 State the active scope and document count in the pretty summary when the scope is not the default, leaving the default summary byte-for-byte as it is; verify with tests asserting the narrowed summary names its scope and the default summary is unchanged (SCOPE-005)
- [ ] 5.3 Carry the active scope and document count in the json and github reporters; verify with tests asserting the fields appear in the emitted payload for a narrowed run (SCOPE-005)

## 6. Wiring and verification

- [ ] 6.1 Add the `--scope` and `--change` options to the CLI in `src/cli.ts`, wire them through `resolveScope` into `adapter.load`, and keep every existing option working; verify with end-to-end tests over a fixture project covering each scope and both refusal paths (SCOPE-001, SCOPE-002, SCOPE-004, SCOPE-006)
- [ ] 6.2 Assert scope changes coverage and never judgement by linting a fixture change at the default scope and at `changes` and comparing the findings for that change, including rules, severities, and positions (SCOPE-007)
- [ ] 6.3 Assert traceability findings for a change selected by id match the findings that change produces at the default scope, using a fixture with two in-flight changes (SCOPE-007)
- [ ] 6.4 Document the new flags and a recommended `.specsyrc.json` for change-driven workflows in the README, and note that the default scope is unchanged (SCOPE-006)
- [ ] 6.5 Run the typecheck and the full test suite and confirm both pass with no skipped tests, and confirm `specsy` on this repo reports no problems (SCOPE-003, SCOPE-005)
