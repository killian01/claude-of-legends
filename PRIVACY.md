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

## Three cookies

`loc_session`, set when you sign in and cleared when you sign out. It holds
a random session id and nothing else, and it exists so the server knows
which account is talking to it (`server/cookies.ts`, `server/sessions.ts`,
ADR 0006).

`loc_guest`, set when you press Play on the landing without an account. It
holds a random token and nothing else, and it exists so the server knows
which Guest is talking to it: it gives you your seat back if the page
reloads mid-match, and your line of the ladder when you come back. It lasts
a year, and is set again each time you press Play. Until you score a point
or choose a name for the ladder, the server keeps what it points at, a
handed-out name like `Wanderer 4821`, in memory only, for a day after you
last used it, and a restart forgets it. Once you do, the server keeps, on
disk in `guests.json`: the name, your points, a SHA-256 hash of the token
(never the token itself, so the file cannot be used to play as you), and
when it was made and last seen. Nothing else, and for a year after you were
last seen. Making an account in the same browser moves the points onto it
and deletes that record (`server/guests.ts`, ADR 0024, ADR 0027).

`col_visit`, set on your first page here. It holds one random number, 32
characters, minted on the server and meaning nothing anywhere else. Its
whole purpose is to tell a browser coming back from one arriving for the
first time, because the counter's own way of recognising a browser is a
hash that is thrown away and remade every month (below), which leaves the
one question worth asking, does anybody come back, with no answer past four
weeks. It lasts thirteen months, it is never read by anything but the
audience counter, it is never sent anywhere off this machine, and it is not
attached to your account even when you have one
(`server/visit_cookie.ts`).

That is the whole bargain this site takes: first party, this site only,
audience measurement and nothing else, nothing shared with anybody, an
opt-out that works, and a life capped at thirteen months. No consent banner
is asked for on that basis.

## Nothing else stored, and the way out

`?stats=off` opens the site once and this browser is out for good: nothing
is counted for it on any day. The choice is kept in two places so that
neither can quietly lose it, the `col_visit` cookie, which then holds the
word `off` instead of a number and no longer identifies anything, and the
`umami.disabled` key in your browser's storage, which the tracker checks
before it sends anything (`src/net/stats.ts`). `?stats=on` undoes both, and
mints a new number, since the old one was given up.

Earlier builds kept one line under `col.visit`, a date and at most two
words. This one deletes it on sight, and a browser that had asked out under
the old name is put on the new one.

## What an account holds

Your name, a scrypt hash of your password, your rating and match counts,
your points on the ladder, and when you signed up and were last seen
(`server/accounts.ts`).

Optionally, if you gave them: an email address, kept so a forgotten
password can be recovered, and the id of the Discord account that signs you
in (ADR 0009). Neither is required to play.

What leaves the server to another player is a strict subset: id, name,
signup date, rating, rated games. The password hash, the email and the
Discord link are absent from it by construction rather than by deletion,
and `tests/architecture.test.ts` fails if that ever stops being true. The
ladder of every human, which anyone can read on the landing, shows a name,
its points and whether it is a Guest's or an account's, and no id
(`server/points_ladder.ts`).

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
  (the match had a winner) or `left` (you walked out, or closed the page,
  before one), carrying how many minutes it had run and whether it was
  practice, an online 5v5, or a battle royale (and then which rule set,
  Respawn or One life).
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

## What a practice match sends

A practice match runs in your browser against the house bots; the server
never sees it played. When it ends, or when you leave it, your browser sends
the server one thing (`/api/practice/report`, `src/net/practice_report.ts`):
the scoreboard. The ten champions, their team, level, kills, deaths,
assists, minions and items, which seat was yours, whether you won, lost or
left, how many minutes it ran, whether it was played by touch, and whether
an account was signed in. No name, no account id, no address: the line
lands in a file on this machine (`practice.jsonl`) with the time it arrived
and nothing else, read by the maintainer with `scripts/practice.mjs`, and it
exists so the bots can be tuned to the strength of the people who meet them
first.

## What an online match notes about your seat

When you leave a match played on the server, or it ends, the server writes
one line about the seat you held (`src/net/protocol.ts`, `server/seat_report.ts`):
how long you held it, how long the match took to load in your browser, how
many orders you gave and when the first one came, how far your champion
walked, the points it banked, its level, kills, deaths, assists and
minions, how the seat ended (the menu, a closed tab, the inactivity rule, or
the match's end), which of the first steps you did in that match and
whether you hid them (`src/ui/first_steps.ts`), whether it was a Guest's,
the round trip between your
browser and the server as the game measured it (a small message the server
sends every five seconds and the page answers), how many frames a second
the page drew and how finely it drew them (the same answer carries it: the
step it stood on in its quality ladder and the deepest it went, the size
of the picture in pixels, how many pixels it drew for each one of the
page's, whether it drew shadows, and whether it smoothed edges and let
spells light the ground; never the name of your graphics card), when the
seat's first moments came (the first blow your champion gave and took, its
first takedown, its first fall, the first cache it opened, in seconds from
the seat's start), the country Cloudflare names for the connection, and
whether your browser says it is a phone. No name, no account id, no
address. The line lands in a file on this machine (`seats.jsonl`) with the
time it was written, read by the maintainer with `scripts/seat_report.mjs`,
and it exists to tell a slow connection or a slow load from a match that
gave a newcomer nothing to do. The country is the coarsest place there is,
and it is only ever read beside the round trip it explains.

Your browser also keeps, in its own storage and for itself alone, how
finely its last match of each kind was drawn and the rate your screen
refreshes at, one line under `col.quality` (`src/game/quality_memory.ts`),
so that a slow machine's next match starts at the step that suited it
rather than relearning it. It is never sent anywhere; the step the match
stands on is what the seat line above carries.

## What you write in the feedback box

At the end of a match, and in the pause menu, there is a box that asks what
to improve. It is the only place on this site where you write something
that is kept, and it is entirely optional: leaving it alone sends nothing.

What is sent when you press Send (`/api/feedback`,
`src/ui/feedback_box.ts`): the words you typed, at most a thousand
characters, and the shape of the match you wrote them in, which is practice
or online, how many minutes it had run, whether it had a winner, and
whether an account was signed in. No name, no account id, no address. The
line lands in a file on this machine (`feedback.jsonl`) with the time it
arrived, and it is read by the maintainer with `scripts/feedback.mjs`.

So do not put anything in it you would not hand to a stranger: it is a
message to one person, not a private channel, and there is no way to take
it back afterwards. If you want an answer, the Discord is the place.

## What is not counted

No clicks beyond the five events above, no session recordings, no heat
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

Two things are dropped before a line is written. The cookies, all of them,
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
record, or a Guest's line in `guests.json`, is the whole of what is held
about you. Open an issue, say hello on
[Discord](https://discord.gg/uURYY5qYJE), or write to the address in
`SECURITY.md` if it is sensitive.

## Self-hosting

If you run your own instance, all of the above describes your server and
your players, not this one. The counter is optional: with
`STATS_WEBSITE_ID` unset the page goes out without its tag and nothing is
counted, and with the `stats` profile off in `.env` the counter is not even
running (`docs/deploy.md`, "The audience counter").
