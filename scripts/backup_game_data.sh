#!/usr/bin/env bash
# Snapshot of everything a player would lose if this box died: the account
# file, the two SQLite stores, and the generated art. The volume is the only
# copy in existence (docker-compose.yml calls it out), so this runs from cron
# rather than from memory.
#
# The stores are live while this runs. A plain copy of an open SQLite file is
# a torn file, so the two live databases go through VACUUM INTO, which reads a
# consistent snapshot with the WAL folded in and never blocks a writer. The
# rest of the tree is written atomically (server/store.ts) or never rewritten
# at all, so a plain copy of it is already consistent.
#
#   ./scripts/backup_game_data.sh          one archive, kept locally
# Cron (daily, an hour off the Olympia dump so the two never overlap):
#   0 3 * * * /opt/claude-of-legends/scripts/backup_game_data.sh >> /var/log/col-backup.log 2>&1
set -euo pipefail

VOLUME_DIR="${VOLUME_DIR:-/var/lib/docker/volumes/claude-of-legends_game_data/_data}"
DEST_DIR="${DEST_DIR:-/opt/claude-of-legends-backups}"
NODE="${NODE:-/opt/node22/bin/node}"
KEEP="${KEEP:-7}"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$DEST_DIR/game-data-$STAMP.tgz"
LOG="[$(date '+%Y-%m-%d %H:%M:%S')] col-backup"

[ -d "$VOLUME_DIR" ] || { echo "$LOG: no volume at $VOLUME_DIR" >&2; exit 1; }
mkdir -p "$DEST_DIR"
STAGE=$(mktemp -d)
# Never leave a half-built staging tree behind, whatever goes wrong.
trap 'rm -rf "$STAGE"' EXIT

echo "$LOG: staging from $VOLUME_DIR"

# The live databases, snapshotted. Anything ending .sqlite3 counts; the
# .bak-rename leftovers are dead files and are copied raw below.
for db in "$VOLUME_DIR"/*.sqlite3; do
  [ -e "$db" ] || continue
  name=$(basename "$db")
  "$NODE" "$(dirname "$0")/sqlite_snapshot.mjs" "$db" "$STAGE/$name"
  echo "$LOG: snapshot $name ($(du -h "$STAGE/$name" | cut -f1))"
done

# Everything else verbatim. The live databases are already staged, and their
# -wal/-shm are folded into those snapshots, so all three are skipped here.
tar -C "$VOLUME_DIR" -cf - \
  --exclude='*.sqlite3' --exclude='*.sqlite3-wal' --exclude='*.sqlite3-shm' \
  . | tar -C "$STAGE" -xf -

tar -C "$STAGE" -czf "$ARCHIVE" .
# Player identities and password hashes: readable by root and nobody else.
chmod 600 "$ARCHIVE"
echo "$LOG: wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# An archive that unpacks to nothing is the failure this replaces: the one
# that was sitting in this directory held a single empty directory entry.
ENTRIES=$(tar tzf "$ARCHIVE" | head -200 | wc -l)
if [ "$ENTRIES" -lt 5 ]; then
  echo "$LOG: REFUSED, archive holds $ENTRIES entries" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

# Rotation, newest kept.
ls -1t "$DEST_DIR"/game-data-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
  echo "$LOG: rotated out $(basename "$old")"
done

echo "$LOG: done, $ENTRIES+ entries"
