# Privacy

This is the whole of it. Every claim below points at the file that makes
it true, because on an open repository a privacy page is checkable and one
that is merely reassuring is worth nothing.

## No third party sees you

The site loads no script, font or pixel from anyone else's server, and no
advertising or tag manager of any kind. It does count its audience, with
Umami, an open source counter that runs on the same machine as the game
and is reached through the game's own address: `server/stats_tag.ts` puts
its tag on the page, `docker-compose.yml` runs it beside the game. Nothing
about your visit is sent anywhere but to that machine, and nothing it
records is sent on to anyone; the counter's own usage report is switched
off. There is nobody else in the room.

## One cookie

`loc_session`, set when you sign in and cleared when you sign out. It holds
a random session id and nothing else, and it exists so the server knows
which account is talking to it (`server/cookies.ts`, `server/sessions.ts`,
ADR 0006). There is no tracking cookie, because there is nothing to track
with it.

## Nothing stored, unless you ask out

The counter sets no cookie and writes nothing to your browser: it tells one
visitor from another by a hash it computes on the server (below), never by
anything it leaves on your machine.

The one key it reads is `umami.disabled`, which is there if you opened the
site with `?stats=off`. Then nothing is counted for this browser at all, on
any day: the tracker checks that key before it sends anything, so the
choice holds without a line of this site's code running
(`src/net/stats.ts`). `?stats=on` removes it.

Earlier builds kept one line under `col.visit`, a date and at most two
words. This one deletes it on sight, and a browser that had asked out under
the old name is put on the new one.

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

What the counter keeps. `src/net/stats.ts` is everything this site adds to
it, and everything it takes away before a record leaves your browser.

- A page view: the path and the section you are looking at (`/`,
  `/#ladder`), and when. Never the query of the address, except the `utm_`
  words an announcement's link carries: an invite code, a confirmation
  flag, anything else in the address is stripped before the view leaves
  (`scrubUrl`), so a link somebody sent you is not in the record.
- The page that linked you here, as your browser reports it in the
  referrer header, which is how a Reddit thread can be told from a search
  result. Its query is stripped the same way.
- Five events, each at most once per page: `stayed` (still here 30
  seconds later), `played` (a match started in this browser: practice, test
  drive or live game, never a replay, which is watching rather than
  playing), `offer` (the account offer at the end of a practice match,
  taken), `form` (the register tab opened) and `account` (an account
  created here). And one when a match ends for this browser: `finished`
  (the match had a winner) or `left` (you walked out before one), carrying
  how many minutes it had run and whether it was practice or online.
  Nothing about who won or what you played.
- What every counter of this kind reads off the request: the browser and
  operating system, the kind of device, the screen size, the language, and
  the country, region and city your address resolves to. Not the address.

What ties one view to the next is a visitor id that Umami computes from
your address and your browser's identification string under a salt that
changes with the month. The id is what is stored; the address is not, the
id cannot be turned back into it, and next month the same browser is a new
visitor. No name and no account id go anywhere near it: the counter does
not know the game has accounts.

The record is a database on this machine, read by the maintainer and by
nobody else, and it exists so that an announcement can be told apart from a
front page that loses people.

## What is not counted

No clicks beyond the three events above, no session recordings, no heat
maps, no fingerprinting, no cross-site anything, no profile, no export to
anyone, and nothing that follows a browser from one month into the next.

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

It exists because a scanner walking a list of admin panels never runs the
page, so the counter above never sees it, and knowing whether a quiet day
was quiet or swept is the difference between fixing the front page and
fixing nothing. Neither log is joined to an account, and neither feeds the
counter.

## Getting your data out, or deleted

Ask. There is one maintainer and a small number of files; the account
record is the whole of what is held about you. Open an issue, say hello on
[Discord](https://discord.gg/uURYY5qYJE), or write to the address in
`SECURITY.md` if it is sensitive.

## Self-hosting

If you run your own instance, all of the above describes your server and
your players, not this one. The counter is optional: with
`STATS_WEBSITE_ID` unset the page goes out without its tag and nothing is
counted, and with the `stats` profile off in `.env` the counter is not even
running (`docs/deploy.md`, "The audience counter").
