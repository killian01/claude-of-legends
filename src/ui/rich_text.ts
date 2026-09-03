// The rich-text lane for generated descriptions (kits-v2 tooltips): one
// injected stylesheet of value-color classes, shared by the tooltip layer
// and the roster browser. The HTML rendered through here is GENERATED from
// the repo's own data records (ui/describe.ts), never from user input, so
// innerHTML is safe by construction.

const STYLE_ID = 'col-rich-text-styles';

export function ensureRichTextStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // The genre's color language: physical and AD in ember red, magic and AP
  // in blue, true damage in white, restoration in green, shields in teal,
  // crowd control in gold, utility in violet.
  style.textContent =
    '.tt-phys{color:#ff9a5c;font-weight:600}' +
    '.tt-magic{color:#74b6ff;font-weight:600}' +
    '.tt-true{color:#f2f2f2;font-weight:600}' +
    '.tt-heal{color:#8ce08a;font-weight:600}' +
    '.tt-shield{color:#7fe0c8;font-weight:600}' +
    '.tt-cc{color:#ffd35c;font-weight:600}' +
    '.tt-flavor{color:#c9bfa3;font-style:italic}' +
    '.tt-util{color:#c9b2ff;font-weight:600}';
  document.head.appendChild(style);
}

// Sets a line of generated description HTML on an element.
export function setRichLine(el: HTMLElement, html: string): void {
  ensureRichTextStyles();
  el.innerHTML = html;
}
