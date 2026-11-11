---
description: Coding principles. Always apply.
alwaysApply: true
trigger: always_on
---

# Coding Principles

Write code that is easy to understand, maintain, and extend.

Optimize for readability before cleverness.

---

# General Rules

- Keep solutions simple.
- Solve the actual problem.
- Do not over-engineer.
- Avoid premature optimization.
- Prefer maintainability over short code.
- Follow the project's existing style.
- Keep code predictable.

---

# Before Writing Code

Always:

1. Understand the requirement.
2. Check existing code.
3. Reuse existing patterns.
4. Identify missing information.
5. Clarify assumptions when necessary.

Do not start coding immediately.

---

# Existing Code

Respect the existing codebase.

Do not rewrite working code unless:

- the user requests it
- there is a bug
- there is a security issue
- there is a measurable improvement

Prefer improving existing code over replacing it.

---

# Simplicity

Prefer:

- simple logic
- descriptive names
- fewer abstractions
- fewer dependencies
- smaller functions

Avoid solving future problems that do not exist yet.

---

# Functions

A function should do one thing.

Prefer:

- small functions
- meaningful names
- clear inputs
- clear outputs
- minimal side effects

---

# Naming

Names should explain purpose.

Avoid:

- temp
- data
- obj
- thing
- value1
- finalData2

Prefer names that explain intent.

---

# Code Reuse

Before writing new code:

- search for an existing implementation
- reuse common utilities
- avoid duplicate logic

Do not copy and paste code.

---

# Error Handling

Handle expected failures.

Never silently ignore errors.

Error messages should explain:

- what failed
- why it failed
- what can be done next

---

# Comments

Write comments only when they add value.

Do not comment obvious code.

Prefer self-explanatory code over excessive comments.

---

# Performance

Do not optimize without evidence.

First:

- make it correct
- make it readable
- measure performance

Optimize only if needed.

---

# Dependencies

Before adding a dependency:

- check if the standard library is enough
- check if the project already has a solution

Avoid unnecessary packages.

---

# Code Quality

Every change should improve at least one of these:

- readability
- maintainability
- correctness
- security
- performance

Never reduce code quality to save a few lines.

---

# AI Behaviour

If multiple implementations are possible:

- recommend the simplest correct solution
- explain important trade-offs
- mention better alternatives if relevant

Do not generate unnecessarily complex code just because it is technically possible.

---

# If Unsure

Ask before making assumptions.

It is better to ask one question than implement the wrong solution.