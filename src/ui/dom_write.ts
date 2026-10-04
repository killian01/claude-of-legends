// Writes to the page that touch it only when the value changes. The HUD
// updates on every world tick, twenty times a second, and an element told
// it is hidden again when it already is still has its attribute set anew:
// a mutation, and a style recalculation of its part of the page, for
// nothing. These helpers compare first.

// Sets the element's text, written only on a change (setting the text
// replaces the element's children even when it is the same).
export function setText(el: { textContent: string | null }, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

// Shows or hides the element, written only on a change.
export function setHidden(el: Pick<HTMLElement, 'hidden'>, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

// Sets the element's class list as a whole, written only on a change.
export function setClassName(el: { className: string }, name: string): void {
  if (el.className !== name) el.className = name;
}

// Sets a data attribute, written only on a change.
export function setData(
  el: { dataset: Record<string, string | undefined> },
  key: string,
  value: string,
): void {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}
