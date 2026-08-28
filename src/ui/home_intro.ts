// The home screen's backdrop: a short cinematic plays fullscreen once per
// page load and then holds on its final frame; there is no live 3D scene
// behind it. Later visits (back from a match), reduced-motion users, and
// any playback failure get the same final frame as a static image, so the
// screen always lands on the identical composition.

const SOURCES: readonly { src: string; type: string }[] = [
  { src: '/art/home_intro.webm', type: 'video/webm' },
  { src: '/art/home_intro.mp4', type: 'video/mp4' },
];
const END_FRAME = '/art/home_end.jpg';
// Cinematic slow motion. The source is 24 fps, so rates below ~0.6 start
// to visibly step.
const PLAYBACK_RATE = 0.7;

let playedThisLoad = false;

// Mounts the backdrop into `root` just below `card` in the stacking order.
// Returns a stop() that tears the layer down when the home screen resolves.
export function startHomeIntro(root: HTMLElement, card: HTMLElement): () => void {
  const mount = (el: HTMLElement): void => {
    el.classList.add('menu-intro-video');
    root.insertBefore(el, card);
  };
  const still = (): HTMLElement => {
    const img = document.createElement('img');
    img.src = END_FRAME;
    img.alt = '';
    return img;
  };

  if (playedThisLoad || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const img = still();
    mount(img);
    return () => img.remove();
  }
  playedThisLoad = true;

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.poster = '/art/home_poster.jpg';
  for (const { src, type } of SOURCES) {
    const source = document.createElement('source');
    source.src = src;
    source.type = type;
    video.appendChild(source);
  }
  video.playbackRate = PLAYBACK_RATE;
  mount(video);
  // Both the end of playback and any failure land on the static end frame:
  // it is sharper than the held 720p video frame (pre-upscaled offline),
  // and every path leaves the screen on the identical composition.
  let layer: HTMLElement = video;
  const swapToStill = (): void => {
    if (layer !== video || !video.isConnected) return;
    layer = still();
    mount(layer);
    video.remove();
  };
  video.addEventListener('ended', swapToStill);
  // The video element fires error only after the last source fails.
  video.addEventListener('error', swapToStill);
  video.querySelector('source:last-of-type')?.addEventListener('error', swapToStill);
  video.play().catch(swapToStill);

  return () => {
    video.pause();
    layer.remove();
  };
}
