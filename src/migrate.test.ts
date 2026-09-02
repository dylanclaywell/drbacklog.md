import { describe, expect, it } from 'vitest';

import { isLegacyFormat, migrateContent } from './migrate.js';
import { parse } from './parse.js';

const LEGACY_FILE = [
  '# 🏥 DrBacklog Patient Chart',
  '',
  '## 🚨 CRITICAL (TODO)',
  '- [ ] [#1: Implement OAuth2 login](#task-1)',
  '',
  '## 🩺 STABLE (DONE)',
  '',
  '## 🗂️ ARCHIVED (CLOSED)',
  '',
  '---',
  '',
  '## 🔬 Patient Ledger (Task Details)',
  '',
  '<a id="task-1"></a>',
  '### #1: Implement OAuth2 login',
  '* **Status:** TODO',
  '* **Admitted:** 2026-07-16',
  '* **Description:** Integrate Google and GitHub authentication.',
  '',
].join('\n');

describe('isLegacyFormat', () => {
  it('detects a pre-rename file by its headings', () => {
    expect(isLegacyFormat(LEGACY_FILE)).toBe(true);
  });

  it('does not flag a current-format file', () => {
    expect(isLegacyFormat('# DrBacklog\n\n## TODO\n\n## DONE\n\n## CLOSED\n')).toBe(false);
  });

  it('does not flag a current-format file whose task text happens to mention a legacy marker', () => {
    const doc = [
      '# DrBacklog',
      '',
      '## TODO',
      '- [ ] [#1: Document the rename](#task-1)',
      '',
      '## DONE',
      '',
      '## CLOSED',
      '',
      '---',
      '',
      '## Task Details',
      '',
      '<a id="task-1"></a>',
      '### #1: Document the rename',
      '* **Status:** TODO',
      '* **Created:** 2026-07-16',
      '* **Description:** Old files used a 🔬 Patient Ledger (Task Details) heading',
      '  and an **Admitted:** field; both are now renamed.',
      '',
    ].join('\n');
    expect(isLegacyFormat(doc)).toBe(false);
  });
});

describe('migrateContent', () => {
  it('converts headings and the Admitted field, preserving task data', () => {
    const migrated = migrateContent(LEGACY_FILE);

    expect(isLegacyFormat(migrated)).toBe(false);
    expect(migrated).toContain('## TODO');
    expect(migrated).toContain('## Task Details');
    expect(migrated).toContain('* **Created:** 2026-07-16');
    expect(migrated).toContain('# DrBacklog\n');

    const doc = parse(migrated);
    expect(doc.tasks).toEqual([
      {
        id: 1,
        title: 'Implement OAuth2 login',
        description: 'Integrate Google and GitHub authentication.',
        status: 'TODO',
        created: '2026-07-16',
        extraLines: [],
      },
    ]);
  });

  it('is idempotent: migrating an already-current file is a no-op parse-wise', () => {
    const once = migrateContent(LEGACY_FILE);
    const twice = migrateContent(once);
    expect(parse(twice)).toEqual(parse(once));
  });

  it('preserves a human-chosen title instead of overwriting it', () => {
    const customTitled = LEGACY_FILE.replace(
      '# 🏥 DrBacklog Patient Chart',
      '# Team Frontend Backlog',
    );
    expect(parse(migrateContent(customTitled)).title).toBe('Team Frontend Backlog');
  });
});
