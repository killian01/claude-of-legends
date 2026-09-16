// Sylra's authored art in the local browser playtest: the basic attack's
// seed leaves on its beat, the W bramble field grows, the Q thorn flies
// and bursts, the E shell rides its holder and bursts when it goes, the R
// telegraph erupts into roots. Screenshots and a report land under
// .tmp/sylra-smoke/. Needs the Vite client on :5173 (dev-server skill) and
// Chrome; CHROME overrides the executable.
//
//   node scripts/smoke_sylra.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const output = '.tmp/sylra-smoke';
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
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5173/map_playtest.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('Page ready');
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
    await (await import('/src/render/vfx/sylra_fx.ts')).preloadSylraEffects();
    const t = window.mapPlaytest;
    const self = t.sim.units.get(t.selfId);
    t.sim.policies.clear();
    self.pos = t.nav.nearestWalkable(61, 63, 8);
    t.renderer.recenterCamera();
    t.renderer.scaleZoom(1.8);
    t.sim.orderStop(self.id);
    self.mana = self.maxMana;
    const target = t.sim.addChampion(1, { x: self.pos.x + 4, z: self.pos.z }, 'torv');
    target.hp = target.maxHp = 100000;
    target.moveSpeed = 0;
    window.sylraSmokeTarget = target.id;
    t.advance(2);
    t.sim.orderAttack(self.id, target.id);
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
  assert.equal(attack.clip, 'Attack');
  assert.ok(attack.running);
  assert.ok(attack.speed < 1.5, JSON.stringify(attack));
  await page.screenshot({ path: `${output}/attack-windup.webp` });
  const projectile = await page.evaluate(() => {
    const t = window.mapPlaytest;
    let found;
    for (let i = 0; i < 9 && !found; i++) {
      t.advance(1);
      found = [...t.renderer.trackedProjectiles.values()].find((p) => p.tag === 'sylra_A');
    }
    return found
      ? {
          name: found.mesh.name,
          authored: !!found.vis?.projectile,
          geometry: found.mesh.children.length,
        }
      : null;
  });
  assert.equal(projectile?.name, 'Sylra_AttackSeed');
  await page.screenshot({ path: `${output}/attack-seed.webp` });

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

  assert.ok(await cast('W', -3, 1));
  await sleep(1050);
  const field = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const v = t.renderer.championVisuals.get(t.selfId);
    const zone = [...t.renderer.trackedZones.values()].find((z) => z.tag === 'sylra_W');
    const parts = [];
    zone?.mesh.traverse((n) => {
      if (n.userData.effectKind) parts.push(n.userData.effectKind);
    });
    return {
      name: zone?.mesh.name,
      parts,
      clip: v.spellActions.W.getClip().name,
      time: v.spellActions.W.time,
      running: v.spellActions.W.isRunning(),
      calls: t.renderer.renderStats().calls,
    };
  });
  assert.equal(field.name, 'Sylra_BrambleField');
  assert.equal(field.clip, 'Cast_W');
  assert.ok(field.running);
  assert.equal(field.parts.filter((p) => p === 'bramble').length, 5);
  assert.ok(field.parts.includes('pollen') && field.parts.includes('roots'));
  await page.screenshot({ path: `${output}/bramble-field.webp` });

  // Q: the thorn bolt toward the target, then its burst on the hit.
  assert.ok(await cast('Q', 4, 0));
  const bolt = await page.evaluate(() => {
    const t = window.mapPlaytest;
    let found;
    for (let i = 0; i < 6 && !found; i++) {
      t.advance(1);
      found = [...t.renderer.trackedProjectiles.values()].find((p) => p.tag === 'sylra_Q');
    }
    const v = t.renderer.championVisuals.get(t.selfId);
    const parts = [];
    found?.mesh.traverse((n) => {
      if (n.userData.effectKind) parts.push(n.userData.effectKind);
    });
    return { name: found?.mesh.name, parts, clip: v.spellActions.Q.getClip().name };
  });
  assert.equal(bolt.name, 'Sylra_ThornBolt');
  assert.ok(bolt.parts.includes('bolt'), JSON.stringify(bolt));
  assert.equal(bolt.clip, 'Cast_Q');
  await page.screenshot({ path: `${output}/thorn-bolt.webp` });
  const thornHit = await page.evaluate(() => {
    const t = window.mapPlaytest;
    for (let i = 0; i < 40; i++) {
      t.advance(1);
      if (![...t.renderer.trackedProjectiles.values()].some((p) => p.tag === 'sylra_Q')) break;
    }
    return { timed: t.renderer.vfx.timed.count };
  });
  await sleep(120);
  assert.ok(thornHit.timed >= 1, JSON.stringify(thornHit));
  await page.screenshot({ path: `${output}/thorn-burst.webp` });

  // E: the shell rides the caster for the shield's life, then bursts.
  assert.ok(await cast('E', 0, 0));
  await sleep(400);
  const shell = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const tracked = t.renderer.tracked.get(t.selfId);
    const fx = tracked?.shieldFx;
    const v = t.renderer.championVisuals.get(t.selfId);
    return {
      name: fx?.holder.name,
      scale: fx?.holder.scale.x,
      children: fx?.holder.children.length,
      clip: v.spellActions.E.getClip().name,
    };
  });
  assert.equal(shell.name, 'Sylra_VerdantShell');
  assert.ok(shell.scale > 2, JSON.stringify(shell));
  assert.ok(shell.children >= 3, JSON.stringify(shell));
  assert.equal(shell.clip, 'Cast_E');
  await page.screenshot({ path: `${output}/verdant-shell.webp` });
  // 2.5 s of shield at 20 Hz, then the expiry tick; the next frame ends
  // the body and attaches its burst (shards and thorns) for a second.
  await page.evaluate(() => window.mapPlaytest.advance(52));
  await page.waitForFunction(
    () => !window.mapPlaytest.renderer.tracked.get(window.mapPlaytest.selfId).shieldFx,
    { timeout: 3000 },
  );
  const afterShell = await page.evaluate(() => ({
    fx: !!window.mapPlaytest.renderer.tracked.get(window.mapPlaytest.selfId).shieldFx,
    timed: window.mapPlaytest.renderer.vfx.timed.count,
  }));
  assert.equal(afterShell.fx, false);
  assert.ok(afterShell.timed >= 1, JSON.stringify(afterShell));
  await sleep(120);
  await page.screenshot({ path: `${output}/shell-burst.webp` });

  // R: the telegraph is the authored zone; the detonation attaches roots.
  assert.ok(await cast('R', 3, 3));
  await sleep(600);
  const telegraph = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const zone = [...t.renderer.trackedZones.values()].find((z) => z.tag === 'sylra_R');
    const parts = [];
    zone?.mesh.traverse((n) => {
      if (n.userData.effectKind) parts.push(n.userData.effectKind);
    });
    const v = t.renderer.championVisuals.get(t.selfId);
    return { name: zone?.mesh.name, parts, clip: v.spellActions.R.getClip().name };
  });
  assert.equal(telegraph.name, 'Sylra_Overgrowth');
  for (const kind of ['ring', 'sap', 'seed']) {
    assert.ok(telegraph.parts.includes(kind), JSON.stringify(telegraph));
  }
  assert.equal(telegraph.clip, 'Cast_R');
  await page.screenshot({ path: `${output}/overgrowth-telegraph.webp` });
  const eruption = await page.evaluate(() => {
    const t = window.mapPlaytest;
    t.advance(30);
    return { timed: t.renderer.vfx.timed.count };
  });
  await sleep(500);
  const roots = await page.evaluate(() => {
    const t = window.mapPlaytest;
    const zone = [...t.renderer.trackedZones.values()].find((z) => z.tag === 'sylra_R');
    let rootGroups = 0;
    t.renderer.scene.traverse((n) => {
      if (n.userData.effectKind === 'root') rootGroups++;
    });
    return { zone: !!zone, rootGroups, timed: t.renderer.vfx.timed.count };
  });
  assert.equal(roots.zone, false);
  assert.equal(roots.rootGroups, 3, JSON.stringify({ eruption, roots }));
  await page.screenshot({ path: `${output}/overgrowth-eruption.webp` });

  const text = await page.$eval('#test-tools', (n) => n.textContent);
  assert.ok(text.includes('Leave playtest') && text.includes('Restore health'));
  assert.deepEqual(errors, []);
  const report = { attack, projectile, field, bolt, thornHit, shell, afterShell, telegraph, roots };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
