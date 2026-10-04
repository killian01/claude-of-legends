// Writes to the page only on a change (src/ui/dom_write.ts): the HUD's
// twenty-a-second updates leave an element alone when it already shows
// what they would write.

import { describe, expect, it } from 'vitest';
import { setClassName, setData, setHidden, setText } from '../src/ui/dom_write';

// An element that counts the writes it takes.
function element() {
  const writes: string[] = [];
  let hidden = false;
  let className = '';
  const data: Record<string, string | undefined> = {};
  return {
    writes,
    get hidden() {
      return hidden;
    },
    set hidden(v: boolean) {
      writes.push(`hidden=${v}`);
      hidden = v;
    },
    get className() {
      return className;
    },
    set className(v: string) {
      writes.push(`class=${v}`);
      className = v;
    },
    dataset: new Proxy(data, {
      set(target, key, value) {
        writes.push(`data-${String(key)}=${value}`);
        target[String(key)] = value;
        return true;
      },
    }),
  };
}

describe('writes on change only', () => {
  it('hides and shows once each, however often told', () => {
    const el = element();
    for (let i = 0; i < 3; i++) setHidden(el, true);
    for (let i = 0; i < 3; i++) setHidden(el, false);
    expect(el.writes).toEqual(['hidden=true', 'hidden=false']);
  });

  it('sets a text only when it differs', () => {
    const writes: string[] = [];
    let text: string | null = '';
    const el = {
      get textContent() {
        return text;
      },
      set textContent(v: string | null) {
        writes.push(String(v));
        text = v;
      },
    };
    setText(el, '120 / 900');
    setText(el, '120 / 900');
    setText(el, '118 / 900');
    expect(writes).toEqual(['120 / 900', '118 / 900']);
  });

  it('sets a class list and a data attribute only when they differ', () => {
    const el = element();
    setClassName(el, 'br-dusk hold');
    setClassName(el, 'br-dusk hold');
    setClassName(el, 'br-dusk warn');
    setData(el, 'mark', 'wrath');
    setData(el, 'mark', 'wrath');
    expect(el.writes).toEqual(['class=br-dusk hold', 'class=br-dusk warn', 'data-mark=wrath']);
  });
});
