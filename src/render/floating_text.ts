// Floating combat text: short-lived rising sprites (damage numbers, gold
// popups) rendered from small canvas textures. Pure presentation.

import * as THREE from 'three';

interface Entry {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  bornAt: number;
  baseY: number;
  baseX: number;
  baseZ: number;
  // Sideways drift so simultaneous hits fan out instead of stacking.
  driftX: number;
  driftZ: number;
}

const LIFETIME_MS = 900;
const MAX_ACTIVE = 48;

export function makeTextSprite(
  text: string,
  color: string,
  scale = 1,
  widthPx = 128,
  fontPx = 30,
): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = 48;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.font = `bold ${fontPx}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  g.lineWidth = 6;
  g.strokeText(text, widthPx / 2, 24);
  g.fillStyle = color;
  g.fillText(text, widthPx / 2, 24);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((widthPx / 40) * scale, 1.2 * scale, 1);
  return sprite;
}

export class FloatingText {
  private readonly scene: THREE.Scene;
  private readonly entries: Entry[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(text: string, color: string, x: number, y: number, z: number, scale = 1): void {
    if (this.entries.length >= MAX_ACTIVE) return;
    const sprite = makeTextSprite(text, color, scale);
    if (!sprite) return;
    const jx = (Math.random() - 0.5) * 0.9;
    const jz = (Math.random() - 0.5) * 0.5;
    sprite.position.set(x + jx, y, z + jz);
    this.scene.add(sprite);
    this.entries.push({
      sprite,
      material: sprite.material as THREE.SpriteMaterial,
      texture: (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture,
      bornAt: performance.now(),
      baseY: y,
      baseX: x + jx,
      baseZ: z + jz,
      driftX: (Math.random() - 0.5) * 1.2,
      driftZ: (Math.random() - 0.5) * 0.5,
    });
  }

  update(now: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      const age = (now - e.bornAt) / LIFETIME_MS;
      if (age >= 1) {
        this.scene.remove(e.sprite);
        e.material.dispose();
        e.texture.dispose();
        this.entries.splice(i, 1);
        continue;
      }
      // Ease-out rise with a sideways drift: an arc, not an elevator.
      const rise = 1 - (1 - age) * (1 - age);
      e.sprite.position.set(
        e.baseX + e.driftX * age,
        e.baseY + rise * 1.9,
        e.baseZ + e.driftZ * age,
      );
      e.material.opacity = 1 - age * age;
    }
  }
}
