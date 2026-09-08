# The browser history mirrors the layer stack

The client is one page. Every screen is a DOM swap over the same document: the landing, the
home, a section under its bar, a drawer, the queue card, champion select, the match, a
replay. That was a deliberate choice (no reload between matches; the menu and a rematch are
one click) and none of it ever touched the browser's history. So the one navigation control
every visitor already has, Back, meant "leave the site": from inside the ladder, from a
lobby, from a match with four other people in it. A reload or a closed tab dropped a match
just as silently. On a phone, where Back is a gesture, the game was one swipe from gone.

## Decision

The browser's history is a mirror of the screens the app has open, and nothing else. The
module is `src/game/nav.ts`; every screen that opens over another goes through it.

- **A layer is anything that opens over what was there and closes back to it**: a section of
  the home, a drawer, the bot sheet over the ladder, the workshop over the Forge, the record
  over a bot's page in the Academy, a notice, champion select, an online session from its
  queue or lobby to its end screen, a match, a replay, a spectated match. The page under all
  of them (the landing signed out, the home signed in) is the root, and is not a layer.
- **Each open layer owns one history entry above the root's**, in stack order, and the
  entry's state records the layer's depth. A Back pop names a depth; the layers above it
  close, top first. A jump further down the history menu closes as many as it names.
  Forward into an entry whose layer is gone snaps back: there is nothing to show there.
- **A layer that closes on its own says so** (`Frame.closed()`), from its Back button, its
  Escape, its scrim, its Lock in. The nav walks the history back to match, so a dead entry
  is never left for the browser's Back to eat. Whatever was stacked above it is closed by
  the nav, top first, since nobody else will.
- **Switching sections swaps the one entry** (`replace`) rather than closing one layer and
  pushing the next, so one Back from any section is the tiles.
- **A guarded layer refuses Back**: the layers above it still close, it stays, its entry is
  put back, and it is told. The match uses this to open its pause menu, where Leave match is
  the deliberate way out; Back again resumes. An online session is guarded from the moment
  champion select starts, since the team's clock is running and a seat is held, and Back
  does nothing there. The end screen lifts the guard: Back is then Return to menu, like the
  button. While anything is guarded, the page asks before a reload or a closed tab, with the
  browser's own dialog, which is the only prompt a page may put there.
- **Only the sections carry an address** (`#ladder`, `#academy`, `#forge`, `#gallery`,
  `#champions`), so a reload lands back in the section and a section can be linked to. A
  drawer, a card or a match keeps the address it was opened on: none of them can be
  restored from a URL, and a URL that pretended otherwise would lie after a reload.
- **The core is pure.** `createNav` is handed a history-shaped object and told about pops;
  `tests/nav.test.ts` drives it under Node with a fake history whose traversals land later,
  the way a browser's do. `installNav` is the window glue, made once at boot, and
  `appNav()` is how a screen reaches it. `scripts/e2e_nav.mjs` presses the real Back in
  headless Chrome.

Not chosen: making every screen a URL route. The app's flow is a loop in `src/main.ts`
(home, one match, back) with a promise per screen, and a router that could rebuild a lobby
or a match from an address would have to replace that loop for a reload story that does not
exist: a queue cannot be rejoined by address, and a match is rejoined through Play online,
which already works. Addresses for the five sections are the whole of what a URL can
honestly restore here, and they came almost for free.

## Consequences

- Back, from anywhere in the app, closes the thing that is open. From the root, with
  nothing open, it leaves the site, as it should.
- A match cannot be left by accident. Back opens the pause menu, a reload or a closed tab
  asks first, and Leave match remains the one deliberate exit. The `Leave match` button
  itself did not change: it already sits behind Escape.
- The practice select has a way out now. Before this it could only be locked in or the
  page reloaded; leaving it without a pick returns to the page it opened from.
- A new screen that opens over another is a layer: it pushes a frame when it opens, calls
  `closed()` on its own way out, and guards itself while leaving would cost something. The
  section host, the drawer and the notice do this once for everything that uses them.
- After a reload the entries the page had before it are dead, and Back into one loads the
  page into what that entry names. This is the ordinary shape of a one-page app and is why
  the sections carry addresses: a reload on `#ladder` and a Back land on the ladder and the
  home, in that order, rather than twice on the home.
- The e2e scripts drive the app through its buttons, as before; none of them needed to
  change. What they key on (`.pg.home`, `.hud`, the button labels) is not history state.
