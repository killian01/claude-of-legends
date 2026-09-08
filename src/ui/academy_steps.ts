// The Academy's steps (CONTEXT.md: Academy): making a bot in order, one
// thing at a time, each step a page of the same bot. The bot itself, then
// its kit and its playbook with the coach beside both, then sparring, then
// sending it to play. Pure data and pure functions, no DOM, so what each
// step says of a bot is pinned by tests; ui/academy.ts draws them.
//
// The steps are a way through, not a wall: every step is open on a bot
// that exists, and the bar jumps anywhere. Only a bot not made yet has one
// step, the first, since nothing else exists to show.

export type StepId = 'bot' | 'kit' | 'playbook' | 'spar' | 'play';

export interface Step {
  id: StepId;
  label: string;
  // One line under the title: what this step is for.
  lead: string;
}

export const STEPS: readonly Step[] = [
  {
    id: 'bot',
    label: 'The bot',
    lead: 'A name, a champion from your collection, two sigils and a skin.',
  },
  {
    id: 'kit',
    label: 'The kit',
    lead: 'What it works toward: the build it buys, the spell it maxes first, the lane it asks for. The coach can change these too.',
  },
  {
    id: 'playbook',
    label: 'The playbook',
    lead: 'What it does: the plays, top to bottom. The coach edits them from a sentence.',
  },
  {
    id: 'spar',
    label: 'Sparring',
    lead: 'A whole match against house bots, played here in seconds, then its Record and replays.',
  },
  {
    id: 'play',
    label: 'Play',
    lead: 'Rank it for the Arena and the live queue, play now, and read what the night did.',
  },
];

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

export function stepOf(id: StepId): Step {
  return STEPS[stepIndex(id)] ?? STEPS[0]!;
}

export function stepBefore(id: StepId): Step | null {
  const i = stepIndex(id);
  return i > 0 ? (STEPS[i - 1] ?? null) : null;
}

export function stepAfter(id: StepId): Step | null {
  const i = stepIndex(id);
  return i >= 0 && i < STEPS.length - 1 ? (STEPS[i + 1] ?? null) : null;
}

// Which steps a reader may open: every one on a bot that exists, the
// first alone on a bot being made.
export function openSteps(hasBot: boolean): readonly StepId[] {
  return hasBot ? STEPS.map((s) => s.id) : ['bot'];
}

// What is known of a bot, as the bar needs it: enough for one line per
// step and nothing the steps themselves draw.
export interface StepFacts {
  // Null while the bot is being made.
  bot: {
    championName: string;
    sigilNames: readonly string[];
    version: number;
    deposited: boolean;
    tally?: { wins: number; losses: number };
  } | null;
  kit: {
    items: number;
    // The build is the role's default rather than the owner's own.
    roleBuild: boolean;
    variants: number;
  };
  plays: { total: number; off: number };
  // The bot's Record, sparring and series only; null until it is read.
  record: { games: number; wins: number } | null;
  dirty: boolean;
}

function n(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// The line under a step's name. On a bot not made yet only the first step
// has anything to say; the rest wait.
export function stepStatus(id: StepId, f: StepFacts): string {
  if (!f.bot && id !== 'bot') return 'After it is made';
  switch (id) {
    case 'bot':
      if (!f.bot) return 'Not made yet';
      return `${f.bot.championName}, ${f.bot.sigilNames.join(' and ')}, v${f.bot.version}`;
    case 'kit': {
      if (f.kit.items === 0) return 'No build: it buys what its role does';
      const whose = f.kit.roleBuild ? "the role's build" : 'your own build';
      const variants = f.kit.variants > 0 ? `, ${n(f.kit.variants, 'variant')}` : '';
      return `${n(f.kit.items, 'item')}, ${whose}${variants}`;
    }
    case 'playbook': {
      const off = f.plays.off > 0 ? `, ${f.plays.off} off` : '';
      const unsaved = f.dirty ? ', unsaved' : '';
      return `${n(f.plays.total, 'play')}${off}${unsaved}`;
    }
    case 'spar':
      if (f.record === null) return 'Reading the Record';
      if (f.record.games === 0) return 'Not sparred yet';
      return `${n(f.record.games, 'match', 'matches')}, ${f.record.wins} won`;
    case 'play': {
      if (!f.bot?.deposited) return 'Not ranked';
      const t = f.bot.tally;
      return t && t.wins + t.losses > 0 ? `Ranked, ${t.wins}-${t.losses} rated` : 'Ranked';
    }
  }
}

// What each sigil does, in a line, for the step where they are picked
// (src/sim/content/sigils.ts holds the numbers).
export const SIGIL_BLURBS: Readonly<Record<string, string>> = {
  riftstep: 'A short blink, the way out of a fight or into one.',
  zephyr: 'A burst of speed for six seconds, for itself or an ally.',
  mend: 'A heal for itself or the ally beside it, stronger as it levels.',
  sear: 'A burn on an enemy that also blunts their healing for three seconds.',
};
