// The shader programs kept for the renderer's life (src/render/program_keeper.ts):
// a program the keeper holds survives its last material's disposal, so the
// next material of the same setup finds it instead of linking it again; a
// hand-written shader's program is left to three; the hold is bounded. The
// cache below is three's own rule (WebGLPrograms acquireProgram and
// releaseProgram), and the last test pins that three still has it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type KeepableProgram, ProgramKeeper } from '../src/render/program_keeper';

interface Program extends KeepableProgram {
  key: string;
  links: number;
}

// Three's program cache as it counts: a material's setup acquires the
// program of its key (linking one when none is cached), a material's
// disposal releases it, and the last release deletes it.
class ProgramCache {
  readonly programs: Program[] = [];
  links = 0;

  acquire(key: string, type = 'MeshStandardMaterial'): Program {
    const found = this.programs.find((p) => p.key === key);
    if (found) {
      found.usedTimes++;
      return found;
    }
    this.links++;
    const program: Program = { key, type, usedTimes: 1, links: this.links };
    this.programs.push(program);
    return program;
  }

  release(program: Program): void {
    program.usedTimes--;
    if (program.usedTimes === 0) this.programs.splice(this.programs.indexOf(program), 1);
  }
}

describe('the program keeper', () => {
  it('keeps a cast effect from linking its program again on the next cast', () => {
    const cache = new ProgramCache();
    const keeper = new ProgramKeeper();
    // Without the keeper: each cast's own material links, then goes.
    for (let cast = 0; cast < 3; cast++) cache.release(cache.acquire('thorn-impact'));
    expect(cache.links).toBe(3);

    const kept = new ProgramCache();
    for (let cast = 0; cast < 3; cast++) {
      const program = kept.acquire('thorn-impact');
      // The renderer runs the keeper after every draw.
      keeper.keep(kept.programs);
      kept.release(program);
    }
    expect(kept.links).toBe(1);
    expect(kept.programs).toHaveLength(1);
  });

  it('takes hold of each program once, however often it runs', () => {
    const cache = new ProgramCache();
    const keeper = new ProgramKeeper();
    const a = cache.acquire('a');
    const b = cache.acquire('b');
    expect(keeper.keep(cache.programs)).toBe(2);
    expect(keeper.keep(cache.programs)).toBe(0);
    expect(a.usedTimes).toBe(2);
    expect(b.usedTimes).toBe(2);
    expect(keeper.size).toBe(2);
  });

  it('leaves a hand-written shader to three: its key changes once its stages go', () => {
    const cache = new ProgramCache();
    const keeper = new ProgramKeeper();
    const shader = cache.acquire('0,1', 'ShaderMaterial');
    const raw = cache.acquire('2,3', 'RawShaderMaterial');
    expect(keeper.keep(cache.programs)).toBe(0);
    cache.release(shader);
    cache.release(raw);
    expect(cache.programs).toHaveLength(0);
  });

  it('holds no more than its bound', () => {
    const cache = new ProgramCache();
    const keeper = new ProgramKeeper(2);
    for (const key of ['a', 'b', 'c']) cache.acquire(key);
    expect(keeper.keep(cache.programs)).toBe(2);
    expect(keeper.keep(cache.programs)).toBe(0);
    const last = cache.programs[2]!;
    cache.release(last);
    expect(cache.programs).toHaveLength(2);
  });

  it('rests on three still deleting a program at its last release, by usedTimes', () => {
    const programs = readFileSync(
      'node_modules/three/src/renderers/webgl/WebGLPrograms.js',
      'utf8',
    );
    expect(programs).toMatch(/\+\+\s*program\.usedTimes/);
    expect(programs).toMatch(/--\s*program\.usedTimes\s*===\s*0/);
    const program = readFileSync('node_modules/three/src/renderers/webgl/WebGLProgram.js', 'utf8');
    expect(program).toContain('this.usedTimes = 1;');
    expect(program).toContain('this.type = parameters.shaderType;');
    const renderer = readFileSync('node_modules/three/src/renderers/WebGLRenderer.js', 'utf8');
    expect(renderer).toContain('info.programs = programCache.programs;');
  });
});
