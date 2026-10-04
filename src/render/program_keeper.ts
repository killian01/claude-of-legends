// Shader programs kept for the renderer's life. Three counts a program's
// users and deletes it the moment the last material drawing with it is
// disposed (WebGLPrograms.releaseProgram), so an effect that clones its
// materials for each cast and disposes them after (vfx/timed.ts, a cache's
// burst, a damage number) links the very same program again on its next
// cast. Measured on the planet on a phone profile: nine creations in ten
// were such relinks, each a stall of up to seconds in the middle of a
// fight. The keeper holds one more use of every program the renderer has
// linked, so a program, once linked, stays until the renderer goes: each
// material setup compiles once per match.
//
// A hand-written shader's program is left alone: its key carries the ids
// of its source stages, which three hands out anew once a stage's last
// material goes, so a kept one would never be asked for again.

// What the keeper reads of a three WebGLProgram.
export interface KeepableProgram {
  usedTimes: number;
  readonly type?: string;
}

// More distinct programs than any match draws: a bound, should a material
// ever carry a key of its own per instance.
const MAX_KEPT = 512;

export class ProgramKeeper {
  private readonly kept = new WeakSet<KeepableProgram>();
  private count = 0;

  constructor(private readonly max = MAX_KEPT) {}

  // Holds every program in the list not held yet; the renderer's list
  // (gl.info.programs), after a draw or a compile. Cheap to run every
  // frame. Returns how many it took hold of.
  keep(programs: readonly KeepableProgram[]): number {
    let took = 0;
    for (const program of programs) {
      if (this.count >= this.max) break;
      if (this.kept.has(program)) continue;
      if (program.type === 'ShaderMaterial' || program.type === 'RawShaderMaterial') continue;
      program.usedTimes++;
      this.kept.add(program);
      this.count++;
      took++;
    }
    return took;
  }

  // How many programs are held.
  get size(): number {
    return this.count;
  }
}
