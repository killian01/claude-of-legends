# Privacy

This is the whole of it. Every claim below points at the file that makes
it true, because on an open repository a privacy page is checkable and one
that is merely reassuring is worth nothing.

## No third party sees you

The site loads no analytics service, no advertising pixel, no tag manager,
no font or script from anyone else's server. Nothing about your visit is
sent anywhere but to the machine serving the game. There is nothing to opt
out of because there is nobody else in the room.

## One cookie

`loc_session`, set when you sign in and cleared when you sign out. It holds
a random session id and nothing else, and it exists so the server knows
which account is talking to it (`server/cookies.ts`, `server/sessions.ts`,
ADR 0006). There is no tracking cookie, because there is nothing to track
with it.

## What an account holds

Your name, a scrypt hash of your password, your rating and match counts,
and when you signed up and were last seen (`server/accounts.ts`).

Optionally, if you gave them: an email address, kept so a forgotten
password can be recovered, and the id of the Discord account that signs you
in (ADR 0009). Neither is required to play.

What leaves the server to another player is a strict subset: id, name,
signup date, rating, rated games. The password hash, the email and the
Discord link are absent from it by construction rather than by deletion,
and `tests/architecture.test.ts` fails if that ever stops being true.

## What is counted

Five numbers a day, for the whole site, so that an announcement can be told
apart from a front page that loses people (`server/pulse.ts`):

| Counter | What it counts |
|---|---|
| `loads` | pages served, reloads included |
| `visitors` | distinct arrivals that day |
| `accounts` | accounts created |
| `matches` | matches started |
| `finished` | matches that reached an end |

Plus `restarts`, which says how many times the server restarted that day,
because a restart makes `visitors` count returning people twice.

That is the entire record: one row per day, six integers, no name, no
account id, no page, no referrer, no country, no device. Nothing in it can
be traced to a person, including by us, because nothing per person is ever
written.

Telling one arrival from another does need to recognise the same visitor
twice within a day. The network address is hashed with a salt that is
random per day, held only in memory, and written nowhere. At midnight UTC
the salt is discarded along with the set, which makes that day's hashes
unreproducible even to the server that made them: the counts survive, the
ability to ask whether a given person was here does not.

## What is not counted

No page views, no clicks, no session recordings, no heat maps, no
fingerprinting, no cross-site anything, no profile, no export to anyone.

## Logs

The server prints operational lines to its log: matches starting and
ending, errors, and refusals such as a rate limit. Web server access logs
in front of it record request lines and addresses in the ordinary way, for
as long as that server keeps them. Neither is joined to an account and
neither feeds the counters above.

## Getting your data out, or deleted

Ask. There is one maintainer and a small number of files; the account
record is the whole of what is held about you. Open an issue, say hello on
[Discord](https://discord.gg/uURYY5qYJE), or write to the address in
`SECURITY.md` if it is sensitive.

## Self-hosting

If you run your own instance, all of the above describes your server and
your players, not this one. `PULSE_TOKEN` gates the report; leave it unset
and the endpoint answers 404 to everyone. The counters run either way and
land in `DATA_DIR/pulse.json`, which you can simply delete.
