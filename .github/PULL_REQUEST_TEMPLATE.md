<!--
Thanks for contributing to Claude of Legends!

New here? Start with the contributing guide:
https://github.com/killian01/claude-of-legends/blob/main/CONTRIBUTING.md

Anything that does not apply to your change, delete or mark as N/A.
-->

## Summary

<!-- What does this PR change, and why? Link the motivating issue or design doc. -->

## Related issues

<!-- e.g. "Closes #123" or "Part of #456". Remove if it does not apply. -->

## Type of change

- [ ] Feature: new functionality
- [ ] Bug fix
- [ ] Balance or content change
- [ ] Refactor or performance (no behavior change)
- [ ] Documentation
- [ ] Tests
- [ ] Build, CI, or tooling

## How was this tested?

<!-- The commands you ran and the manual steps you walked through. -->

- Commands:
- Manual steps:

## Screenshots / recordings

<!--
If this PR changes anything visible in game (HUD, renderer, menus), add
before/after screenshots or a short clip. Remove for non-visual changes.
-->

---

## Checklist

- [ ] `pnpm test`, `pnpm check`, and `pnpm lint` are green locally.
- [ ] Every sim or server behavior change adds or updates a test in this same
      PR (bug fixes reproduce first with a failing test).
- [ ] Determinism holds: no `Math.random`, `Date.now`, or I/O in `src/sim/`;
      all randomness goes through `Rng`.
- [ ] All naming is original English (ADR 0004); any new game term went
      through `CONTEXT.md`.
- [ ] No em dashes, en dashes, or emojis in code, comments, docs, or commits.
- [ ] No secrets or `.env` committed; new assets have a row in `CREDITS.md`.

> Commit messages and PR titles use Conventional Commits with a scope
> (`feat(sim): ...`, `fix(net): ...`).

A green CI run and a filled checklist are what we look for before merging.
Smaller, focused PRs land faster, and reviewers may suggest changes, which is
a normal and friendly part of the process. Thank you!
