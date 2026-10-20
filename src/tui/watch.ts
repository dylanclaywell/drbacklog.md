// Notice when backlog.md changes on disk, so the TUI can reload instead of
// showing a stale backlog until someone presses `r`.

import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';

export interface WatchOptions {
  /**
   * How long the file has to stay quiet before `onChange` fires. Writers
   * rarely touch a file once: an editor may truncate then write, and an agent
   * may make several tool calls in a row. Waiting for them to settle turns a
   * burst into one reload, and avoids reading a file an editor is halfway
   * through writing.
   */
  settleMs?: number;
}

/**
 * Call `onChange` whenever `filePath` changes, until the returned function is
 * called. Watches the containing directory rather than the file: every
 * BacklogStore write lands by renaming a temp file over backlog.md, and a
 * watch on the file itself can stop seeing changes once it's been replaced.
 * Events for other files in the directory — including those temp files — are
 * ignored.
 */
export function watchBacklog(
  filePath: string,
  onChange: () => void,
  { settleMs = 150 }: WatchOptions = {},
): () => void {
  const name = basename(filePath);
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, settleMs);
  };

  try {
    watcher = watch(dirname(filePath), (_event, changed) => {
      // Some platforms don't report a filename; then any change might be ours.
      if (changed === null || changed === name) schedule();
    });
    // Losing the watch (the directory was deleted, say) only means the TUI
    // goes back to reloading on `r` — not worth taking the TUI down for.
    watcher.on('error', () => watcher?.close());
  } catch {
    // Same reasoning: no watch is a degraded TUI, not a broken one.
  }

  return () => {
    clearTimeout(timer);
    watcher?.close();
  };
}
