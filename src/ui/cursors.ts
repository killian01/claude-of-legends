// Custom painted cursors (playtest round 2): the OS arrow and the browser
// crosshair read as a debug build. A gold-edged dart is the resting cursor;
// a drawn sword replaces it over any attackable enemy. Both are canvas
// paintings cached as data URLs and applied through CSS `cursor`, with the
// browser defaults as fallback.

function makeCanvas(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  return canvas.getContext('2d');
}

function paintDart(): string | null {
  const ctx = makeCanvas();
  if (!ctx) return null;
  // The classic pointer silhouette, dark steel with a gold rim.
  ctx.beginPath();
  ctx.moveTo(3, 1);
  ctx.lineTo(3, 22);
  ctx.lineTo(8.5, 17);
  ctx.lineTo(12.5, 27);
  ctx.lineTo(17, 25);
  ctx.lineTo(13, 15.5);
  ctx.lineTo(20.5, 15);
  ctx.closePath();
  const fill = ctx.createLinearGradient(3, 1, 18, 25);
  fill.addColorStop(0, '#dfe9f5');
  fill.addColorStop(0.45, '#8fa6c2');
  fill.addColorStop(1, '#3c5170');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#e8c96a';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(10, 16, 28, 0.9)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  return ctx.canvas.toDataURL();
}

function paintSword(): string | null {
  const ctx = makeCanvas();
  if (!ctx) return null;
  // A short sword, tip toward the upper left, so the point of contact
  // matches the hotspot.
  ctx.translate(16, 16);
  ctx.rotate(-Math.PI / 4);
  // Blade.
  ctx.beginPath();
  ctx.moveTo(-2.4, -12);
  ctx.lineTo(0, -15.5);
  ctx.lineTo(2.4, -12);
  ctx.lineTo(1.8, 4);
  ctx.lineTo(-1.8, 4);
  ctx.closePath();
  const steel = ctx.createLinearGradient(-2.4, 0, 2.4, 0);
  steel.addColorStop(0, '#f4f8fc');
  steel.addColorStop(0.55, '#aebdc8');
  steel.addColorStop(1, '#5c6a78');
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.strokeStyle = '#232c38';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Fuller line down the blade.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(0, -13.5);
  ctx.lineTo(0, 3);
  ctx.stroke();
  // Crossguard, grip, pommel.
  ctx.fillStyle = '#e8c96a';
  ctx.strokeStyle = '#5c3e08';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.rect(-6, 4, 12, 2.6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6a4a28';
  ctx.beginPath();
  ctx.rect(-1.7, 6.6, 3.4, 5.6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8c96a';
  ctx.beginPath();
  ctx.arc(0, 13.6, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return ctx.canvas.toDataURL();
}

let dartCss: string | null = null;
let swordCss: string | null = null;

// The resting in-game cursor (hotspot at the dart's point).
export function defaultCursor(): string {
  if (dartCss === null) {
    const url = paintDart();
    dartCss = url ? `url(${url}) 3 1, default` : 'default';
  }
  return dartCss;
}

// The over-an-enemy cursor (hotspot at the sword's tip).
export function attackCursor(): string {
  if (swordCss === null) {
    const url = paintSword();
    swordCss = url ? `url(${url}) 5 5, pointer` : 'pointer';
  }
  return swordCss;
}
