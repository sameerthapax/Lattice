import { describe, expect, it } from 'vitest';
import { SupportedLanguage } from '@lattice/core-indexer';
import { buildRepositoryKnowledge } from '@lattice/core-knowledge';
import { createHash } from 'node:crypto';
import { buildContextPackage } from './build-context-package';
import { ContextTargetNotFoundError } from './errors';
import type { BuildContextPackageInput } from './models';

const date = new Date('2026-07-20T00:00:00Z');
const hash = (content: string): string =>
  createHash('sha256').update(content).digest('hex');
function fixture(): BuildContextPackageInput {
  return {
    scan: {
      rootPath: '/repo',
      scannedAt: date,
      totalFiles: 1,
      totalDirectories: 1,
      totalIgnoredEntries: 0,
      files: [
        {
          id: 'file-a',
          relativePath: 'src/a.ts',
          absolutePath: '/repo/src/a.ts',
          extension: '.ts',
          language: SupportedLanguage.TypeScript,
          sizeBytes: 18,
          contentHash:
            'd4f7d2d43f6f2747da5a586d872bb11c86f2fca798bd6c23f2d606cc83b9eeef',
          lastModified: date,
        },
      ],
    },
    analysis: {
      rootPath: '/repo',
      analyzedAt: date,
      scannedFileCount: 1,
      parsedFileCount: 1,
      skippedFileCount: 0,
      failedFileCount: 0,
      files: [
        {
          fileId: 'file-a',
          relativePath: 'src/a.ts',
          language: 'TypeScript',
          contentHash:
            'd4f7d2d43f6f2747da5a586d872bb11c86f2fca798bd6c23f2d606cc83b9eeef',
          symbols: [],
          imports: [],
          exports: [],
          diagnostics: [],
        },
      ],
      failures: [],
    },
    resolution: {
      rootPath: '/repo',
      scannedFileCount: 1,
      parsedFileCount: 1,
      modules: [
        {
          fileId: 'file-a',
          relativePath: 'src/a.ts',
          language: 'TypeScript',
          imports: [],
          exports: [],
          incomingDependencyIds: [],
          outgoingDependencyIds: [],
        },
      ],
      dependencies: [],
      externalDependencies: [],
      symbolBindings: [],
      unresolvedDependencies: [],
      cycles: [],
    },
    knowledge: {
      repository: {
        id: 'knowledge:v1:repository:r',
        kind: 'repository',
        name: 'repo',
        qualifiedName: 'repo',
        rootPath: '/repo',
        projectIds: [],
        topLevelFolderIds: ['folder-src'],
        fileIds: ['node-file-a'],
      },
      projects: [],
      folders: [
        {
          id: 'folder-src',
          kind: 'folder',
          name: 'src',
          qualifiedName: 'src',
          relativePath: 'src',
          parentFolderId: null,
          projectId: null,
          childFolderIds: [],
          fileIds: ['node-file-a'],
          descendantFileCount: 1,
          descendantSymbolCount: 0,
        },
      ],
      files: [
        {
          id: 'node-file-a',
          kind: 'file',
          name: 'a.ts',
          qualifiedName: 'src/a.ts',
          fileId: 'file-a',
          relativePath: 'src/a.ts',
          folderId: 'folder-src',
          projectId: null,
          language: 'TypeScript',
          contentHash:
            'd4f7d2d43f6f2747da5a586d872bb11c86f2fca798bd6c23f2d606cc83b9eeef',
          status: 'parsed',
          symbolIds: [],
          publicSymbolIds: [],
          importCount: 0,
          exportCount: 0,
          internalDependencyCount: 0,
          externalDependencyCount: 0,
          incomingFileDependencyIds: [],
          outgoingFileDependencyIds: [],
          diagnosticCount: 0,
          hasSyntaxErrors: false,
          orphan: true,
        },
      ],
      symbols: [],
      relations: [
        {
          id: 'contains-file',
          kind: 'contains',
          sourceNodeId: 'folder-src',
          targetNodeId: 'node-file-a',
          sourceEntityId: null,
          metadata: null,
        },
      ],
      projectDependencies: [],
      summaries: {
        projectCount: 0,
        folderCount: 1,
        fileCount: 1,
        parsedFileCount: 1,
        symbolCount: 0,
        publicFileSymbolCount: 0,
        publicProjectSymbolCount: 0,
        internalFileDependencyCount: 0,
        crossProjectDependencyCount: 0,
        orphanFileCount: 1,
        rootFileCount: 0,
      },
    },
    target: { kind: 'file', relativePath: 'src\\a.ts' },
    options: { includeSource: false },
  };
}

function richFixture(
  target: BuildContextPackageInput['target'],
  options: BuildContextPackageInput['options'] = { includeSource: false },
): BuildContextPackageInput {
  const sources: Readonly<Record<string, string>> = {
    'apps/app/src/main.ts':
      "import { helper } from '../../../libs/lib/src/index';\nexport function publicMain() { return helper(); }\nfunction privateMain() { return 1; }\n",
    'apps/app/src/main.spec.ts':
      "import { publicMain } from './main';\nfunction unrelatedTestHelper() { return publicMain(); }\n",
    'libs/lib/src/index.ts':
      'export function helper() { return 1; }\nfunction privateHelper() { return 2; }\n',
    'libs/lib/src/deep/other.ts': 'export function other() { return 3; }\n',
    'apps/app/project.json': '{"name":"app"}\n',
  };
  const files = Object.entries(sources).map(([relativePath, content]) => ({
    id: relativePath,
    relativePath,
    absolutePath: `/repo/${relativePath}`,
    extension: relativePath.endsWith('.json') ? '.json' : '.ts',
    language: relativePath.endsWith('.json')
      ? SupportedLanguage.JSON
      : SupportedLanguage.TypeScript,
    sizeBytes: content.length,
    contentHash: hash(content),
    lastModified: date,
  }));
  const scan: BuildContextPackageInput['scan'] = {
    rootPath: '/repo',
    scannedAt: date,
    totalFiles: files.length,
    totalDirectories: 7,
    totalIgnoredEntries: 0,
    files,
  };
  const location = (line: number) => ({
    startLine: line,
    startColumn: 0,
    endLine: line,
    endColumn: 40,
  });
  const analysis: BuildContextPackageInput['analysis'] = {
    rootPath: '/repo',
    analyzedAt: date,
    scannedFileCount: files.length,
    parsedFileCount: 4,
    skippedFileCount: 1,
    failedFileCount: 0,
    failures: [],
    files: [
      {
        fileId: 'apps/app/src/main.ts',
        relativePath: 'apps/app/src/main.ts',
        language: 'TypeScript',
        contentHash: hash(sources['apps/app/src/main.ts'] ?? ''),
        symbols: [
          {
            id: 's-public',
            name: 'publicMain',
            qualifiedName: 'publicMain',
            kind: 'function',
            fileId: 'apps/app/src/main.ts',
            parentSymbolId: null,
            exported: true,
            async: false,
            location: location(2),
          },
          {
            id: 's-private',
            name: 'privateMain',
            qualifiedName: 'privateMain',
            kind: 'function',
            fileId: 'apps/app/src/main.ts',
            parentSymbolId: null,
            exported: false,
            async: false,
            location: location(3),
          },
        ],
        imports: [
          {
            id: 'i-helper',
            fileId: 'apps/app/src/main.ts',
            source: '../../../libs/lib/src/index',
            kind: 'named',
            importedName: 'helper',
            localName: 'helper',
            typeOnly: false,
            location: location(1),
          },
        ],
        exports: [
          {
            id: 'e-public',
            fileId: 'apps/app/src/main.ts',
            kind: 'named',
            exportedName: 'publicMain',
            localName: 'publicMain',
            source: null,
            symbolId: 's-public',
            typeOnly: false,
            location: location(2),
          },
        ],
        diagnostics: [],
      },
      {
        fileId: 'apps/app/src/main.spec.ts',
        relativePath: 'apps/app/src/main.spec.ts',
        language: 'TypeScript',
        contentHash: hash(sources['apps/app/src/main.spec.ts'] ?? ''),
        symbols: [
          {
            id: 's-test-helper',
            name: 'unrelatedTestHelper',
            qualifiedName: 'unrelatedTestHelper',
            kind: 'function',
            fileId: 'apps/app/src/main.spec.ts',
            parentSymbolId: null,
            exported: false,
            async: false,
            location: location(2),
          },
        ],
        imports: [
          {
            id: 'i-main',
            fileId: 'apps/app/src/main.spec.ts',
            source: './main',
            kind: 'named',
            importedName: 'publicMain',
            localName: 'publicMain',
            typeOnly: false,
            location: location(1),
          },
        ],
        exports: [],
        diagnostics: [],
      },
      {
        fileId: 'libs/lib/src/index.ts',
        relativePath: 'libs/lib/src/index.ts',
        language: 'TypeScript',
        contentHash: hash(sources['libs/lib/src/index.ts'] ?? ''),
        symbols: [
          {
            id: 's-helper',
            name: 'helper',
            qualifiedName: 'helper',
            kind: 'function',
            fileId: 'libs/lib/src/index.ts',
            parentSymbolId: null,
            exported: true,
            async: false,
            location: location(1),
          },
          {
            id: 's-private-helper',
            name: 'privateHelper',
            qualifiedName: 'privateHelper',
            kind: 'function',
            fileId: 'libs/lib/src/index.ts',
            parentSymbolId: null,
            exported: false,
            async: false,
            location: location(2),
          },
        ],
        imports: [],
        exports: [
          {
            id: 'e-helper',
            fileId: 'libs/lib/src/index.ts',
            kind: 'named',
            exportedName: 'helper',
            localName: 'helper',
            source: null,
            symbolId: 's-helper',
            typeOnly: false,
            location: location(1),
          },
        ],
        diagnostics: [],
      },
      {
        fileId: 'libs/lib/src/deep/other.ts',
        relativePath: 'libs/lib/src/deep/other.ts',
        language: 'TypeScript',
        contentHash: hash(sources['libs/lib/src/deep/other.ts'] ?? ''),
        symbols: [
          {
            id: 's-other',
            name: 'other',
            qualifiedName: 'other',
            kind: 'function',
            fileId: 'libs/lib/src/deep/other.ts',
            parentSymbolId: null,
            exported: true,
            async: false,
            location: location(1),
          },
        ],
        imports: [],
        exports: [
          {
            id: 'e-other',
            fileId: 'libs/lib/src/deep/other.ts',
            kind: 'named',
            exportedName: 'other',
            localName: 'other',
            source: null,
            symbolId: 's-other',
            typeOnly: false,
            location: location(1),
          },
        ],
        diagnostics: [],
      },
    ],
  };
  const resolution: BuildContextPackageInput['resolution'] = {
    rootPath: '/repo',
    scannedFileCount: files.length,
    parsedFileCount: 4,
    modules: analysis.files.map((file) => ({
      fileId: file.fileId,
      relativePath: file.relativePath,
      language: file.language,
      imports: [],
      exports: file.exports.map((item) => ({
        exportId: item.id,
        sourceFileId: file.fileId,
        exportedName: item.exportedName,
        typeOnly: item.typeOnly,
        localSymbolId: item.symbolId,
        targetFileId: null,
        targetExportId: null,
        targetSymbolId: item.symbolId,
        status: 'local-symbol' as const,
      })),
      incomingDependencyIds: [],
      outgoingDependencyIds: [],
    })),
    dependencies: [
      {
        id: 'd-main-lib',
        sourceFileId: 'apps/app/src/main.ts',
        targetFileId: 'libs/lib/src/index.ts',
        sourceSpecifier: '../../../libs/lib/src/index',
        kind: 'import',
        typeOnly: false,
      },
      {
        id: 'd-test-main',
        sourceFileId: 'apps/app/src/main.spec.ts',
        targetFileId: 'apps/app/src/main.ts',
        sourceSpecifier: './main',
        kind: 'import',
        typeOnly: false,
      },
    ],
    externalDependencies: [],
    symbolBindings: [
      {
        id: 'b-helper',
        kind: 'named-import',
        sourceFileId: 'apps/app/src/main.ts',
        sourceEntityId: 'i-helper',
        targetFileId: 'libs/lib/src/index.ts',
        targetExportId: 'e-helper',
        targetSymbolId: 's-helper',
        importedName: 'helper',
        localName: 'helper',
      },
      {
        id: 'b-main',
        kind: 'named-import',
        sourceFileId: 'apps/app/src/main.spec.ts',
        sourceEntityId: 'i-main',
        targetFileId: 'apps/app/src/main.ts',
        targetExportId: 'e-public',
        targetSymbolId: 's-public',
        importedName: 'publicMain',
        localName: 'publicMain',
      },
    ],
    unresolvedDependencies: [],
    cycles: [],
  };
  const knowledge = buildRepositoryKnowledge({
    scan,
    analysis,
    resolution,
    projects: [
      {
        name: 'app',
        kind: 'application',
        rootRelativePath: 'apps/app',
        sourceRootRelativePath: 'apps/app/src',
        entryPoints: [{ relativePath: 'apps/app/src/main.ts' }],
      },
      {
        name: 'lib',
        kind: 'library',
        rootRelativePath: 'libs/lib',
        sourceRootRelativePath: 'libs/lib/src',
        entryPoints: [{ relativePath: 'libs/lib/src/index.ts' }],
      },
    ],
  });
  return {
    scan,
    analysis,
    resolution,
    knowledge,
    target,
    options,
    sourceProvider:
      options?.includeSource === false
        ? undefined
        : {
            readSource: async ({ fileId, relativePath }) => ({
              fileId,
              relativePath,
              contentHash: hash(sources[relativePath] ?? ''),
              content: sources[relativePath] ?? '',
            }),
          },
  };
}

describe('buildContextPackage', () => {
  it('resolves normalized file paths and is deeply deterministic', async () => {
    const input = fixture();
    const first = await buildContextPackage(input);
    const second = await buildContextPackage(input);
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('1');
    expect(first.target.fileId).toBe('file-a');
    expect(first.entities.files[0]?.selectionReasons).toEqual(['target']);
    expect(first.omissions).toContainEqual(
      expect.objectContaining({ reason: 'SOURCE_DISABLED' }),
    );
  });
  it('rejects invalid limits with a stable reason', async () => {
    await expect(
      buildContextPackage({
        ...fixture(),
        options: { includeSource: false, maxFiles: -1 },
      }),
    ).rejects.toMatchObject({
      reason: 'INVALID_OPTIONS',
    });
  });
  it('rejects missing targets with a typed error', async () => {
    await expect(
      buildContextPackage({
        ...fixture(),
        target: { kind: 'file', relativePath: 'missing.ts' },
      }),
    ).rejects.toBeInstanceOf(ContextTargetNotFoundError);
  });
  it('requires a source provider when source is enabled', async () => {
    await expect(
      buildContextPackage({ ...fixture(), options: { includeSource: true } }),
    ).rejects.toMatchObject({
      reason: 'SOURCE_PROVIDER_REQUIRED',
    });
  });

  it('selects target-file declarations, exports, and bound symbols first', async () => {
    const package_ = await buildContextPackage(
      richFixture(
        { kind: 'file', relativePath: 'apps/app/src/main.ts' },
        { includeSource: false, maxSymbols: 3 },
      ),
    );
    expect(package_.entities.symbols.map((symbol) => symbol.name)).toEqual([
      'publicMain',
      'privateMain',
      'helper',
    ]);
    expect(
      package_.entities.symbols.map((symbol) => symbol.selectionReasons),
    ).toEqual([['target-export'], ['same-file-symbol'], ['bound-symbol']]);
  });

  it('derives symbol-backed excerpts only from selected symbols', async () => {
    const package_ = await buildContextPackage(
      richFixture(
        { kind: 'file', relativePath: 'apps/app/src/main.ts' },
        { includeSource: true, maxExcerpts: 2, maxSymbols: 2 },
      ),
    );
    const selected = new Set(
      package_.entities.symbols.map((symbol) => symbol.symbolId),
    );
    expect(package_.excerpts).toHaveLength(2);
    expect(
      package_.excerpts.some((excerpt) =>
        excerpt.reasons.includes('target-file-header'),
      ),
    ).toBe(true);
    expect(
      package_.excerpts.some((excerpt) => excerpt.symbolIds.length > 0),
    ).toBe(true);
    for (const excerpt of package_.excerpts)
      for (const symbolId of excerpt.symbolIds)
        expect(selected.has(symbolId)).toBe(true);
  });

  it('keeps the target symbol reason specific and does not annotate binding-file helpers', async () => {
    const package_ = await buildContextPackage(
      richFixture({ kind: 'symbol', symbolId: 's-public' }),
    );
    expect(
      package_.entities.symbols.find((symbol) => symbol.symbolId === 's-public')
        ?.selectionReasons,
    ).toEqual(['target']);
    expect(
      package_.entities.symbols.find(
        (symbol) => symbol.symbolId === 's-private',
      )?.selectionReasons,
    ).toEqual(['same-file-symbol']);
    expect(
      package_.entities.symbols.some(
        (symbol) => symbol.symbolId === 's-test-helper',
      ),
    ).toBe(false);
    expect(
      package_.entities.files.find(
        (file) => file.fileId === 'apps/app/src/main.spec.ts',
      )?.selectionReasons,
    ).toContain('binding-source');
  });

  it('selects adjacent projects and their connecting dependency', async () => {
    const package_ = await buildContextPackage(
      richFixture({ kind: 'project', name: 'app' }),
    );
    expect(package_.entities.projects.map((project) => project.name)).toEqual([
      'app',
      'lib',
    ]);
    expect(package_.relationships.projectDependencies).toHaveLength(1);
    expect(
      package_.entities.files.some(
        (file) => file.fileId === 'libs/lib/src/index.ts',
      ),
    ).toBe(true);
    expect(
      package_.entities.files.filter(
        (file) =>
          file.projectId ===
          package_.entities.projects.find((project) => project.name === 'lib')
            ?.nodeId,
      ),
    ).toHaveLength(1);
  });

  it('selects a directly dependent project without expanding all of its files', async () => {
    const package_ = await buildContextPackage(
      richFixture({ kind: 'project', name: 'lib' }),
    );
    expect(package_.entities.projects.map((project) => project.name)).toEqual([
      'app',
      'lib',
    ]);
    expect(package_.relationships.projectDependencies).toHaveLength(1);
    expect(
      package_.entities.files.filter((file) =>
        file.relativePath.startsWith('apps/app/'),
      ),
    ).toHaveLength(1);
  });

  it('ranks project public and production source before tests and metadata', async () => {
    const package_ = await buildContextPackage(
      richFixture({ kind: 'project', name: 'app' }),
    );
    const paths = package_.entities.files.map((file) => file.relativePath);
    expect(paths.indexOf('apps/app/src/main.ts')).toBeLessThan(
      paths.indexOf('apps/app/src/main.spec.ts'),
    );
    expect(paths.indexOf('apps/app/src/main.spec.ts')).toBeLessThan(
      paths.indexOf('apps/app/project.json'),
    );
    expect(
      package_.entities.files.find(
        (file) => file.fileId === 'apps/app/src/main.ts',
      )?.selectionReasons,
    ).toEqual(['direct-dependency', 'project-public-symbol', 'project-member']);
  });

  it('ranks folder source files before metadata and keeps exact descendant depth', async () => {
    const depthZero = await buildContextPackage(
      richFixture(
        { kind: 'folder', relativePath: 'libs/lib' },
        { includeSource: false, maxFiles: 1, folderDepth: 0 },
      ),
    );
    const depthOne = await buildContextPackage(
      richFixture(
        { kind: 'folder', relativePath: 'libs/lib' },
        { includeSource: false, maxFiles: 1, folderDepth: 1 },
      ),
    );
    const depthTwo = await buildContextPackage(
      richFixture(
        { kind: 'folder', relativePath: 'libs/lib' },
        { includeSource: false, maxFiles: 1, folderDepth: 2 },
      ),
    );
    expect(depthZero.entities.files[0]?.relativePath).toBe(
      'libs/lib/src/index.ts',
    );
    expect(
      depthZero.entities.folders.map((folder) => folder.relativePath),
    ).toEqual(['libs', 'libs/lib', 'libs/lib/src']);
    expect(
      depthOne.entities.folders.map((folder) => folder.relativePath),
    ).toEqual(['libs', 'libs/lib', 'libs/lib/src']);
    expect(
      depthTwo.entities.folders.map((folder) => folder.relativePath),
    ).toEqual(['libs', 'libs/lib', 'libs/lib/src', 'libs/lib/src/deep']);
  });

  it('is unchanged when folder and file inputs are shuffled', async () => {
    const input = richFixture(
      { kind: 'folder', relativePath: 'libs/lib' },
      { includeSource: false, folderDepth: 2 },
    );
    const shuffled = {
      ...input,
      scan: { ...input.scan, files: [...input.scan.files].reverse() },
      analysis: {
        ...input.analysis,
        files: [...input.analysis.files].reverse(),
      },
      knowledge: {
        ...input.knowledge,
        folders: [...input.knowledge.folders].reverse(),
        files: [...input.knowledge.files].reverse(),
        symbols: [...input.knowledge.symbols].reverse(),
        relations: [...input.knowledge.relations].reverse(),
      },
    };
    expect(await buildContextPackage(shuffled)).toEqual(
      await buildContextPackage(input),
    );
  });

  it('prioritizes project dependencies over optional containment under relation limits', async () => {
    const package_ = await buildContextPackage(
      richFixture(
        { kind: 'project', name: 'app' },
        { includeSource: false, maxRelations: 1 },
      ),
    );
    expect(package_.relationships.projectDependencies).toHaveLength(1);
    expect(package_.relationships.containment).toHaveLength(0);
    expect(package_.selection.omittedRelationCount).toBeGreaterThan(0);
  });

  it('preserves a target-file binding before exports and containment', async () => {
    const package_ = await buildContextPackage(
      richFixture(
        { kind: 'file', relativePath: 'apps/app/src/main.ts' },
        { includeSource: false, maxRelations: 3 },
      ),
    );
    expect(package_.relationships.fileDependencies).toHaveLength(2);
    expect(
      package_.relationships.symbolBindings.map((binding) => binding.id),
    ).toEqual(['b-helper']);
    expect(package_.relationships.containment).toHaveLength(0);
  });

  it('keeps repository-wide file metrics stable under restrictive package limits', async () => {
    const broad = await buildContextPackage(
      richFixture(
        { kind: 'file', relativePath: 'apps/app/src/main.ts' },
        { includeSource: false },
      ),
    );
    const narrow = await buildContextPackage(
      richFixture(
        { kind: 'file', relativePath: 'apps/app/src/main.ts' },
        {
          includeSource: false,
          maxFiles: 1,
          maxRelations: 1,
          dependencyDepth: 0,
          dependentDepth: 0,
        },
      ),
    );
    const metrics = (
      package_: Awaited<ReturnType<typeof buildContextPackage>>,
    ) => {
      const file = package_.entities.files.find(
        (item) => item.fileId === 'apps/app/src/main.ts',
      );
      return [
        file?.incomingInternalDependencyCount,
        file?.outgoingInternalDependencyCount,
        file?.externalDependencyCount,
      ];
    };
    expect(metrics(narrow)).toEqual(metrics(broad));
  });

  it('aggregates SOURCE_DISABLED once per selected file and performs no reads', async () => {
    let reads = 0;
    const input = richFixture(
      { kind: 'file', relativePath: 'apps/app/src/main.ts' },
      { includeSource: false, maxFiles: 2 },
    );
    const package_ = await buildContextPackage({
      ...input,
      sourceProvider: {
        readSource: async () => {
          reads += 1;
          throw new Error('must not read');
        },
      },
    });
    expect(reads).toBe(0);
    expect(
      package_.omissions.find(
        (omission) => omission.reason === 'SOURCE_DISABLED',
      )?.count,
    ).toBe(package_.entities.files.length);
  });
});
