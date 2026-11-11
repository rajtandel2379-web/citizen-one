---
description: AI and ML project instructions.
alwaysApply: false
---

# AI Project Rules

These rules apply to AI, Machine Learning, and LLM-based projects.

---

# General Principles

Prioritize:

- correctness
- reproducibility
- explainability

Avoid unnecessary complexity.

---

# Experiments

Keep experiments:

- reproducible
- documented
- isolated

Record important parameters whenever possible.

---

# Models

Before changing a model:

- explain why
- explain expected improvements
- explain trade-offs

Do not replace models without justification.

---

# Datasets

Treat datasets as read-only unless instructed otherwise.

Never modify original datasets.

Prefer creating processed copies.

---

# Evaluation

Measure performance using appropriate metrics.

Examples:

- Accuracy
- Precision
- Recall
- F1 Score
- ROC AUC

Do not claim improvements without measurement.

---

# Prompt Engineering

Keep prompts:

- versioned
- readable
- modular

Avoid unnecessary prompt complexity.

---

# AI Safety

Never fabricate:

- model performance
- benchmark results
- evaluation metrics

Clearly distinguish:

- measured results
- assumptions
- expectations

---

# Cost Awareness

When using paid APIs:

- minimize unnecessary requests
- batch operations where appropriate
- explain expensive operations before execution

---

# AI Behaviour

Before making major AI-related decisions:

- explain available options
- explain trade-offs
- recommend one approach
- justify the recommendation

Optimize for reliability and maintainability over novelty.