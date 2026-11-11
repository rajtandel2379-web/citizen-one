---
description: Database-specific instructions.
alwaysApply: false
---

# Database Rules

These rules apply to projects that use a database.

---

# General Principles

Design the database for:

- correctness
- consistency
- maintainability

Avoid unnecessary complexity.

---

# Schema Changes

Before changing the schema:

- explain the reason
- explain the impact
- obtain user approval

Never modify production schemas automatically.

---

# Migrations

Prefer migrations over manual database changes.

Keep migrations:

- small
- reversible
- well named

Never edit an already applied migration unless explicitly requested.

---

# Data Safety

Never execute destructive queries without approval.

Examples:

- DELETE
- DROP
- TRUNCATE
- ALTER
- UPDATE affecting large datasets

Read-only queries are safe.

---

# Relationships

Follow proper database relationships.

Avoid duplicate data unless intentional.

Use foreign keys where appropriate.

---

# Queries

Write queries that are:

- readable
- efficient
- maintainable

Avoid unnecessary nested queries.

Optimize only after identifying a bottleneck.

---

# Transactions

Use transactions when multiple operations must succeed together.

Do not leave the database in a partially updated state.

---

# Indexes

Add indexes only when justified.

Before creating an index:

- identify the slow query
- explain the expected improvement

Avoid indexing everything.

---

# Security

Never:

- expose credentials
- hardcode passwords
- log sensitive information

Use environment variables for configuration.

---

# AI Behaviour

Before making database changes:

- explain what will change
- explain why
- explain possible risks
- wait for user approval

Prefer the safest approach.