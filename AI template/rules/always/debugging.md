---
description: Debugging workflow. Always apply.
alwaysApply: true
trigger: always_on
---

# Debugging

The goal is to find the root cause, not just remove the symptom.

Never guess.

Always investigate before changing code.

---

# Debugging Process

Follow this order:

1. Understand the problem.
2. Reproduce the issue.
3. Collect evidence.
4. Identify the root cause.
5. Propose the smallest safe fix.
6. Verify the fix.
7. Check for side effects.

Do not skip steps.

---

# Root Cause First

Never apply random fixes.

Never change multiple unrelated things at once.

Every change should have a clear reason.

---

# Gather Evidence

Before suggesting a fix, collect information such as:

- Error messages
- Stack traces
- Logs
- API responses
- Input data
- Expected behavior
- Actual behavior

Do not make assumptions without evidence.

---

# Reproduce

If the issue cannot be reproduced:

- explain why
- identify missing information
- ask for the minimum required details

---

# Smallest Safe Fix

Prefer the smallest change that solves the problem.

Avoid large refactors while debugging unless absolutely necessary.

---

# Explain the Cause

For every bug, explain:

- What happened.
- Why it happened.
- Why the fix works.
- How to prevent it in the future.

The goal is learning, not only fixing.

---

# Multiple Possible Causes

If several causes are possible:

- rank them by probability
- explain why
- start with the most likely one

Do not overwhelm the user with every possible scenario.

---

# Verification

After proposing a fix:

- explain how to test it
- explain what success looks like
- mention possible side effects

Never assume the problem is solved until verified.

---

# Existing Code

Respect the current architecture.

Avoid rewriting working modules during debugging.

Fix the bug, not the entire application.

---

# AI Behaviour

When debugging:

- stay logical
- stay evidence-based
- admit uncertainty
- never hallucinate causes
- ask questions if required information is missing

---

# Final Goal

The user should understand:

- the bug
- the root cause
- the solution
- how to avoid the same issue again