import { describe, expect, it } from 'vitest';
import { ANNOUNCE_WAITING, AnnounceLine } from '../src/ui/announce_line';

const line = (text: string, holdMs = 1000) => ({ text, color: '#fff', holdMs });

describe('the announcement line', () => {
  it('shows a line at once and hides it when its moment is over', () => {
    const a = new AnnounceLine();
    expect(a.say(line('Tower down'), false, 0)?.text).toBe('Tower down');
    expect(a.showing).toBe(true);
    expect(a.step(1000)).toBeNull();
    expect(a.step(1001)).toBe('hide');
    expect(a.showing).toBe(false);
    expect(a.step(5000)).toBeNull();
  });

  it('lets a new line replace one not kept', () => {
    const a = new AnnounceLine();
    a.say(line('First'), false, 0);
    expect(a.say(line('Second'), false, 100)?.text).toBe('Second');
    expect(a.queued).toBe(0);
  });

  it('holds a kept line for its moment and shows what waited in turn', () => {
    const a = new AnnounceLine();
    a.say(line('On the ladder', 2000), true, 0);
    expect(a.say(line('Tower down'), false, 100)).toBeNull();
    expect(a.say(line('Creature taken'), false, 200)).toBeNull();
    expect(a.queued).toBe(2);
    expect(a.step(2001)).toMatchObject({ text: 'Tower down' });
    expect(a.step(3002)).toMatchObject({ text: 'Creature taken' });
    expect(a.step(4003)).toBe('hide');
  });

  it('keeps no more than three lines waiting', () => {
    const a = new AnnounceLine();
    a.say(line('Kept', 2000), true, 0);
    for (let i = 0; i < 6; i++) a.say(line(`Line ${i}`), false, 10);
    expect(a.queued).toBe(ANNOUNCE_WAITING);
  });

  it('lets a kept line be replaced by another kept one', () => {
    const a = new AnnounceLine();
    a.say(line('Kept', 2000), true, 0);
    expect(a.say(line('Kept too', 2000), true, 100)?.text).toBe('Kept too');
  });

  it('starts a new bout on an empty line: the last bout said in bulk goes', () => {
    const a = new AnnounceLine();
    a.say(line('Starglean won', 2000), true, 0);
    a.say(line('Three Seedfalls have landed'), false, 10);
    a.say(line('A Seedfall opened'), false, 20);
    a.clear();
    expect(a.showing).toBe(false);
    expect(a.queued).toBe(0);
    expect(a.step(3000)).toBeNull();
    expect(a.say(line('Lastwick'), false, 3000)?.text).toBe('Lastwick');
    expect(a.step(4001)).toBe('hide');
  });
});
