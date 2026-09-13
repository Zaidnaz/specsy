## Purpose

Lets a user decide what a lint run covers — the change they are working on, the living
spec, or everything — so that findings reported are findings they can act on now, and so
that a narrowed run can never be mistaken for a full one.

## ADDED Requirements

### Requirement: SCOPE-001 Scope selects which documents a run covers

The tool SHALL accept a scope of `all`, `changes`, or `living`.
A scope of `all` SHALL cover every in-flight change and the living spec.
A scope of `changes` SHALL cover every in-flight change.
A scope of `changes` SHALL exclude the living spec.
A scope of `living` SHALL cover the living spec.
A scope of `living` SHALL exclude every in-flight change.
The tool SHALL continue to exclude archived changes under `changes/archive/` at every scope.

#### Scenario: Default scope covers everything

- **WHEN** a user runs the tool with no scope option in a project with one in-flight change and a living spec
- **THEN** the run covers the documents of both
- **AND** the findings are identical to those the tool reports today

  Rationale: the default has to stay put, or every existing run and CI gate changes meaning.

#### Scenario: Scope of changes excludes the living spec

- **GIVEN** a project with one in-flight change and a living spec that contains findings
- **WHEN** a user runs the tool with a scope of `changes`
- **THEN** the report contains only findings from the in-flight change
- **AND** no finding cites a file under the living spec directory

#### Scenario: Scope of living excludes in-flight changes

- **GIVEN** a project with one in-flight change that contains findings and a living spec
- **WHEN** a user runs the tool with a scope of `living`
- **THEN** the report contains only findings from the living spec
- **AND** no finding cites a file under a change directory

#### Scenario: Archived changes stay excluded

- **GIVEN** a project with an archived change under `changes/archive/`
- **WHEN** a user runs the tool at any scope
- **THEN** no finding cites a file under the archive directory

#### Scenario: Unknown scope value is refused

- **WHEN** a user passes a scope that is not `all`, `changes`, or `living`
- **THEN** the tool reports the invalid value and the accepted values
- **AND** the tool exits with status `2`

### Requirement: SCOPE-002 A single change can be selected by id

The tool SHALL accept the id of one in-flight change.
A run that names a change id SHALL cover only that change.
The id SHALL be the change's directory name, as it appears in a report and in the project layout.
Selecting a change by id SHALL exclude the living spec.

#### Scenario: Named change is linted alone

- **GIVEN** a project with in-flight changes `add-auth` and `add-billing`
- **WHEN** a user selects the change `add-auth`
- **THEN** the report contains only findings from `add-auth`
- **AND** no finding cites a file under `add-billing`

#### Scenario: Unknown change id is refused

- **WHEN** a user selects a change id that no in-flight change directory matches
- **THEN** the tool reports the id it could not find
- **AND** the tool lists the change ids that do exist
- **AND** the tool exits with status `2`

  Rationale: a typo in a CI invocation would otherwise lint nothing and report success,
  which is the exact failure this capability exists to prevent.

#### Scenario: Archived change cannot be selected by id

- **GIVEN** a change that has been archived
- **WHEN** a user selects it by id
- **THEN** the tool refuses the selection as unknown
- **AND** the tool exits with status `2`

### Requirement: SCOPE-003 A selection that covers nothing is an error

The tool SHALL report an error when the resolved selection contains no documents.
The tool SHALL exit with status `2` when the selection contains no documents.
The tool SHALL NOT report a selection that covers nothing as a successful run.

#### Scenario: Scope of changes in a project with no in-flight changes

- **GIVEN** a project whose living spec exists but which has no in-flight change
- **WHEN** a user runs the tool with a scope of `changes`
- **THEN** the tool reports that the selection covered no documents
- **AND** the tool exits with status `2`

  Rationale: reporting success here would let a CI gate pass green while checking nothing,
  which is indistinguishable from the gate working until the day it matters.

#### Scenario: Scope of living in a project with no living spec

- **GIVEN** a project with in-flight changes and no living spec directory
- **WHEN** a user runs the tool with a scope of `living`
- **THEN** the tool reports that the selection covered no documents
- **AND** the tool exits with status `2`

### Requirement: SCOPE-004 An adapter that cannot honour a scope refuses it

The tool SHALL report an error when the active adapter has no concept of in-flight changes and a change-based selection is requested.
The tool SHALL exit with status `2` when it refuses such a selection.
The tool SHALL NOT silently ignore a scope option it cannot honour.

#### Scenario: Change-based scope against a layout without changes

- **GIVEN** a project read with an adapter that models a flat folder of documents
- **WHEN** a user runs the tool with a scope of `changes`
- **THEN** the tool reports that the layout has no in-flight changes to scope to
- **AND** the tool exits with status `2`

  Rationale: ignoring the option would lint everything while the user believed the run was
  narrowed, which is a silent, wrong pass.

#### Scenario: Scope of all is always honoured

- **WHEN** a user runs the tool with a scope of `all` against any supported layout
- **THEN** the tool lints every document that layout provides
- **AND** the tool does not report a scope error

### Requirement: SCOPE-005 The report states the active scope

The report SHALL state the active scope whenever the scope is not the default.
The report SHALL state the number of documents the run covered.
A report of no findings SHALL be distinguishable from a run that covered nothing.

#### Scenario: Narrowed run names its scope

- **WHEN** a user runs the tool with a scope of `changes` and the run finds no problems
- **THEN** the summary states that no problems were found
- **AND** the summary states the active scope and the number of documents covered

  Rationale: a bare "no problems" after a narrowed run invites the reader to believe more
  was checked than was.

#### Scenario: Default run is unchanged

- **WHEN** a user runs the tool with no scope option
- **THEN** the summary is the summary the tool produces today

#### Scenario: Machine-readable reporters carry the scope

- **WHEN** a user runs the tool with a non-default scope and a machine-readable reporter
- **THEN** the emitted payload carries the active scope and the number of documents covered

### Requirement: SCOPE-006 Scope is configurable per project

The tool SHALL accept a scope from the configuration file.
A scope given on the command line SHALL override a scope given in the configuration file.
The tool SHALL refuse an invalid scope from the configuration file the same way it refuses one from the command line.

#### Scenario: Configured scope applies without a command-line option

- **GIVEN** a configuration file setting the scope to `changes`
- **WHEN** a user runs the tool with no scope option
- **THEN** the run covers only in-flight changes

#### Scenario: Command line wins over configuration

- **GIVEN** a configuration file setting the scope to `changes`
- **WHEN** a user runs the tool with a scope of `all`
- **THEN** the run covers every in-flight change and the living spec

#### Scenario: Invalid configured scope is refused

- **GIVEN** a configuration file setting the scope to a value that is not accepted
- **WHEN** a user runs the tool
- **THEN** the tool reports the invalid value and names the configuration file it came from
- **AND** the tool exits with status `2`

### Requirement: SCOPE-007 Scope changes coverage and never judgement

Scope SHALL determine only which documents a run covers.
A document that is in scope SHALL produce exactly the findings it produces when linted at the default scope.
Scope SHALL NOT alter the severity of any rule.

#### Scenario: Findings for a document do not depend on scope

- **GIVEN** an in-flight change containing at least one finding
- **WHEN** a user lints it at the default scope and again with a scope of `changes`
- **THEN** both runs report the same findings for that change, with the same rules, severities, and positions

  Rationale: if narrowing a run also changed verdicts, no one could trust either result.

#### Scenario: Traceability findings stay within their change

- **GIVEN** two in-flight changes, each with its own requirements and tasks
- **WHEN** a user selects one of them by id
- **THEN** the traceability findings reported are the same ones that change produces at the default scope
