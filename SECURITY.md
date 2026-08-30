# Security Policy

We take the security of Claude of Legends seriously: people trust the server
with an account name, a password, and an email address, and self-hosters trust
the defaults.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues
or pull requests.** Public disclosure before a fix is available puts players
and self-hosters at risk.

Instead, use GitHub's private reporting: **Security > Report a vulnerability**
on this repository (or the "Report a vulnerability" link on the Security tab).
It reaches the maintainer directly and keeps the report private until a fix is
out.

Please include as much as you can:

- What the issue is and the impact you think it has.
- Steps to reproduce, or a proof of concept.
- The affected area and any relevant version or commit.

### Areas we care most about

- Accounts: registration, sign-in, password reset, session tokens, and the
  email confirmation flow (ADR 0006, ADR 0007).
- Server authority: anything that lets a client decide an outcome the server
  owns, see state outside its team's vision, or bypass the decision budget
  (ADR 0003 promises the same limits for every participant, human or bot).
- The wire protocol and the headless environment boundary.
- Self-hosting defaults that would leave someone else's server exposed
  (`TRUST_PROXY`, `ALLOWED_ORIGINS`, the data directory).

## What to expect

- An acknowledgment as quickly as possible, normally within a few days.
- Updates as the report is investigated and fixed.
- Credit for the discovery once a fix ships, unless you prefer to stay
  anonymous.

We ask that you give a reasonable amount of time for a fix before any public
disclosure, and that you avoid accessing or modifying other people's data,
degrading the service, or testing against the live server without permission.

## Supported versions

Claude of Legends is pre-1.0 and under active development. Fixes land on
`main` and ship with the next tag; only the latest release is supported. If
you self-host, please keep your server up to date.
