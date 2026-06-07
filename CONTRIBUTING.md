# Contributing to Resonance

Thanks for your interest. A few ground rules keep this codebase coherent:

## Code rules

All coding conventions — hexagonal boundaries, the no-inline-tunables rule,
TypeScript strictness, what must never be imported where — live in
[`AGENTS.md`](AGENTS.md). Read it before changing anything; it is the single
source of truth for both humans and AI coding agents, and PRs that violate
it will be asked to conform.

## Getting oriented

- [`docs/GUIDE.md`](docs/GUIDE.md) — front-to-back walkthrough (start here)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layering and the two AI surfaces
- [`docs/STATUS.md`](docs/STATUS.md) — what is wired vs. stubbed

Run `npm run typecheck && npm test` before opening a PR.

## Security issues

Do **not** open a public issue for a vulnerability. See
[`SECURITY.md`](SECURITY.md) for the threat model and report privately via
GitHub's security advisory feature on this repository.

## Licensing of contributions

By submitting a contribution you certify the
[Developer Certificate of Origin](https://developercertificate.org/) — that
you have the right to submit the work — and you agree that your contribution
is licensed under the repository's [Apache-2.0 license](LICENSE).
