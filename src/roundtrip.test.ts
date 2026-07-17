import { describe, expect, it } from 'vitest';

import { parse } from './parse.js';
import { render } from './render.js';
import { DEFAULT_TITLE, LEDGER_HEADING, WARDS } from './model.js';
import type { BacklogDocument } from './model.js';

const [TODO_WARD, DONE_WARD, CLOSED_WARD] = WARDS;

/** A representative document exercising every field and passthrough slot. */
function sampleDoc(): BacklogDocument {
  return {
    title: DEFAULT_TITLE,
    tasks: [
      {
        id: 101,
        title: 'Implement OAuth2 login',
        description: 'Integrate Google and GitHub authentication.\nStore refresh tokens securely.',
        status: 'TODO',
        admitted: '2026-07-16',
        extraLines: ['* **Priority:** high'],
      },
      {
        id: 102,
        title: 'Fix database migration timeout',
        description: 'The v2.1 migration fails on production.',
        status: 'DONE',
        admitted: '2026-07-15',
        resolution: 'Added an index concurrently before the column modification.',
        extraLines: [],
      },
    ],
    passthrough: {
      preamble: ['A note under the title.'],
      midNotes: ['A note between the index and the ledger.'],
    },
  };
}

describe('render', () => {
  it('emits the canonical layout with all three wards, even empty ones', () => {
    const doc: BacklogDocument = {
      title: DEFAULT_TITLE,
      tasks: [
        {
          id: 101,
          title: 'A task',
          description: 'A description.',
          status: 'TODO',
          admitted: '2026-07-17',
          extraLines: [],
        },
      ],
      passthrough: { preamble: [], midNotes: [] },
    };

    const expected = [
      `# ${DEFAULT_TITLE}`,
      '',
      `## ${TODO_WARD.heading}`,
      '- [ ] [#101: A task](#task-101)',
      '',
      `## ${DONE_WARD.heading}`,
      '',
      `## ${CLOSED_WARD.heading}`,
      '',
      '---',
      '',
      `## ${LEDGER_HEADING}`,
      '',
      '<a id="task-101"></a>',
      '### #101: A task',
      '* **Status:** TODO',
      '* **Admitted:** 2026-07-17',
      '* **Description:** A description.',
      '',
    ].join('\n');

    expect(render(doc)).toBe(expected);
  });

  it('ends the file with exactly one trailing newline', () => {
    expect(render(sampleDoc())).toMatch(/[^\n]\n$/);
  });
});

describe('round trip', () => {
  it('parse(render(doc)) recovers the original model', () => {
    const doc = sampleDoc();
    expect(parse(render(doc))).toEqual(doc);
  });

  it('render is idempotent: render(parse(text)) === text for canonical text', () => {
    const once = render(sampleDoc());
    const twice = render(parse(once));
    expect(twice).toBe(once);
  });

  it('preserves multi-line descriptions and resolutions', () => {
    const doc = parse(render(sampleDoc()));
    expect(doc.tasks[0]!.description).toBe(
      'Integrate Google and GitHub authentication.\nStore refresh tokens securely.',
    );
    expect(doc.tasks[1]!.resolution).toBe(
      'Added an index concurrently before the column modification.',
    );
  });

  it('preserves passthrough prose and unknown per-task fields', () => {
    const doc = parse(render(sampleDoc()));
    expect(doc.passthrough.preamble).toEqual(['A note under the title.']);
    expect(doc.passthrough.midNotes).toEqual(['A note between the index and the ledger.']);
    expect(doc.tasks[0]!.extraLines).toEqual(['* **Priority:** high']);
  });
});

describe('empty document', () => {
  const empty: BacklogDocument = {
    title: DEFAULT_TITLE,
    tasks: [],
    passthrough: { preamble: [], midNotes: [] },
  };

  it('renders the boilerplate skeleton', () => {
    const text = render(empty);
    expect(text).toContain(`# ${DEFAULT_TITLE}`);
    expect(text).toContain(`## ${LEDGER_HEADING}`);
    for (const ward of WARDS) expect(text).toContain(`## ${ward.heading}`);
  });

  it('round-trips the empty skeleton', () => {
    expect(parse(render(empty))).toEqual(empty);
  });
});
