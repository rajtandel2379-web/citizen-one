---
description: Testing-specific instructions.
alwaysApply: false
---

# Testing Rules

These rules apply to all testing activities.

---

# Testing Philosophy

Every important change should be verified.

Testing should increase confidence, not just improve coverage numbers.

---

# Before Testing

Understand:

- expected behavior
- actual behavior
- edge cases
- acceptance criteria

Do not write meaningless tests.

---

# Test Types

Choose the appropriate level:

- Unit Tests
- Integration Tests
- End-to-End Tests

Prefer the smallest test that validates the requirement.

---

# Test Quality

Tests should be:

- deterministic
- readable
- maintainable
- independent

Avoid flaky tests.

---

# Assertions

Each test should verify one clear behavior.

Keep assertions focused.

Avoid testing unrelated functionality.

---

# Test Data

Use realistic test data.

Avoid hardcoded values unless they improve clarity.

Keep test data isolated.

---

# Bug Fixes

When fixing a bug:

1. reproduce it
2. fix it
3. add or update a test to prevent regression

---

# Performance

Do not make tests unnecessarily slow.

Mock external services when appropriate.

Avoid unnecessary network calls.

---

# AI Behaviour

Before writing tests:

- understand the expected behavior
- identify important scenarios
- include edge cases where appropriate

Do not generate tests that simply increase coverage without validating meaningful behavior.