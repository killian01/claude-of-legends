// What is left of a champion, and what finishing it will cost.
//
// The Forge is a pipeline of steps spread over three tabs, each with its
// own panel and its own price, and a creator coming back the next day
// had nothing that said where they were (playtest: the champion that
// took two days). This is that one line: every step in creation order,
// done or not, optional or not, and the embers still to spend.
//
// Pure reading, no DOM: the panel below renders it, and a test pins it.

export interface ProgressInput {
  // Chosen art, by kind: 'splash', 'sheet', 'weapon', 'icon_Q'...
  chosen: (kind: string) => boolean;
  // The row's own assets, as the drafts route reports them.
  model: boolean;
  weapon: boolean;
  clips: boolean;
  sealed: boolean;
  // Whether the kit clears the full validator right now.
  kitValid: boolean;
  // Prices in embers, from the same list the buttons wear.
  price: (act: string) => number;
}

export interface ProgressStep {
  key: string;
  label: string;
  done: boolean;
  // An optional step never blocks the seal and never counts as missing;
  // it still shows, because a creator should know it exists.
  optional: boolean;
  // What this step will cost if it has not happened yet.
  cost: number;
}

export interface Progress {
  steps: readonly ProgressStep[];
  // Steps done over steps that must happen (optional ones excluded).
  done: number;
  total: number;
  // Embers still to spend to reach a sealed champion, optional steps
  // excluded: the number a creator wants before they start.
  remaining: number;
  // The next thing to do, in plain words; null when the champion is
  // sealed and nothing is left.
  next: string | null;
}

// One bake of five clips, priced the way the animate panel prices it.
function bakeCost(price: (act: string) => number): number {
  return price('bakeBase') + 5 * price('bakePerClip');
}

export function championProgress(input: ProgressInput): Progress {
  const { chosen, price } = input;
  const splash = chosen('splash');
  const sheet = chosen('sheet');
  const weaponArt = chosen('weapon');
  // The build carries the rig, and the weapon when one is waiting for it.
  const buildCost =
    price('model') + price('rig') + (weaponArt && !input.weapon ? price('weapon') : 0);
  const steps: ProgressStep[] = [
    { key: 'splash', label: 'Splash art', done: splash, optional: false, cost: price('image') },
    { key: 'sheet', label: 'Model reference', done: sheet, optional: false, cost: price('image') },
    {
      key: 'weapon',
      label: 'Weapon (optional)',
      done: input.weapon,
      optional: true,
      cost: weaponArt ? 0 : price('image'),
    },
    {
      key: 'model',
      label: '3D model, rigged',
      done: input.model,
      optional: false,
      cost: buildCost,
    },
    {
      key: 'clips',
      label: 'Animations',
      done: input.clips,
      optional: false,
      cost: bakeCost(price),
    },
    { key: 'kit', label: 'A kit that validates', done: input.kitValid, optional: false, cost: 0 },
    { key: 'seal', label: 'Sealed', done: input.sealed, optional: false, cost: 0 },
  ];
  const needed = steps.filter((s) => !s.optional);
  const missing = needed.filter((s) => !s.done);
  return {
    steps,
    done: needed.length - missing.length,
    total: needed.length,
    remaining: missing.reduce((sum, s) => sum + s.cost, 0),
    next: missing[0]?.label ?? null,
  };
}
