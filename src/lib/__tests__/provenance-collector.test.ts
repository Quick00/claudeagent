import path from 'path';
import {
  ProvenanceCollector,
  isIgnoredPath,
  toRepoRelative,
  narrowByBasedOn,
} from '@/lib/provenance-collector';

jest.mock('@/lib/config', () => ({
  config: {
    knowledgeMaxSourcesPerSave: 3,
    knowledgeIgnoreSegments: ['translations', 'vendor'],
    knowledgeIgnoreBasenames: ['composer.lock'],
  },
}));

const repos = [
  { gitlabProjectId: 1, localPath: '/repos/1' },
  { gitlabProjectId: 2, localPath: '/repos/2' },
];

describe('isIgnoredPath', () => {
  it('ignores configured directory segments case-insensitively', () => {
    expect(isIgnoredPath('resources/Translations/nl.json')).toBe(true);
    expect(isIgnoredPath('vendor/foo/bar.php')).toBe(true);
  });
  it('ignores configured basenames and CHANGELOG files', () => {
    expect(isIgnoredPath('composer.lock')).toBe(true);
    expect(isIgnoredPath('docs/CHANGELOG.md')).toBe(true);
  });
  it('keeps ordinary source files', () => {
    expect(isIgnoredPath('app/Models/Event.php')).toBe(false);
    expect(isIgnoredPath('app/Translator.php')).toBe(false);
  });
});

describe('toRepoRelative', () => {
  it('maps an absolute path under a repo to a forward-slash relative path', () => {
    expect(toRepoRelative('/repos/2/app/Models/Event.php', repos)).toEqual({
      gitlabProjectId: 2,
      relativePath: 'app/Models/Event.php',
    });
  });
  it('returns null for paths outside every repo', () => {
    expect(toRepoRelative('/app/uploads/image.png', repos)).toBeNull();
    expect(toRepoRelative('/repos/10/x.php', repos)).toBeNull();
  });
  it('normalises .. segments before matching', () => {
    expect(toRepoRelative('/repos/1/app/../config/app.php', repos)).toEqual({
      gitlabProjectId: 1,
      relativePath: 'config/app.php',
    });
  });
});

describe('narrowByBasedOn', () => {
  const captured = [
    { gitlabProjectId: 1, relativePath: 'app/Models/Event.php' },
    { gitlabProjectId: 1, relativePath: 'app/Services/Badge/Printer.php' },
  ];
  it('keeps only captured paths that match a hint by equality or suffix', () => {
    expect(narrowByBasedOn(captured, ['Badge/Printer.php'])).toEqual([captured[1]]);
    expect(narrowByBasedOn(captured, ['/repos/1/app/Models/Event.php'])).toEqual([captured[0]]);
  });
  it('ignores the hint when nothing matches', () => {
    expect(narrowByBasedOn(captured, ['nope.php'])).toEqual(captured);
  });
  it('is a no-op without hints', () => {
    expect(narrowByBasedOn(captured, undefined)).toEqual(captured);
    expect(narrowByBasedOn(captured, [])).toEqual(captured);
  });
});

describe('ProvenanceCollector', () => {
  let collector: ProvenanceCollector;
  beforeEach(() => {
    collector = new ProvenanceCollector();
    collector.start('m1', repos);
  });

  it('records Read file_path inputs under a repo and ignores other tools', () => {
    collector.recordToolUse('m1', 'Read', { file_path: '/repos/1/a.php' });
    collector.recordToolUse('m1', 'Grep', { path: '/repos/1', pattern: 'foo' });
    collector.recordToolUse('m1', 'Read', { file_path: '/app/uploads/img.png' });
    collector.recordToolUse('m1', 'Read', { file_path: '/repos/1/vendor/x.php' });
    expect(collector.snapshot('m1')).toEqual([{ gitlabProjectId: 1, relativePath: 'a.php' }]);
  });

  it('ignores unknown keys', () => {
    collector.recordToolUse('nope', 'Read', { file_path: '/repos/1/a.php' });
    expect(collector.snapshot('nope')).toEqual([]);
    expect(collector.has('nope')).toBe(false);
  });

  it('windows reads between saves', () => {
    collector.recordToolUse('m1', 'Read', { file_path: '/repos/1/a.php' });
    collector.recordToolUse('m1', 'Read', { file_path: '/repos/1/b.php' });
    expect(collector.snapshot('m1').map((p) => p.relativePath)).toEqual(['a.php', 'b.php']);
    collector.markSave('m1');

    collector.recordToolUse('m1', 'Read', { file_path: '/repos/1/c.php' });
    expect(collector.snapshot('m1').map((p) => p.relativePath)).toEqual(['c.php']);
  });

  it('returns nothing for a save with no reads since the previous one, never the whole run', () => {
    for (const f of ['a', 'b', 'c']) {
      collector.recordToolUse('m1', 'Read', { file_path: `/repos/1/${f}.php` });
    }
    expect(collector.snapshot('m1').map((p) => p.relativePath)).toEqual(['a.php', 'b.php', 'c.php']);
    collector.markSave('m1');

    // A second save with nothing read in between owns nothing: re-attaching the
    // run would give it three sources it was never based on.
    expect(collector.snapshot('m1')).toEqual([]);
    collector.markSave('m1');
    expect(collector.snapshot('m1')).toEqual([]);
  });

  it('dedupes and caps at knowledgeMaxSourcesPerSave keeping the most recent reads', () => {
    for (const f of ['a', 'b', 'a', 'c', 'd']) {
      collector.recordToolUse('m1', 'Read', { file_path: `/repos/1/${f}.php` });
    }
    expect(collector.snapshot('m1').map((p) => p.relativePath)).toEqual(['a.php', 'c.php', 'd.php']);
  });

  it('end removes the run', () => {
    collector.end('m1');
    expect(collector.has('m1')).toBe(false);
    expect(collector.snapshot('m1')).toEqual([]);
  });

  it('handles Windows-style separators in repo paths on the current platform', () => {
    // Sanity: path.resolve is platform-native; relative paths are always forward-slash.
    const rel = toRepoRelative(path.join('/repos/1', 'app', 'x.php'), repos);
    expect(rel?.relativePath).toBe('app/x.php');
  });
});
