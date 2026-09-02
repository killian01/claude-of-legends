// Playbooks: a bot's decisions as data (docs/design/bots.md, ADR 0013).

export { IDLE_ID, type PlayTrace, playbookPolicy, REFLEX_IDS } from './interpreter';
export { applyPatch, applyPatchOp, isPatchOp, type PatchOp, type PatchResult } from './patch';
export { PlayLedger, type PlayReport, type PlayStats, type UnitPlayReport } from './report';
export type { Behavior, LaneId, PlaybookDef, PlayDef, Trigger } from './types';
export { PLAYBOOK_FORMAT_VERSION } from './types';
export { MAX_PLAYS, type PlaybookValidation, validatePlaybook } from './validate';
