// The two drawers the home's bar opens (ui/side_drawer.ts): the account's
// own sheet behind its name, and the live matches behind Live.
//
// The account sheet is everything the old Ladder, Career and Settings
// cards held, in one place: the place on every ladder with the way to the
// ladder page, the career, the settings, and the two links that used to
// sit in the nav, Source and Sign out.

import { signOut } from './auth';
import { buildLadderCard } from './ladder_card';
import { buildLivePanel } from './live_panel';
import { el } from './menu';
import { navLink, REPO } from './page';
import { buildProfilePanel } from './profile_panel';
import { buildSettingsPanel } from './settings_panel';
import { type Drawer, drawerSection, openDrawer } from './side_drawer';

export interface AccountDrawerOptions {
  name: string;
  // The ladder page, opened with the drawer already closed under it.
  openLadder: () => void;
}

export function openAccountDrawer(host: HTMLElement, opts: AccountDrawerOptions): Drawer {
  const d = openDrawer(host, opts.name);
  d.body.append(
    drawerSection('Your place'),
    buildLadderCard(() => {
      d.close();
      opts.openLadder();
    }),
    drawerSection('Career'),
    buildProfilePanel(),
    drawerSection('Settings'),
    buildSettingsPanel(),
  );
  const out = el('button', '', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', () => {
    // A reload rather than a route back to the landing page: signing out
    // has to drop every bit of state this session built, and the entry
    // point already shows the landing page when no session answers.
    void signOut().then(() => location.reload());
  });
  d.foot.append(navLink('Source', REPO), out);
  return d;
}

export function openLiveDrawer(host: HTMLElement): Drawer {
  const d = openDrawer(host, 'Live matches');
  d.body.appendChild(buildLivePanel());
  return d;
}
