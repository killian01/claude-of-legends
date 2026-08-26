#!/usr/bin/env bash
# QA stop-gate for Claude of Legends, adapted from world-of-claudecraft.
#
# Runs at the end of EVERY Claude Code turn (the Stop hook). It does only instant,
# near-zero-cost checks on the working tree's uncommitted added lines (tracked diff
# against HEAD plus untracked text files), so it never slows the edit loop. It NEVER
# runs tsc, vitest, or biome; those run in the test suite and CI.
#
# What it blocks on (hard invariants from CLAUDE.md, all detectable instantly):
#   - em dash, en dash, or emoji anywhere in code, comments, or docs;
#   - a stray ".only(" in a test, which silently disables the rest of that suite;
#   - a leftover "debugger" statement;
#   - a Math.random / Date.now / performance.now call added under src/sim/ (the
#     determinism invariant; tests/architecture.test.ts is the deep guard, this is
#     the instant tripwire; lines that START as comments are skipped).
# On a hit it asks Claude to fix those exact lines before finishing. Otherwise silent.
#
# Checked in and runs on every contributor's machine. Small, dependency-light
# (bash + git + perl), reads only git output and stdin, writes nothing, no network.
set -uo pipefail

input=$(cat)

# Loop guard: if we already blocked once this turn, let Claude finish.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Added lines in this working tree. Third-party agent skills under .claude/skills
# legitimately contain emojis and dashes; lockfiles are generated.
pathspec=(
  .
  ':(exclude).claude/skills'
  ':(exclude)*.lock'
  ':(exclude)pnpm-lock.yaml'
  ':(exclude)package-lock.json'
)

# Tracked modifications plus untracked, non-ignored files synthesized as all-added,
# limited to text extensions to skip binaries.
stream=$(
  git diff HEAD -U0 --no-color -- "${pathspec[@]}" 2>/dev/null
  git ls-files --others --exclude-standard -- "${pathspec[@]}" 2>/dev/null \
    | grep -Ei '\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|css|html|ya?ml|sh|toml|txt)$' \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        printf '+++ b/%s\n' "$f"
        sed 's/^/+/' "$f" 2>/dev/null
      done
)
[ -n "$stream" ] || exit 0

out=$(printf '%s' "$stream" | perl -CSD -e '
  my @hits; my $file = "";
  while (my $line = <STDIN>) {
    if ($line =~ m{^\+\+\+\s+b/(.+)$}) { $file = $1; $file =~ s/\s+$//; next; }
    next unless $line =~ /^\+/;
    next if $line =~ /^\+\+\+/;
    my $c = substr($line, 1);
    chomp $c;
    my $cat = "";
    if ($c =~ /[\x{2013}\x{2014}\x{2015}]/) {
      $cat = "em or en dash";
    } elsif ($c =~ /[\x{1F000}-\x{1FAFF}\x{1F1E6}-\x{1F1FF}\x{2600}-\x{27BF}\x{FE0F}]/) {
      $cat = "emoji";
    } elsif (($file =~ /\.test\.(ts|tsx|js|mjs|cjs)$/ || $file =~ m{(^|/)tests/})
             && $c =~ /\b(?:it|test|describe|bench|suite)\.only\s*\(/) {
      $cat = "stray .only( disables the suite";
    } elsif ($file =~ /\.(ts|tsx|js|mjs|cjs)$/ && $c =~ /^\s*debugger\s*;?\s*$/) {
      $cat = "leftover debugger";
    } elsif ($file =~ m{^src/sim/.*\.ts$} && $c !~ m{^\s*(?://|\*|/\*)}
             && $c =~ /\b(?:Math\.random|Date\.now|performance\.now)\s*\(/) {
      $cat = "wall-clock or Math.random in sim code (use Rng and sim time)";
    }
    next unless $cat;
    my $snip = $c; $snip =~ s/^\s+//; $snip =~ s/\s+$//; $snip = substr($snip, 0, 80);
    push @hits, "$file [$cat]: $snip";
    last if @hits >= 20;
  }
  exit 0 unless @hits;
  my $n = scalar @hits;
  my $body = "QA stop-gate blocked: $n line(s) this change added violate a hard project invariant. "
    . "Fix every one before finishing (no em dashes, en dashes, or emojis anywhere; no stray .only() that "
    . "disables a test suite; no leftover debugger statement; no Math.random/Date.now/performance.now "
    . "in src/sim, use Rng and sim time):";
  $body .= "\n- $_" for @hits;
  $body =~ s/([\\"])/\\$1/g;
  $body =~ s/([\x00-\x1f])/sprintf("\\u%04x", ord($1))/ge;
  print "{\"decision\":\"block\",\"reason\":\"$body\"}";
')

if [ -n "$out" ]; then
  printf '%s' "$out"
fi
exit 0
