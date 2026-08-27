// Shared champion art helpers for the pre-game screens: the role color
// table and the portrait resolution chain, used by the menu screens and the
// full-page roster browser.

import { cinematicPortraitUrl } from '../render/champions';
import { championPortraitUrl } from '../render/portraits';
import type { ChampionRole } from '../sim/content/champions';

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

// Champion art resolution chain, best first: a hand-authored illustration in
// public/portraits/ (see docs/design/portrait-prompts.md), then the
// cinematic 3D render, and the instant procedural figure while both load.
export function setPortrait(img: HTMLImageElement, championId: string, teamColor: number): void {
  img.src = championPortraitUrl(championId, 0, teamColor);
  const illustration = `/portraits/${championId}.png`;
  const probe = new Image();
  probe.onload = () => {
    img.src = illustration;
  };
  probe.onerror = () => {
    void cinematicPortraitUrl(championId, 0, teamColor).then((url) => {
      if (url) img.src = url;
    });
  };
  probe.src = illustration;
}
