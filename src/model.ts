// Domain model for the DrBacklog.md backlog file.
//
// This module is pure data: types plus the section constants that describe
// the document layout. The parser (backlog.md -> BacklogDocument) and the
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
  /** Human-readable summary. Rendered in both the index and the details. */
  title: string;
  /** Full task detail. May be multi-line/markdown. */
  description: string;
  status: TaskStatus;
  /** Date the task was created, `YYYY-MM-DD`. */
  created: string;
  /** Set when the task is moved to DONE or CLOSED, if a resolution was given. */
  resolution?: string;
  /**
   * Verbatim lines found inside this task's details block that the parser did
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
  /**
   * Raw lines between the index zone and the details zone's first task: prose
   * after the `---` divider, or notes sitting above the first `###` block.
   * Excludes the divider itself (the renderer always emits that). Notes
   * *after* a task's fields attach to that task's `extraLines` instead.
   */
  midNotes: string[];
}

/** The whole backlog file, parsed into a manipulable model. */
export interface BacklogDocument {
  /** The H1 title text, without the leading `# `. */
  title: string;
  tasks: Task[];
  passthrough: Passthrough;
}

/** Describes one status section (index section) and how it renders. */
export interface SectionSpec {
  status: TaskStatus;
  /** Exact section heading text following `## `. */
  heading: string;
  /** Checkbox mark used for this section's tasks in the index list. */
  checkbox: ' ' | 'x';
}

/**
 * The three status sections, in the order they appear in the index zone.
 * Single source of truth for both recognizing headings on parse and emitting
 * them on render.
 */
export const SECTIONS = [
  { status: 'TODO', heading: 'TODO', checkbox: ' ' },
  { status: 'DONE', heading: 'DONE', checkbox: 'x' },
  { status: 'CLOSED', heading: 'CLOSED', checkbox: 'x' },
] as const satisfies readonly SectionSpec[];

/** Default H1 title used when initializing a fresh backlog file. */
export const DEFAULT_TITLE = 'DrBacklog';

/** Heading text (following `## `) for the task details zone. */
export const DETAILS_HEADING = 'Task Details';

/** Look up the section spec for a status. */
export function sectionFor(status: TaskStatus): SectionSpec {
  const section = SECTIONS.find((s) => s.status === status);
  // Total over the TaskStatus union: every status has a section.
  if (!section) throw new Error(`No section defined for status: ${status}`);
  return section;
}

/** Derive the stable index anchor for a task id (matches the details heading). */
export function anchorFor(id: number): string {
  return `task-${id}`;
}
