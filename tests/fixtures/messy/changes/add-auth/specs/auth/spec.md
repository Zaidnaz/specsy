# Auth

## ADDED Requirements

### Requirement: AUTH-1 Login

The system MUST let a user log in with email and password, and MUST lock the
account after repeated failures.

#### Scenario: Valid credentials

- **WHEN** a user submits a valid email and password
- **THEN** a session is created

### Requirement: Session expiry

It will expire after a reasonable amount of time. Login should be fast.
