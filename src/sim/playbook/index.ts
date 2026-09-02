// Playbooks: a bot's decisions as data (docs/design/bots.md, ADR 0013).

export { IDLE_ID, type PlayTrace, playbookPolicy, REFLEX_IDS } from './interpreter';
export {
  type ActiveKit,
  DAMAGE_BUILD,
  DEFAULT_SKILLS,
  type KitStep,
  MAGIC_BUILD,
  MAX_BUILD,
  nextKitStep,
  resolveKit,
  roleBuild,
  SHELL_BUILD,
} from './kit';
export { applyPatch, applyPatchOp, isPatchOp, type PatchOp, type PatchResult } from './patch';
export { PlayLedger, type PlayReport, type PlayStats, type UnitPlayReport } from './report';
export type {
  Behavior,
  KitDef,
  KitVariant,
  LaneId,
  PlaybookDef,
  PlayDef,
  SkillKey,
  Stance,
  TargetRule,
  Trigger,
} from './types';
export { PLAYBOOK_FORMAT_VERSION } from './types';
export { MAX_PLAYS, MAX_VARIANTS, type PlaybookValidation, validatePlaybook } from './validate';
