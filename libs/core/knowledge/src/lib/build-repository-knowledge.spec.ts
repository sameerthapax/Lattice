import { resolveRepositoryAnalysis } from '@lattice/core-analyzer';
import { SupportedLanguage, type RepositoryScan } from '@lattice/core-indexer';
import type { RepositoryAnalysis } from '@lattice/core-parser';
import { describe, expect, it } from 'vitest';

import { buildRepositoryKnowledge } from './build-repository-knowledge';

const scan: RepositoryScan = {
  rootPath: '/repo',
  scannedAt: new Date(0),
  totalFiles: 4,
  totalDirectories: 5,
  totalIgnoredEntries: 0,
  files: [
    file('README.md', SupportedLanguage.Markdown),
    file('apps/web/src/main.ts', SupportedLanguage.TypeScript),
    file('libs/core/src/index.ts', SupportedLanguage.TypeScript),
    file('misc/config.json', SupportedLanguage.JSON),
  ],
};

const analysis: RepositoryAnalysis = {
  rootPath: '/repo',
  analyzedAt: new Date(1),
  scannedFileCount: 4,
  parsedFileCount: 2,
  skippedFileCount: 2,
  failedFileCount: 0,
  files: [
    {
      fileId: 'apps/web/src/main.ts',
      relativePath: 'apps/web/src/main.ts',
      language: 'TypeScript',
      contentHash: 'hash-app',
      symbols: [
        {
          id: 'main-symbol',
          name: 'main',
          qualifiedName: 'main',
          kind: 'function',
          fileId: 'apps/web/src/main.ts',
          parentSymbolId: null,
          exported: false,
          async: false,
          location: location(2),
        },
      ],
      imports: [
        {
          id: 'app-import',
          fileId: 'apps/web/src/main.ts',
          source: '../../../libs/core/src/index',
          kind: 'named',
          importedName: 'tool',
          localName: 'tool',
          typeOnly: false,
          location: location(1),
        },
      ],
      exports: [],
      diagnostics: [],
    },
    {
      fileId: 'libs/core/src/index.ts',
      relativePath: 'libs/core/src/index.ts',
      language: 'TypeScript',
      contentHash: 'hash-lib',
      symbols: [
        {
          id: 'tool-symbol',
          name: 'tool',
          qualifiedName: 'tool',
          kind: 'function',
          fileId: 'libs/core/src/index.ts',
          parentSymbolId: null,
          exported: true,
          async: false,
          location: location(1),
        },
      ],
      imports: [],
      exports: [
        {
          id: 'tool-export',
          fileId: 'libs/core/src/index.ts',
          kind: 'named',
          exportedName: 'tool',
          localName: 'tool',
          source: null,
          symbolId: 'tool-symbol',
          typeOnly: false,
          location: location(1),
        },
      ],
      diagnostics: [],
    },
  ],
  failures: [],
};

const resolution = resolveRepositoryAnalysis({ scan, analysis });
const projects = [
  {
    name: 'web',
    kind: 'application' as const,
    rootRelativePath: 'apps/web',
    sourceRootRelativePath: 'apps/web/src',
    entryPoints: [{ relativePath: 'apps/web/src/main.ts' }],
  },
  {
    name: 'core',
    kind: 'library' as const,
    rootRelativePath: 'libs/core',
    sourceRootRelativePath: 'libs/core/src',
    entryPoints: [{ relativePath: 'libs/core/src/index.ts' }],
  },
];

describe('buildRepositoryKnowledge', () => {
  it('builds a deterministic repository/project/folder/file/symbol hierarchy', () => {
    const first = buildRepositoryKnowledge({
      scan,
      analysis,
      resolution,
      projects,
    });
    const second = buildRepositoryKnowledge({
      scan: { ...scan, scannedAt: new Date(99) },
      analysis: { ...analysis, analyzedAt: new Date(100) },
      resolution,
      projects,
    });

    expect(first).toEqual(second);
    expect(first.repository.fileIds).toHaveLength(4);
    expect(first.summaries.rootFileCount).toBe(1);
    expect(first.repository.topLevelFolderIds).toHaveLength(3);
    expect(first.folders.map((folder) => folder.relativePath)).toEqual([
      'apps',
      'apps/web',
      'apps/web/src',
      'libs',
      'libs/core',
      'libs/core/src',
      'misc',
    ]);
    expect(first.files.map((item) => item.relativePath)).toEqual([
      'apps/web/src/main.ts',
      'libs/core/src/index.ts',
      'misc/config.json',
      'README.md',
    ]);
    expect(first.symbols).toHaveLength(2);
    expect(first.summaries).toMatchObject({
      projectCount: 2,
      folderCount: 7,
      fileCount: 4,
      parsedFileCount: 2,
      symbolCount: 2,
    });
  });

  it('maps projects by explicit longest-root membership and leaves other files projectless', () => {
    const knowledge = buildRepositoryKnowledge({
      scan,
      analysis,
      resolution,
      projects: [
        { name: 'all-libs', kind: 'unknown', rootRelativePath: 'libs' },
        ...projects,
      ],
    });
    expect(
      knowledge.files.find((item) => item.fileId === 'libs/core/src/index.ts')
        ?.projectId,
    ).toBe(knowledge.projects.find((item) => item.name === 'core')?.id);
    expect(
      knowledge.files.find((item) => item.fileId === 'misc/config.json')
        ?.projectId,
    ).toBeNull();
    expect(knowledge.projects.map((item) => item.rootRelativePath)).toEqual([
      'apps/web',
      'libs',
      'libs/core',
    ]);
  });

  it('constructs public surfaces, bindings, and cross-project dependencies', () => {
    const knowledge = buildRepositoryKnowledge({
      scan,
      analysis,
      resolution,
      projects,
    });
    const library = knowledge.projects.find((item) => item.name === 'core');
    const libraryFile = knowledge.files.find(
      (item) => item.fileId === 'libs/core/src/index.ts',
    );
    expect(libraryFile?.publicSymbolIds).toEqual(library?.publicSymbolIds);
    expect(library?.publicSymbolIds).toHaveLength(1);
    expect(knowledge.projectDependencies).toEqual([
      expect.objectContaining({
        dependencyCount: 1,
        typeOnlyDependencyCount: 0,
      }),
    ]);
    expect(knowledge.relations.some((item) => item.kind === 'binds-to')).toBe(
      true,
    );
    expect(
      knowledge.relations.some((item) => item.kind === 'project-depends-on'),
    ).toBe(true);
  });

  it('classifies skipped files and exact structural orphans', () => {
    const knowledge = buildRepositoryKnowledge({
      scan,
      analysis,
      resolution,
      projects,
    });
    expect(
      knowledge.files.find((item) => item.fileId === 'misc/config.json'),
    ).toMatchObject({ status: 'skipped', orphan: false });
    expect(
      knowledge.files.find((item) => item.fileId === 'apps/web/src/main.ts')
        ?.orphan,
    ).toBe(false);
    expect(knowledge.summaries.orphanFileCount).toBe(0);
  });

  it.each([
    [
      'DUPLICATE_PROJECT_ROOT',
      [
        { name: 'one', kind: 'library' as const, rootRelativePath: 'libs' },
        { name: 'two', kind: 'library' as const, rootRelativePath: 'libs' },
      ],
    ],
    [
      'PROJECT_PATH_ESCAPES_REPOSITORY',
      [{ name: 'bad', kind: 'unknown' as const, rootRelativePath: '../bad' }],
    ],
    [
      'SOURCE_ROOT_OUTSIDE_PROJECT',
      [
        {
          name: 'bad',
          kind: 'unknown' as const,
          rootRelativePath: 'libs/core',
          sourceRootRelativePath: 'apps',
        },
      ],
    ],
    [
      'ENTRY_POINT_NOT_SCANNED',
      [
        {
          name: 'bad',
          kind: 'unknown' as const,
          rootRelativePath: 'libs/core',
          entryPoints: [{ relativePath: 'libs/core/missing.ts' }],
        },
      ],
    ],
  ])('rejects malformed project metadata with %s', (code, invalidProjects) => {
    expect(() =>
      buildRepositoryKnowledge({
        scan,
        analysis,
        resolution,
        projects: invalidProjects,
      }),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects prior-stage file references absent from the scan', () => {
    expect(() =>
      buildRepositoryKnowledge({
        scan,
        analysis: {
          ...analysis,
          files: analysis.files.map((file, index) =>
            index === 0 ? { ...file, fileId: 'missing' } : file,
          ),
        },
        resolution,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'ANALYSIS_FILE_NOT_SCANNED' }),
    );
  });
});

function file(
  relativePath: string,
  language: SupportedLanguage,
): RepositoryScan['files'][number] {
  return {
    id: relativePath,
    relativePath,
    absolutePath: `/repo/${relativePath}`,
    extension: `.${relativePath.split('.').at(-1) ?? ''}`,
    language,
    sizeBytes: 1,
    contentHash: `hash-${relativePath}`,
    lastModified: new Date(0),
  };
}

function location(line: number) {
  return {
    startLine: line,
    startColumn: 0,
    endLine: line,
    endColumn: 1,
  } as const;
}
