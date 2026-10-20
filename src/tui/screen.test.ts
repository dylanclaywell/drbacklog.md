// Tests for the flicker-free frame writer: given the bytes Ink's log-update
// writes, it should send only the lines that changed, in place.

import { describe, expect, it } from 'vitest';
import ansiEscapes from 'ansi-escapes';

import { FrameDiffer } from './screen.js';

/** Exactly what Ink's log-update writes for a frame, after `previousLines` lines. */
const inkFrame = (lines: string[], previousLines: number) =>
  ansiEscapes.eraseLines(previousLines) + lines.join('\n') + '\n';

const SYNC_START = '\u001B[?2026h';
const SYNC_END = '\u001B[?2026l';
const ERASE_LINE = '\u001B[2K';
const at = (row: number) => `\u001B[${row};1H`;

describe('FrameDiffer', () => {
  it('draws the first frame in full and clears anything below it', () => {
    const out = new FrameDiffer().transform(inkFrame(['a', 'b'], 0));
    expect(out).toBe(
      SYNC_START +
        at(1) +
        ERASE_LINE +
        'a' +
        at(2) +
        ERASE_LINE +
        'b' +
        at(3) +
        '\u001B[J' +
        at(3) +
        SYNC_END,
    );
  });

  it('rewrites only the lines that changed, without erasing the frame first', () => {
    const differ = new FrameDiffer();
    differ.transform(inkFrame(['header', 'old', 'footer'], 0));
    const out = differ.transform(inkFrame(['header', 'new', 'footer'], 4));
    expect(out).toBe(SYNC_START + at(2) + ERASE_LINE + 'new' + at(4) + SYNC_END);
    expect(out).not.toContain('header');
    expect(out).not.toContain('footer');
  });

  it('clears leftover rows when a frame gets shorter', () => {
    const differ = new FrameDiffer();
    differ.transform(inkFrame(['a', 'b', 'c'], 0));
    const out = differ.transform(inkFrame(['a'], 4))!;
    expect(out).toContain(at(2) + '\u001B[J');
  });

  it('redraws everything after a reset', () => {
    const differ = new FrameDiffer();
    differ.transform(inkFrame(['same'], 0));
    differ.reset();
    expect(differ.transform(inkFrame(['same'], 2))).toContain('same');
  });

  it('treats an erase with nothing after it as clearing the screen', () => {
    const differ = new FrameDiffer();
    differ.transform(inkFrame(['a', 'b'], 0));
    expect(differ.transform(ansiEscapes.eraseLines(3))).toBe(
      SYNC_START + at(1) + '\u001B[J' + at(1) + SYNC_END,
    );
  });

  it('passes through anything that is not a frame', () => {
    const differ = new FrameDiffer();
    differ.transform(inkFrame(['a'], 0));
    expect(differ.transform('\u001B[?25h')).toBeNull();
    expect(differ.transform('some log line\n')).toBeNull();
  });

  it('keeps colors and other escapes inside a line intact', () => {
    const differ = new FrameDiffer();
    const colored = '\u001B[31mred\u001B[39m';
    expect(differ.transform(inkFrame([colored], 0))).toContain(ERASE_LINE + colored);
  });
});
