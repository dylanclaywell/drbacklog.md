// Flicker-free frame output for Ink.
//
// Ink 5 redraws by erasing every line of the previous frame and then writing
// the whole new frame, top to bottom, even when one line changed. A terminal
// is free to paint the screen between the erase and the rewrite, and when it
// does the lower rows show up blank for a moment: that's the flicker. Ink has
// no option to change this, so the TUI hands Ink a stdout that recognizes
// each frame and turns it into an update of only the lines that changed,
// written over the old ones in place, with nothing erased first.

// What Ink's log-update puts in front of every frame after the first: for
// each line of the previous frame, "erase line" (ESC[2K) and "cursor up"
// (ESC[1A) — no "up" after the last — then "cursor to column 1" (ESC[G).
// eslint-disable-next-line no-control-regex -- matching ESC is the point
const ERASE_PREVIOUS_FRAME = /^(?:\u001B\[2K(?:\u001B\[1A)?)+\u001B\[G/;

// Synchronized output (DEC private mode 2026): a terminal that supports it
// holds the screen until the end marker, then shows the whole update at once.
// Terminals that don't know the mode ignore both markers.
const SYNC_START = '\u001B[?2026h';
const SYNC_END = '\u001B[?2026l';

const moveTo = (row: number) => `\u001B[${row};1H`;
const ERASE_LINE = '\u001B[2K';
const ERASE_BELOW = '\u001B[J';

/**
 * Turns Ink's frame writes into minimal in-place updates. Assumes the frame
 * starts at the top-left of the screen and is shorter than the terminal,
 * which the TUI guarantees: it runs in the alternate screen buffer and draws
 * every screen one row short (see `screenRows` in app.tsx).
 */
export class FrameDiffer {
  /** The lines currently on screen, or null when that's unknown. */
  private onScreen: string[] | null = null;
  private seenFirstFrame = false;

  /** Forget what's on screen (after a resize, say), so the next frame redraws it all. */
  reset(): void {
    this.onScreen = null;
  }

  /**
   * The bytes to send in place of `chunk`, or null if `chunk` isn't a frame
   * and should go to the terminal untouched.
   */
  transform(chunk: string): string | null {
    const erase = ERASE_PREVIOUS_FRAME.exec(chunk);
    // Ink's first frame has nothing to erase, so it comes with no prefix.
    if (!erase && this.seenFirstFrame) return null;
    this.seenFirstFrame = true;

    const body = erase ? chunk.slice(erase[0].length) : chunk;
    // log-update ends every frame with a newline; an empty body is a clear.
    const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n');

    let out = SYNC_START;
    lines.forEach((line, i) => {
      if (this.onScreen?.[i] === line) return;
      // Erase, then write, rather than write then erase-to-end-of-line: a
      // line as wide as the terminal leaves the cursor on its last cell, and
      // erasing from there would wipe that cell.
      out += moveTo(i + 1) + ERASE_LINE + line;
    });
    if (this.onScreen === null || this.onScreen.length > lines.length) {
      out += moveTo(lines.length + 1) + ERASE_BELOW;
    }
    // Where log-update would have left it: the start of the row after the frame.
    out += moveTo(lines.length + 1) + SYNC_END;

    this.onScreen = lines;
    return out;
  }
}

/**
 * Wrap `stdout` for Ink's `render`: frames go through a FrameDiffer, and
 * everything else (size, resize events, isTTY…) is the real stream's.
 */
export function flickerFreeStdout(stdout: NodeJS.WriteStream): NodeJS.WriteStream {
  const differ = new FrameDiffer();
  // A resize can reflow what's on screen, so the next frame can't trust it.
  // Registered before Ink's own resize listener, so it runs first.
  stdout.on('resize', () => differ.reset());

  const write = (chunk: unknown, ...rest: unknown[]): boolean => {
    const frame = typeof chunk === 'string' ? differ.transform(chunk) : null;
    return (stdout.write as (...args: unknown[]) => boolean)(frame ?? chunk, ...rest);
  };

  return new Proxy(stdout, {
    get(target, prop) {
      if (prop === 'write') return write;
      const value: unknown = Reflect.get(target, prop, target);
      // Bound to the real stream: its methods expect `this` to be it, not the proxy.
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
