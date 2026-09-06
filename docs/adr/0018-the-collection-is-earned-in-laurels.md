# The collection is earned in laurels, and embers are never played for

Everything the game ships is available in the first match. A new account picks from all ten
champions the moment it signs in, so nothing a person does over a hundred matches changes
what they can do in the next one. The two progressions that exist, a rating and the cosmetic
mastery rank, are both readings of the past rather than something to spend, and neither is a
choice the player makes.

The obvious unit to earn is already spoken for. One ember is one cent of what the server
spends at a provider (ADR 0017), so paying embers for a match is paying the maintainer's
provider bill for a match, at a rate the maintainer does not set. The bots make that fatal
rather than merely expensive: an account fields bots that take live seats and play Arena
rounds with nobody present (ADR 0013, ADR 0016), so any per-match grant is farmable overnight
by a playbook, and what it farms is a 3D reconstruction somebody else pays for.

So a second unit, and one line between the two: the marginal cost. Whatever the server pays a
provider for is priced in embers, granted weekly, and never earned. Whatever costs nothing to
hand out is priced in laurels, earned by playing, and never bought. The two never convert in
either direction, which is the whole point, because an economy where playtime reaches the
provider bill has no ceiling. The laurel's first and only sink is the roster itself, since it
is the one thing the game can sell that is already written: ten champions, no new art, no new
content, one list per account.

What an account may pick is its collection: four champions to begin with, six to recruit. The
four are Torv, Fenn, Ashvyn and Sylra, so a fresh account holds a frontline, an assassin, a
marksman and the mage the matchmaker already falls back to (`DEFAULT_CHAMPION_ID`), which
keeps that fallback on something every account owns. None of the four has the top lane as its
home, and `src/sim/lanes.ts` resolves that by spilling the second mid into top, so a team of
fresh accounts plays two of its five seats off role and the first thing a new account wants is
a top laner. That is the shop's first lesson rather than a defect.

Prices are a table, per champion, edited by hand in either direction, with no formula behind
them. Korrath and Vesk cost 800 because they arrive with their own models while the other
eight wear shared CC0 pack assets (`src/render/champions/manifest.ts`); the four others cost
500. Rejected: a price read off the render manifest, because finishing a model would then
raise the price of a champion somebody is saving for; a price by rank of purchase, because it
makes a champion's price a property of the buyer rather than of the champion; and a price by
release date, because the ten shipped on the same day, so at launch it prices nothing at all.

The wall bites wherever the server decides a match, and only there. The offline practice match
stays open to the whole roster, because it has no account to ask and because trying a kit
before buying it has to be possible somewhere. An account's bot fields only its owner's
collection: ADR 0016 makes a bot its own rated subject and could argue for its own champion,
but a rule that can be walked around through the Academy is not a rule. The price of that is
named here so it can be revisited: the Arena ladder becomes partly a question of what an owner
has bought.

The rotation is not a courtesy. The no-duplicates rule inside a team, plus a starter set that
is identical for everyone, means five fresh accounts on one side cannot field five distinct
champions they own, and the fallback in `server/matchmaker.ts` would hand the fifth a champion
it does not have. Three champions a week, the same three for everyone, derived from the week
index with no stored state and no scheduler, exactly as the ember grant is taken lazily (ADR
0011), hold every account's pickable set at seven and make that case impossible.

The numbers are a pacing choice and not a measurement, which is what separates this table from
the ember one. Sixty laurels for a finished match, a hundred and fifty for a win, two hundred
more on the first win of the day, on the hand and forge ways only (`server/ways.ts` already
answers exactly that question). Six champions at 3600 in all is about thirty matches for the
whole roster: soon enough that the first purchase lands in the first evening, slow enough that
the last one is a goal. The fixed part is deliberately the small one, because it is the part
an idle player collects.

## Consequences

- `CONTEXT.md` gains Collection, Rotation and Laurel before any code (ADR 0004), and Roster
  keeps its meaning: the ten the game ships, never what an account holds.
- `server/laurels.ts` is the table, the twin of `server/embers.ts`, in the same place for the
  same reason. No price enters `src/sim/`: a price never reaches a match.
- The account gains a balance and a collection, an integer and a list, in the JSON store (ADR
  0006). No ledger: the ember ledger exists because a paid act can fail halfway and must be
  refunded, and a purchase cannot.
- `server/matchmaker.ts` checks the pick, and its fallback draws from the client's own
  pickable set instead of `CHAMPION_LIST`; the resolver seam `resolveBot` and `resolveForged`
  already use is where it plugs in. A test pins the floor: no account is ever left with
  nothing it may pick.
- The Academy refuses a bot on a champion outside its owner's collection.
- Forged champions stay outside all of it: they are not roster champions, they remain Forge
  queue only, and the Gallery's free test drive is untouched.
- The 29 standing accounts start at the four and are credited what their recorded matches
  would have earned, read from `matches.jsonl`.
- `docs/design/game-definition.md` stops implying the ten are available from the first match,
  in the change that ships this.
