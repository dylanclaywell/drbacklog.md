import { describe, expect, it } from 'vitest';

import { parse } from './parse.js';
import { render, renderSummary } from './render.js';
import { DEFAULT_TITLE, DETAILS_HEADING, EPICS_HEADING, SECTIONS } from './model.js';
import type { BacklogDocument } from './model.js';

const [TODO_SECTION, DONE_SECTION, CLOSED_SECTION] = SECTIONS;

/** A representative document exercising every field and passthrough slot. */
function sampleDoc(): BacklogDocument {
  return {
    title: DEFAULT_TITLE,
    epics: [],
    tasks: [
      {
        id: 101,
        title: 'Implement OAuth2 login',
        description: 'Integrate Google and GitHub authentication.\nStore refresh tokens securely.',
        status: 'TODO',
        priority: 'HIGH',
        created: '2026-07-16',
        extraLines: ['* **Owner:** platform-team'],
      },
      {
        id: 102,
        title: 'Fix database migration timeout',
        description: 'The v2.1 migration fails on production.',
        status: 'DONE',
        created: '2026-07-15',
        resolution: 'Added an index concurrently before the column modification.',
        extraLines: [],
      },
    ],
    passthrough: {
      preamble: ['A note under the title.'],
      midNotes: ['A note between the index and the details.'],
    },
  };
}

describe('render', () => {
  it('emits the canonical layout with all three sections, even empty ones', () => {
    const doc: BacklogDocument = {
      title: DEFAULT_TITLE,
      epics: [],
      tasks: [
        {
          id: 101,
          title: 'A task',
          description: 'A description.',
          status: 'TODO',
          created: '2026-07-17',
          extraLines: [],
        },
      ],
      passthrough: { preamble: [], midNotes: [] },
    };

    const expected = [
      `# ${DEFAULT_TITLE}`,
      '',
      `## ${TODO_SECTION.heading}`,
      '- [ ] [#101: A task](#task-101)',
      '',
      `## ${DONE_SECTION.heading}`,
      '',
      `## ${CLOSED_SECTION.heading}`,
      '',
      '---',
      '',
      `## ${DETAILS_HEADING}`,
      '',
      '<a id="task-101"></a>',
      '### #101: A task',
      '* **Status:** TODO',
      '* **Created:** 2026-07-17',
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
    expect(doc.passthrough.midNotes).toEqual(['A note between the index and the details.']);
    expect(doc.tasks[0]!.extraLines).toEqual(['* **Owner:** platform-team']);
  });
});

describe('renderSummary', () => {
  it('includes the title, all sections, and index items but not the task details', () => {
    const summary = renderSummary(sampleDoc());
    expect(summary).toContain(`# ${DEFAULT_TITLE}`);
    for (const section of SECTIONS) expect(summary).toContain(`## ${section.heading}`);
    expect(summary).toContain('[#101: Implement OAuth2 login](#task-101)');
    // No task details content.
    expect(summary).not.toContain(`## ${DETAILS_HEADING}`);
    expect(summary).not.toContain('### #101');
    expect(summary).not.toContain('* **Status:**');
    expect(summary).not.toContain('<a id=');
  });

  it('ends with exactly one trailing newline', () => {
    expect(renderSummary(sampleDoc())).toMatch(/[^\n]\n$/);
  });
});

describe('empty document', () => {
  const empty: BacklogDocument = {
    title: DEFAULT_TITLE,
    tasks: [],
    epics: [],
    passthrough: { preamble: [], midNotes: [] },
  };

  it('renders the boilerplate skeleton', () => {
    const text = render(empty);
    expect(text).toContain(`# ${DEFAULT_TITLE}`);
    expect(text).toContain(`## ${DETAILS_HEADING}`);
    for (const section of SECTIONS) expect(text).toContain(`## ${section.heading}`);
  });

  it('round-trips the empty skeleton', () => {
    expect(parse(render(empty))).toEqual(empty);
  });

  it('never emits an Epics section when there are no epics', () => {
    expect(render(empty)).not.toContain(`## ${EPICS_HEADING}`);
  });
});

describe('epics', () => {
  function docWithEpic(): BacklogDocument {
    return {
      title: DEFAULT_TITLE,
      passthrough: { preamble: [], midNotes: [] },
      epics: [
        {
          id: 5,
          title: 'Auth overhaul',
          description: 'Replace the session system.',
          extraLines: [],
        },
      ],
      tasks: [
        {
          id: 1,
          title: 'Add OAuth login',
          description: 'Integrate Google.',
          status: 'TODO',
          created: '2026-07-17',
          epicId: 5,
          extraLines: [],
        },
        {
          id: 2,
          title: 'Unrelated task',
          description: 'No epic.',
          status: 'TODO',
          created: '2026-07-17',
          extraLines: [],
        },
      ],
    };
  }

  it('emits an Epics section, and an Epic field only on linked tasks', () => {
    const text = render(docWithEpic());
    expect(text).toContain(`## ${EPICS_HEADING}`);
    expect(text).toContain('<a id="epic-5"></a>');
    expect(text).toContain('### Epic #5: Auth overhaul');
    expect(text).toContain('* **Epic:** #5');

    const task2Block = text.slice(text.indexOf('### #2:'));
    expect(task2Block).not.toContain('* **Epic:**');
  });

  it('round-trips a document with epics, including the task -> epic link', () => {
    const doc = docWithEpic();
    expect(parse(render(doc))).toEqual(doc);
  });
});

describe('priorities', () => {
  function docWithPriorities(): BacklogDocument {
    return {
      title: DEFAULT_TITLE,
      passthrough: { preamble: [], midNotes: [] },
      epics: [],
      tasks: [
        {
          id: 1,
          title: 'Urgent thing',
          description: 'Do it now.',
          status: 'TODO',
          priority: 'HIGH',
          created: '2026-07-17',
          extraLines: [],
        },
        {
          id: 2,
          title: 'Untriaged thing',
          description: 'Nobody decided yet.',
          status: 'TODO',
          created: '2026-07-17',
          extraLines: [],
        },
        {
          id: 3,
          title: 'Minor thing',
          description: 'Someday.',
          status: 'DONE',
          priority: 'LOW',
          created: '2026-07-17',
          extraLines: [],
        },
      ],
    };
  }

  it('emits a Priority field and index marker only on prioritized tasks', () => {
    const text = render(docWithPriorities());
    expect(text).toContain('* **Priority:** HIGH');
    expect(text).toContain('- [ ] [#1: Urgent thing](#task-1) !!!');
    expect(text).toContain('- [x] [#3: Minor thing](#task-3) !');
    // The untriaged task gets neither, so a backlog that doesn't use
    // priorities renders exactly as it did before priorities existed.
    expect(text).toContain('- [ ] [#2: Untriaged thing](#task-2)\n');
    const task2Block = text.slice(text.indexOf('### #2:'), text.indexOf('### #3:'));
    expect(task2Block).not.toContain('* **Priority:**');
  });

  it('round-trips priorities, including the absence of one', () => {
    const doc = docWithPriorities();
    expect(parse(render(doc))).toEqual(doc);
  });

  it('render stays idempotent with index markers present', () => {
    const once = render(docWithPriorities());
    expect(render(parse(once))).toBe(once);
  });

  it('does not reorder tasks on render — sorting is an explicit operation', () => {
    const text = render(docWithPriorities());
    // Task 2 is untriaged and task 1 is HIGH, yet document order is preserved.
    expect(text.indexOf('#1: Urgent thing')).toBeLessThan(text.indexOf('#2: Untriaged thing'));
    expect(text.indexOf('#2: Untriaged thing')).toBeLessThan(text.indexOf('#3: Minor thing'));
  });

  it('reads a hand-written Priority value case-insensitively', () => {
    const doc = parse(
      [
        `# ${DEFAULT_TITLE}`,
        '',
        `## ${DETAILS_HEADING}`,
        '',
        '### #1: A task',
        '* **Status:** TODO',
        '* **Priority:** high',
        '* **Created:** 2026-07-17',
        '* **Description:** A description.',
        '',
      ].join('\n'),
    );
    expect(doc.tasks[0]!.priority).toBe('HIGH');
    expect(doc.tasks[0]!.extraLines).toEqual([]);
  });

  it('preserves an unrecognized Priority value verbatim instead of coercing it', () => {
    const doc = parse(
      [
        `# ${DEFAULT_TITLE}`,
        '',
        `## ${DETAILS_HEADING}`,
        '',
        '### #1: A task',
        '* **Status:** TODO',
        '* **Priority:** whenever I get to it',
        '* **Created:** 2026-07-17',
        '* **Description:** A description.',
        '',
      ].join('\n'),
    );
    expect(doc.tasks[0]!.priority).toBeUndefined();
    expect(doc.tasks[0]!.extraLines).toEqual(['* **Priority:** whenever I get to it']);
  });
});
