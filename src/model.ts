// Domain model for the DrBacklog.md backlog file.
//
// This module is pure data: types plus the ward constants that describe the
// medical-themed sections. The parser (backlog.md -> BacklogDocument) and the
// renderer (BacklogDocument -> backlog.md) are the only code that should read
// or write these shapes, and they share this vocabulary so a round trip is
// lossless.

/** The three lifecycle states a task can occupy. */
export type TaskStatus = 'TODO' | 'DONE' | 'CLOSED';

/**
 * A single backlog task. Its identity is the numeric `id`; the stable index
 * anchor is derived from the id alone (e.g. `#task-101`), so `title` can change
 * freely without breaking links.
 */
export interface Task {
  /** Unique, monotonically assigned. Never reused once retired. */
  id: number;
  /** Human-readable summary. Rendered in both the index and the ledger. */
  title: string;
  /** Full task detail. May be multi-line/markdown. */
  description: string;
  status: TaskStatus;
  /** Date the task entered the backlog, `YYYY-MM-DD`. */
  admitted: string;
  /** Set when the task is moved to DONE or CLOSED, if a resolution was given. */
  resolution?: string;
  /**
   * Verbatim lines found inside this task's ledger block that the parser did
   * not recognize as a known field (e.g. a hand-written note or a custom
   * `* **Key:** value` line). Re-emitted unchanged after the known fields so
   * human edits survive a round trip.
   */
  extraLines: string[];
}

/**
 * Content the parser could not map to known structure, captured verbatim and
 * anchored to a document slot so the renderer can put it back in place. This is
 * the "passthrough" half of the hybrid parse->render strategy.
 */
export interface Passthrough {
  /** Raw lines before the first index section (below the H1 title). */
  preamble: string[];
  /** Raw lines between the index zone and the ledger zone, excluding the `---`
   *  divider (the renderer always emits that). */
  interstitial: string[];
  /** Raw lines after the last ledger block. */
  trailing: string[];
}

/** The whole backlog file, parsed into a manipulable model. */
export interface BacklogDocument {
  /** The H1 title text, without the leading `# `. */
  title: string;
  tasks: Task[];
  passthrough: Passthrough;
}

/** Describes one ward (index section) and how it renders. */
export interface WardSpec {
  status: TaskStatus;
  /** Exact section heading text following `## `. */
  heading: string;
  /** Checkbox mark used for this ward's tasks in the index list. */
  checkbox: ' ' | 'x';
}

/**
 * The three wards, in the order they appear in the index zone. Single source of
 * truth for both recognizing headings on parse and emitting them on render.
 */
export const WARDS = [
  { status: 'TODO', heading: '🚨 CRITICAL (TODO)', checkbox: ' ' },
  { status: 'DONE', heading: '🩺 STABLE (DONE)', checkbox: 'x' },
  { status: 'CLOSED', heading: '🗂️ ARCHIVED (CLOSED)', checkbox: 'x' },
] as const satisfies readonly WardSpec[];

/** Default H1 title used when initializing a fresh backlog file. */
export const DEFAULT_TITLE = '🏥 DrBacklog Patient Chart';

/** Heading text (following `## `) for the ledger zone. */
export const LEDGER_HEADING = '🔬 Patient Ledger (Task Details)';

/** Look up the ward spec for a status. */
export function wardFor(status: TaskStatus): WardSpec {
  const ward = WARDS.find((w) => w.status === status);
  // Total over the TaskStatus union: every status has a ward.
  if (!ward) throw new Error(`No ward defined for status: ${status}`);
  return ward;
}

/** Derive the stable index anchor for a task id (matches the ledger heading). */
export function anchorFor(id: number): string {
  return `task-${id}`;
}
