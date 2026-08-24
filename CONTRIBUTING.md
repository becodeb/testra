# Contributing to Testra

## Product principles

- A student must see every signal recorded about them when it happens.
- Incidents are conversation material for the teacher, never an automatic failing grade.
- Answer keys must never be serialized to a student-facing response. Use `toStudentQuestion()` and keep its leak tests passing.
- Server timestamps and the run actor's clock are authoritative. Never trust a client clock for grading, timing, or ordering.
- Do not use `localStorage` as a source of truth.
- A live run always owns a frozen question snapshot.

## Visual rules

- No emojis as interface icons. Use Lucide or an established SVG set.
- No AI-generated logos, mascots, or illustrations.
- No animated gradient text, glassmorphism, neon, or particle backgrounds.
- No purple-to-pink gradients and no gradients on buttons.
- No confetti after submission.
- No background blur except a modal overlay.
- No dark mode in v1. Finish the light interface first.
- Color must communicate a state or a fact, not decorate empty space.
- Keep radii small, shadows quiet, and number columns tabular.

## Motion

- Motion must communicate a state change.
- UI transitions finish within 200 ms except the deliberate delete dissolve.
- Use `cubic-bezier(.2,.7,.3,1)`.
- Preserve `prefers-reduced-motion` behavior.

## Accessibility definition of done

- The full assessment is operable by keyboard.
- Focus is visible and not hidden behind sticky controls.
- Every control has an accessible name.
- Validation uses `aria-invalid` and an announced concrete message.
- The timer uses `role="timer"` with `aria-live="off"`; only the 5-minute and 1-minute thresholds are announced.
- Drag interactions always have a button or keyboard alternative.
- Test at 200% zoom and with reduced motion before merging.

## Pull request checks

Run `npm run check`, `npm test`, and `npm run build`. Any change to student serialization or grading needs a focused unit test. Any major interface change needs keyboard and browser verification.
