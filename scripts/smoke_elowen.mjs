// Elowen's own model and mist in the local browser playtest: she levitates
// on her idle, the attack plays its open-hand gesture and the auto leaves
// her hand, each spell plays its own gesture and lands its authored mist
// (the lance in flight, the veil, the step's flash, the whiteout), the
// effect files preloaded so the holders carry their parts.
// Screenshots and a report land under .tmp/elowen-smoke/. Needs the Vite
// client on :5173 (dev-server skill) and Chrome; CHROME overrides the
// executable, CLIENT the origin.
//
//   node scripts/smoke_elowen.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const output = '.tmp/elowen-smoke';
const origin = process.env.CLIENT ?? 'http://localhost:5173';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  timeout: 90000,
  args: ['--no-sandbox', '--window-size=1440,1000'],
});
console.log('Browser ready');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${origin}/map_playtest.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('Page ready');
  await page.select('#champion', 'elowen');
  await page.click('#start');
  await page.waitForFunction(() => window.mapPlaytest, { timeout: 180000 });
  console.log('Playtest ready');
  await page.keyboard.press('p');
  await page.mouse.move(1000, 750);
  await page.evaluate(() => window.mapPlaytest.setPaused(true));
  await page.waitForFunction(
    () => window.mapPlaytest.renderer.championVisuals.has(window.mapPlaytest.selfId),
    { timeout: 30000 },
  );
  await page.evaluate(async () => {
    await (await import('/src/render/vfx/elowen_fx.ts')).preloadElowenEffects();
    const t = window.mapPlaytest;
    const self = t.sim.units.get(t.selfId);
    t.sim.policies.clear();
    self.pos = t.nav.nearestWalkable(61, 63, 8);
    t.renderer.recenterCamera();
    t.renderer.scaleZoom(1.8);
    t.sim.orderStop(self.id);
    self.mana = self.maxMana;
    const target = t.sim.addChampion(1, { x: self.pos.x + 5, z: self.pos.z }, 'torv');
    target.hp = target.maxHp = 100000;
    target.moveSpeed = 0;
    window.elowenSmokeTarget = target.id;
    // The rig answers in world space beyond the scene's mirror; the bolt
    // lives in the scene's frame (sim coordinates), so the hand is brought
    // over the way the renderer does it, and measured on the ground plane.
    window.elowenHandGap = (tracked) => {
      const v = t.renderer.championVisuals.get(t.selfId);
      const hand = new v.root.position.constructor();
      v.muzzleWorld(hand);
      t.renderer.scene.worldToLocal(hand);
      const p = tracked.mesh.position;
      const s = t.sim.units.get(t.selfId);
      return {
        handGap: Math.hypot(p.x - hand.x, p.z - hand.z),
        handFromBody: Math.hypot(hand.x - s.pos.x, hand.z - s.pos.z),
      };
    };
    t.advance(2);
  });
  await sleep(300);

  // The idle: her own file, the levitate loop running, the figure lifted.
  const idle = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const v = t.renderer.championVisuals.get(t.selfId);
    const idle = v.baseActions.idle;
    return {
      clip: idle?.getClip().name ?? null,
      running: idle?.isRunning() ?? false,
      clips: Object.keys(v.shotActions ?? {}),
      spells: Object.keys(v.spellActions ?? {}),
      y: v.root.position.y,
    };
  });
  report.idle = idle;
  assert.equal(idle.clip, 'Levitate', JSON.stringify(idle));
  assert.ok(idle.running, JSON.stringify(idle));
  assert.deepEqual(idle.spells.sort(), ['E', 'Q', 'R', 'W'], JSON.stringify(idle));
  await page.screenshot({ path: `${output}/levitate.webp` });

  // The attack: the gesture plays, the auto leaves her hand on the beat.
  await page.evaluate(() => {
    const t = window.mapPlaytest;
    t.sim.orderAttack(t.selfId, window.elowenSmokeTarget);
    t.advance(1);
  });
  await sleep(180);
  const attack = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const v = t.renderer.championVisuals.get(t.selfId);
    const a = v.shotActions.attack;
    return {
      clip: a.getClip().name,
      time: a.time,
      speed: a.getEffectiveTimeScale(),
      running: a.isRunning(),
    };
  });
  report.attack = attack;
  assert.equal(attack.clip, 'Attack');
  assert.ok(attack.running, JSON.stringify(attack));
  await page.screenshot({ path: `${output}/attack.webp` });
  const auto = await page.evaluate(() => {
    const t = window.mapPlaytest;
    let found;
    for (let i = 0; i < 12 && !found; i++) {
      t.advance(1);
      found = [...t.renderer.trackedProjectiles.values()].find((p) => p.tag === 'elowen_A');
    }
    return found ? { tag: found.tag, name: found.mesh.name, ...window.elowenHandGap(found) } : null;
  });
  report.auto = auto;
  assert.ok(auto, 'the auto never left her hand');
  assert.equal(auto.name, 'Elowen_AttackWisp', JSON.stringify(auto));
  assert.ok(auto.handGap < 2 && auto.handFromBody > 0.8, `the auto left her body, not her hand: ${JSON.stringify(auto)}`);
  await page.screenshot({ path: `${output}/attack-bolt.webp` });

  // A cast helper: stops, refills mana, casts the key at an offset from
  // the champion, steps one tick.
  const cast = (key, dx, dz) =>
    page.evaluate(
      ([k, ox, oz]) => {
        const t = window.mapPlaytest;
        const self = t.sim.units.get(t.selfId);
        t.sim.orderStop(self.id);
        t.advance(8);
        self.mana = self.maxMana;
        const ok = t.sim.castAbility(self.id, k, { x: self.pos.x + ox, z: self.pos.z + oz });
        t.advance(1);
        return ok;
      },
      [key, dx, dz],
    );
  const spellClip = (key) =>
    page.evaluate((k) => {
      const t = window.mapPlaytest;
      const v = t.renderer.championVisuals.get(t.selfId);
      const a = v.spellActions[k];
      return { clip: a.getClip().name, running: a.isRunning(), time: a.time };
    }, key);

  // Q: the lance flies with her own projectile body.
  assert.ok(await cast('Q', 5, 0));
  const lance = await page.evaluate(() => {
    const t = window.mapPlaytest;
    let found;
    for (let i = 0; i < 6 && !found; i++) {
      t.advance(1);
      found = [...t.renderer.trackedProjectiles.values()].find((p) => p.tag === 'elowen_Q');
    }
    return found
      ? {
          name: found.mesh.name,
          authored: !!found.vis?.projectile,
          children: found.mesh.children.length,
          ...window.elowenHandGap(found),
        }
      : null;
  });
  report.lance = { ...lance, ...(await spellClip('Q')) };
  assert.ok(lance, 'no lance in flight');
  assert.ok(lance.authored, JSON.stringify(lance));
  assert.ok(lance.handGap < 2 && lance.handFromBody > 0.8, `the lance left her body, not her hand: ${JSON.stringify(lance)}`);
  assert.equal(report.lance.clip, 'Cast_Q');
  assert.ok(report.lance.running, JSON.stringify(report.lance));
  // A few ticks of flight so the lance clears her body before the shot.
  await page.evaluate(() => window.mapPlaytest.advance(4));
  await sleep(120);
  await page.screenshot({ path: `${output}/mist-lance.webp` });
  await page.evaluate(() => window.mapPlaytest.advance(40));
  await sleep(150);

  // W: the veil, her own zone body, ticking mist.
  assert.ok(await cast('W', -3, 1));
  await sleep(600);
  const veil = await page.evaluate(() => {
    const t = window.mapPlaytest;
    t.advance(4);
    const zone = [...t.renderer.trackedZones.values()].find((z) => z.tag === 'elowen_W');
    return zone
      ? { name: zone.mesh.name, authored: !!zone.vis?.zone, children: zone.mesh.children.length }
      : null;
  });
  report.veil = { ...veil, ...(await spellClip('W')) };
  assert.ok(veil, 'no veil zone');
  assert.ok(veil.authored, JSON.stringify(veil));
  assert.equal(report.veil.clip, 'Cast_W');
  await page.screenshot({ path: `${output}/veil.webp` });
  await page.evaluate(() => window.mapPlaytest.advance(80));

  // E: the blink; the gesture plays, she lands ahead, and the flash's
  // parts (two flashes and the streak) ride the timed effects.
  const before = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const s = t.sim.units.get(t.selfId);
    return { x: s.pos.x, z: s.pos.z };
  });
  assert.ok(await cast('E', 0, 4));
  await sleep(200);
  const step = await page.evaluate(() => {
    const t = window.mapPlaytest;
    t.advance(1);
    const s = t.sim.units.get(t.selfId);
    const timed = t.renderer.vfx.timed.count;
    return { x: s.pos.x, z: s.pos.z, timed };
  });
  report.step = { before, after: step, ...(await spellClip('E')) };
  assert.equal(report.step.clip, 'Cast_E');
  assert.ok(Math.hypot(step.x - before.x, step.z - before.z) > 2, JSON.stringify(report.step));
  assert.ok(step.timed >= 2, `the flash and the streak are not up: ${JSON.stringify(step)}`);
  await page.screenshot({ path: `${output}/drifting-step.webp` });
  await page.evaluate(() => window.mapPlaytest.advance(5));

  // R: the whiteout, her own storm body.
  assert.ok(await cast('R', 4, 0));
  await sleep(800);
  const storm = await page.evaluate(() => {
    const t = window.mapPlaytest;
    t.advance(6);
    const zone = [...t.renderer.trackedZones.values()].find((z) => z.tag === 'elowen_R');
    return zone
      ? { name: zone.mesh.name, authored: !!zone.vis?.zone, children: zone.mesh.children.length }
      : null;
  });
  report.storm = { ...storm, ...(await spellClip('R')) };
  assert.ok(storm, 'no whiteout zone');
  assert.ok(storm.authored, JSON.stringify(storm));
  assert.equal(report.storm.clip, 'Cast_R');
  await page.screenshot({ path: `${output}/whiteout.webp` });

  // The glide: moving plays the run clip, once the whiteout's gesture has
  // let go of the rig (a one-shot holds it until it ends).
  await sleep(2800);
  await page.evaluate(() => {
    const t = window.mapPlaytest;
    const s = t.sim.units.get(t.selfId);
    t.sim.orderMove(s.id, s.pos.x - 6, s.pos.z);
  });
  // The renderer reads movement between its frames, so the paused sim
  // steps a tick at a time while the page draws.
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.mapPlaytest.advance(1));
    await sleep(50);
  }
  const glide = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const v = t.renderer.championVisuals.get(t.selfId);
    const run = v.baseActions.run;
    return {
      clip: run?.getClip().name ?? null,
      running: run?.isRunning() ?? false,
      weight: run?.getEffectiveWeight() ?? 0,
      timeScale: run?.getEffectiveTimeScale() ?? null,
      enabled: run?.enabled ?? null,
      paused: run?.paused ?? null,
      base: v.base,
      current: v.current?.getClip().name ?? null,
      shot: v.shot?.getClip().name ?? null,
    };
  });
  report.glide = glide;
  assert.equal(glide.clip, 'Glide', JSON.stringify(glide));
  assert.equal(glide.base, 'run', JSON.stringify(glide));
  assert.equal(glide.current, 'Glide', JSON.stringify(glide));
  await page.screenshot({ path: `${output}/glide.webp` });

  report.errors = errors;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  const real = errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED|WebSocket/.test(e));
  assert.deepEqual(real, [], `page errors: ${JSON.stringify(real)}`);
  console.log('Elowen smoke passed', JSON.stringify(report));
} finally {
  await browser.close();
}
