# The Forge store and the creation economy

The Forge (ADR 0010) brings the first data that is both creative work and paid
generation credit: forged champions, the ledger that meters their 3D generation, and
the jobs that produce their assets. Accounts already exist and are mandatory (ADR
0006), so identity is settled; what this decides is where the Forge's state lives and
how the economy works.

**Store**: SQLite via node:sqlite (no new dependency), one file under DATA_DIR
(`forge.sqlite3`), holding exactly the Forge domain: forged champions (the validated
def as JSON, status, assets, provenance), the credit ledger, and generation jobs.
Everything else stays where it is: accounts, sessions, and the match log remain the
JSON files ADR 0006 chose. Rows reference account ids as plain integers across the
store boundary; generated files (model sheets, GLB models) stay on disk under
DATA_DIR/assets, referenced from the database. We rejected folding the Forge into the
JSON files (relational data: ownership, a ledger, job state, gallery queries to come)
and rejected migrating everything to SQLite now (the accounts stack works and is
deployed; moving it is churn with no Forge payoff, and can happen later if it earns
its keep).

**Economy, ledger-first**: every account receives a weekly allocation of creations
(3, server-configurable), granted lazily, one grant per rolling week wherever the
Forge surfaces, so no scheduler has to survive restarts; unspent creations roll over.
Finalizing a draft debits one creation when the generation job starts, and ANY
failure (technical, or a content block from classification) refunds it. Balances are
never stored, only derived from the append-only ledger. Generation jobs persist in
the store; a job still marked running at boot belonged to a process that died, and
the boot sweep fails it and refunds the creation. No real-money rail exists in v1;
Stripe Checkout plugs into the proven ledger later, once pricing and the Tripo
agreement (ADR 0010 addendum) are settled.

## Consequences

- Per-account quotas (creations now, 2D previews and agent calls in plan phase 8)
  attach to the ledger and the account id, not to browsers or addresses.
- Asset provenance (provider, model version, task id, date) is stored per finalized
  champion, as the ADR 0010 addendum requires.
- Backups gain one file: `forge.sqlite3` beside the JSON files and `assets/` in the
  DATA_DIR volume.
- The access line of docs/design/game-definition.md is updated in the same change:
  the "no database" claim now carves out the Forge.
