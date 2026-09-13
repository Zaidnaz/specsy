# Export

## ADDED Requirements

### Requirement: EXP-1 Export filtered invoices

The invoice list MUST offer an export control that downloads the currently
filtered invoices as a CSV file.

#### Scenario: Export with an active filter

- **WHEN** a user has filtered the invoice list to 20 rows and selects Export
- **THEN** the downloaded file contains exactly those 20 rows plus a header row

### Requirement: EXP-2 Cap export size

The export MUST reject any request covering more than 50000 invoices.

#### Scenario: Over the cap

- **WHEN** a user exports a filter matching 50001 invoices
- **THEN** the request is rejected and the user sees a message naming the 50000 limit
