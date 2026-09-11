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

## One line of storage

`col.visit`, holding today's date and, at most, two words: `stayed` and
`played`. The browser writes the date on the first load of a day so it
knows not to say hello to the counter twice, and a word when it has
reported getting that far, so it reports it once rather than on every
reload (`src/net/pulse_ping.ts`, `src/net/visit_line.ts`). The whole line
is at most `2026-09-07 stayed played`.

It is not an identifier: it is the same handful of characters in every
browser in the world that did the same things today, it is overwritten
tomorrow, and it never leaves your machine. Delete it and the only
consequence is being counted once more, as a browser that had never been
here.

That last part is the only other thing the line is read for: an empty key
means this browser has not been counted before, which is what separates
people arriving from one person coming back. Nothing is stored to answer
it, and a browser that clears the line is simply new again.

The one other value the key can hold is the word `off`, which is there if
you opened the site with `?pulse=off`. Then nothing is counted for this
browser at all, on any day. `?pulse=on` puts it back.

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

A handful of numbers a day, for the whole site, so that an announcement can
be told apart from a front page that loses people (`server/pulse.ts`):

| Counter | What it counts |
|---|---|
| `loads` | pages served, reloads included |
| `strays` | of those, the ones served for a path this site does not have |
| `visitors` | browsers that opened the game that day, one each |
| `newcomers` | of those, the ones that had never been counted before |
| `sources` | of those, how many arrived from each of nine named places |
| `stayed` | of those, the ones still here 30 seconds later |
| `played` | of those, the ones who started a match in the browser |
| `accounts` | accounts created |
| `matches` | matches started |
| `finished` | matches that reached an end |

Plus `restarts`, which says how many times the server restarted that day.
It distorts nothing; it is there because a quiet afternoon usually has a
deploy under it.

`sources` is the one that needs saying in full. It counts, for the day,
how many visitors arrived from each of nine buckets: `direct` (no referrer
at all), `search`, `discord`, `reddit`, `hn`, `x`, `youtube`, `github`, and
`other` for anywhere else. Your browser reads its own referrer, decides
which bucket it falls in, and sends the name of the bucket
(`src/net/pulse_source.ts`). If the link that brought you carried `?from=`
with one of those nine names, which is how an announcement is posted so
that an app sending no referrer still counts as where it was posted, that
name is the bucket, and any other value there is ignored. The link itself,
the page it was on, and the host it was on never leave your machine, and
the server refuses any word that is not one of those nine.

`stayed` and `played` are the same kind of thing: your browser knows it
has already reported them today because of the line it stores, so each
counts once. `played` covers a practice match, a Forge test drive and a
live game alike, and never a replay, which is watching rather than
playing.

That is the entire record: one row per day, a dozen integers and nine
more, no name, no account id, no page, no URL, no country, no device. Nothing in it can
be traced to a person, including by us, because nothing per person is ever
written.

Telling one arrival from a reload does need to recognise a browser that
has already been here today, and the browser is the only thing that knows.
So it says so itself: on its first load of the day it posts to one open
endpoint that carries no cookie and no body, and remembers the date so it
does not post again (`src/net/pulse_ping.ts`). The request says two things
beyond arriving: `?new=1` when this browser had nothing stored, so it had
not been counted before, and `?from=` with one of the nine bucket names
above. The server learns that a browser arrived, whether it was the first
time, and which sort of place it came from, and nothing whatsoever about
which browser it was.

The address was the obvious way to do this and it is the wrong one, which
is worth saying plainly: it made a phone that renews its IPv6 address
between reloads into a crowd, and it counted every crawler in the world as
a person. What is left of it is a bound, so that a script cannot post that
endpoint in a loop and write its own number onto the report
(`server/visit_guard.ts`). That bound counts how many times a network has
posted today, keyed by a hash of it under a salt that is random per day and
held only in memory. At midnight UTC the salt is discarded along with the
counts, which makes that day's hashes unreproducible even to the server
that made them.

## What is not counted

No page views, no clicks, no session recordings, no heat maps, no
fingerprinting, no cross-site anything, no profile, no export to anyone.

## Logs

The server prints operational lines to its log: matches starting and
ending, errors, and refusals such as a rate limit.

The web server in front of it writes an access log, in the ordinary way
that any web server does: one line per page or API request, holding the
method, the path, the status, your address, the browser and referrer
headers your browser sent, and the routing headers the proxy in front adds
to them. Assets are not logged, so a page load is one line rather than
four hundred. Lines roll off at 20 MiB and about a week, whichever comes
first.

Two things are dropped before a line is written. The session cookie,
because a log that can resume a session is a store of credentials rather
than a log. And the country header the proxy attaches to every request:
this log exists to tell a scanner sweep from an announcement landing, and
where you live is not part of that question.

It exists because the counters above cannot tell a page somebody asked
for from a scanner walking a list of admin panels, and knowing which is
the difference between fixing the front page and fixing nothing. Neither
log is joined to an account, and neither feeds the counters.

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
