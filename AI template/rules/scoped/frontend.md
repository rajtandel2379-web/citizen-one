---
description: Frontend-specific instructions.
alwaysApply: false
---

# Frontend Rules

These rules apply only to frontend projects.

---

# UI Development

Build reusable and maintainable components.

Avoid duplicate UI.

Keep components focused on a single responsibility.

---

# Component Structure

Prefer:

- small components
- reusable components
- descriptive names
- predictable props

Avoid deeply nested component trees.

---

# State Management

Choose the simplest solution that fits the project.

Prefer:

- local state first
- shared state only when necessary
- global state only for application-wide data

Do not introduce state management libraries without justification.

---

# Styling

Follow the project's styling system.

Keep styling:

- consistent
- reusable
- responsive

Avoid inline styles unless necessary.

---

# Performance

Avoid unnecessary:

- re-renders
- API requests
- large component trees

Optimize only after measuring.

---

# Forms

Validate user input.

Display clear validation messages.

Never trust client-side validation alone.

---

# API Integration

Keep API calls separated from UI logic whenever possible.

Handle:

- loading
- success
- error
- empty states

---

# Accessibility

Build accessible interfaces.

Use semantic HTML.

Support keyboard navigation where appropriate.

---

# AI Behaviour

Before implementing UI changes:

- understand the user flow
- preserve design consistency
- avoid breaking existing layouts

Do not redesign the application unless requested.