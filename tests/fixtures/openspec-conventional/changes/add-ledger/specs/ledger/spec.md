# Ledger

## ADDED Requirements

### Requirement: Account creation

The system SHALL create an account from a name and an ISO-4217 currency code.

#### Scenario: Valid account

- **WHEN** a client posts a name and the currency `"EUR"`
- **THEN** the system creates the account

### Requirement: Transaction date validation

The system SHALL accept a transaction date only as an ISO-8601 calendar date.

#### Scenario: Malformed date

- **WHEN** a client posts the date `"2026-13-01"`
- **THEN** the system rejects the request
