---
description: Backend-specific instructions.
alwaysApply: false
---

# Backend Rules

These rules apply only to backend projects.

---

# Architecture

Follow the architecture already used in the project.

Do not introduce a different architecture without approval.

Keep responsibilities separated.

Examples:

- Controller
- Service
- Repository
- Model / Entity
- DTO
- Configuration

---

# Business Logic

Business logic belongs in the service layer.

Do not place business logic inside:

- controllers
- repositories
- configuration classes

Keep controllers thin.

---

# API Design

Follow the project's API conventions.

Keep endpoints:

- predictable
- consistent
- RESTful unless the project specifies otherwise

---

# Validation

Validate all external input.

Never trust client input.

Validate:

- request body
- query parameters
- path variables
- headers

---

# Error Handling

Use consistent error responses.

Do not expose:

- stack traces
- database errors
- internal implementation details

Return meaningful error messages.

---

# Database Access

All database operations should go through the project's data access layer.

Avoid writing raw queries unless necessary.

Prefer consistency over micro-optimizations.

---

# Security

Never disable security for convenience.

Do not:

- hardcode secrets
- expose tokens
- expose passwords
- commit credentials

Security should remain enabled unless the user explicitly requests otherwise.

---

# Logging

Log important events.

Do not log:

- passwords
- tokens
- API keys
- personal information
- secrets

Logs should help debugging without exposing sensitive data.

---

# Performance

Optimize only after identifying a bottleneck.

Avoid unnecessary:

- database queries
- API calls
- object creation

Measure before optimizing.

---

# Configuration

Configuration should come from:

- environment variables
- configuration files
- secret managers

Do not hardcode environment-specific values.

---

# Dependencies

Before adding a backend library:

- check existing dependencies
- justify why it is needed
- avoid duplicate functionality

---

# AI Behaviour

Before implementing backend changes:

- understand the feature
- identify affected layers
- explain the implementation plan
- ask for approval if the change is significant

Do not make architectural decisions on behalf of the user.

Follow the project's existing backend conventions.