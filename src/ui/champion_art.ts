// Shared champion art helpers for the pre-game screens: the role color
// table and the portrait resolution chain, used by the menu screens and the
// full-page roster browser.

import { versioned } from '../game/asset_version';
import { cinematicPortraitUrl } from '../render/champions';
import { championPortraitUrl } from '../render/portraits';
import { CHAMPION_LIST, type ChampionRole } from '../sim/content/champions';

// One color per role so classes read at a glance on the select grid.
export const ROLE_COLORS: Readonly<Record<ChampionRole, string>> = {
  Tank: '#8fb3d9',
  Fighter: '#d9925a',
  Mage: '#a67ee8',
  Battlemage: '#c96fc0',
  Assassin: '#e86a6a',
  Marksman: '#e8c862',
  Support: '#6fd9a8',
  Skirmisher: '#d9d15a',
};

function illustrationUrl(championId: string): string {
  return versioned(`/portraits/${championId}.webp`);
}

// Champion art resolution chain, best first: the hand-authored illustration
// in public/portraits/ (see docs/design/portrait-prompts.md), and only
// where there is none the cinematic 3D render, with the procedural figure
// while that renders. The illustration goes straight onto the card and
// fades in when it lands; until then the card's own backdrop shows. The
// figure used to stand in for every card while the illustration loaded,
// and on a slow connection a player saw the old cards come up before the
// new ones.
export function setPortrait(img: HTMLImageElement, championId: string, teamColor: number): void {
  img.style.opacity = '0';
  img.style.transition = 'opacity 0.25s ease';
  img.onload = () => {
    img.style.opacity = '1';
  };
  img.onerror = () => {
    img.onerror = null;
    img.src = championPortraitUrl(championId, 0, teamColor);
    void cinematicPortraitUrl(championId, 0, teamColor).then((url) => {
      if (url) img.src = url;
    });
  };
  img.src = illustrationUrl(championId);
}

// Fetches the roster's illustrations once per page, so the select screen
// opens with them already in the cache rather than filling in card by
// card. Called when the page is up; the images are kept so the browser
// never drops the requests.
const warmed: HTMLImageElement[] = [];
export function warmChampionArt(): void {
  if (warmed.length > 0) return;
  for (const c of CHAMPION_LIST) {
    const img = new Image();
    img.decoding = 'async';
    img.src = illustrationUrl(c.id);
    warmed.push(img);
  }
}
