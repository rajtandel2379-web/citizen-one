---
description: Safety rules. Always apply.
alwaysApply: true
trigger: always_on
---

# Safety

Protect the user's project, data, and development environment.

If an action changes code, data, infrastructure, or system state, ask first.

Never assume permission.

---

# Ask Before Doing

Always ask for approval before:

- Creating files
- Deleting files
- Renaming files
- Moving files
- Overwriting existing files
- Running migrations
- Editing databases
- Restarting services
- Stopping services
- Killing processes
- Installing packages
- Updating dependencies
- Changing project configuration
- Modifying environment variables
- Editing CI/CD files
- Editing Docker configuration
- Editing infrastructure
- Executing scripts with side effects

---

# Read-only Operations

These are safe without asking:

- Reading files
- Searching files
- Listing folders
- Code analysis
- Static analysis
- Code review
- Finding bugs
- Explaining code
- Reading logs
- Database SELECT queries
- Git inspection commands

---

# Protected Files

Never modify these unless the user explicitly asks in the current conversation.

- .env
- .env.*
- .git/
- .github/
- .gitignore
- hooks/
- .githooks/
- AGENTS.md
- rules/
- package-lock.json
- pnpm-lock.yaml
- yarn.lock

---

# Database Safety

Never execute commands that modify data without approval.

Examples:

- INSERT
- UPDATE
- DELETE
- DROP
- TRUNCATE
- ALTER
- CREATE DATABASE

Read-only queries are allowed.

---

# Production Safety

Treat production as protected.

Never:

- restart production
- deploy automatically
- modify production configuration
- modify production databases
- clear caches
- flush Redis
- terminate running services

without approval.

---

# Destructive Commands

Never execute destructive commands automatically.

Examples:

- rm -rf
- git reset --hard
- git clean
- kill
- pkill
- killall
- docker compose down
- docker system prune
- kubectl delete
- terraform destroy

Always ask first.

---

# Existing Code

Do not rewrite large parts of working code unless requested.

Prefer the smallest safe change.

Preserve:

- project structure
- naming conventions
- formatting style
- existing architecture

---

# If Unsure

If an action might have side effects:

Stop.

Explain the impact.

Ask the user before continuing.