import { resolveRepositoryAnalysis } from '@lattice/core-analyzer';
import {
  RepositoryNotFoundError,
  SupportedLanguage,
  type RepositoryScan,
} from '@lattice/core-indexer';
import type { RepositoryAnalysis } from '@lattice/core-parser';
import { buildRepositoryKnowledge } from '@lattice/core-knowledge';
import { NodeRepositoryFileSystem } from '@lattice/filesystem';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAnalyzeJsonOutput,
  serializeAnalyzeJson,
  SYMBOL_KINDS,
} from './analyze-output';
import {
  formatAnalysisSummary,
  formatScanSummary,
  runCli,
  type CliDependencies,
} from './cli';

const scan: RepositoryScan = {
  rootPath: '/repository',
  scannedAt: new Date('2026-07-20T12:00:00.000Z'),
  totalFiles: 3,
  totalDirectories: 2,
  totalIgnoredEntries: 4,
  files: [
    createFile('README.md', SupportedLanguage.Markdown),
    createFile('src/app.ts', SupportedLanguage.TypeScript),
    createFile('src/tool.ts', SupportedLanguage.TypeScript),
  ],
};

const analysis: RepositoryAnalysis = {
  rootPath: '/repository',
  analyzedAt: new Date('2026-07-20T12:00:01.000Z'),
  scannedFileCount: 3,
  parsedFileCount: 2,
  skippedFileCount: 1,
  failedFileCount: 0,
  files: [
    {
      fileId: 'src/app.ts',
      relativePath: 'src/app.ts',
      language: 'TypeScript',
      contentHash: 'hash',
      symbols: [
        {
          id: 'symbol',
          name: 'run',
          qualifiedName: 'run',
          kind: 'function',
          fileId: 'src/app.ts',
          parentSymbolId: null,
          exported: true,
          async: false,
          location: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 17 },
        },
      ],
      imports: [
        {
          id: 'import',
          fileId: 'src/app.ts',
          source: './dependency',
          kind: 'named',
          importedName: 'dependency',
          localName: 'dependency',
          typeOnly: false,
          location: {
            startLine: 1,
            startColumn: 0,
            endLine: 1,
            endColumn: 40,
          },
        },
      ],
      exports: [
        {
          id: 'export',
          fileId: 'src/app.ts',
          kind: 'named',
          exportedName: 'run',
          localName: 'run',
          source: null,
          symbolId: 'symbol',
          typeOnly: false,
          location: {
            startLine: 2,
            startColumn: 0,
            endLine: 2,
            endColumn: 24,
          },
        },
      ],
      diagnostics: [],
    },
    {
      fileId: 'src/tool.ts',
      relativePath: 'src/tool.ts',
      language: 'TypeScript',
      contentHash: 'hash',
      symbols: [],
      imports: [],
      exports: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'TREE_SITTER_SYNTAX_ERROR',
          message: 'Invalid syntax.',
          location: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
        },
      ],
    },
  ],
  failures: [],
};

const resolution = resolveRepositoryAnalysis({ scan, analysis });

describe('runCli', () => {
  it('indexes the current directory when no path is supplied', async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(['index'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '/current' });
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      expect.stringContaining('Repository scanned successfully'),
    );
  });

  it('indexes an explicitly supplied repository path', async () => {
    const dependencies = createDependencies();

    await runCli(['index', '../project'], dependencies);

    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '../project' });
  });

  it('analyzes the current directory when no path is supplied', async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(['analyze'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '/current' });
    expect(dependencies.analyze).toHaveBeenCalledWith({
      scan,
      fileSystem: dependencies.fileSystem,
    });
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      expect.stringContaining('Repository analyzed successfully'),
    );
  });

  it('generates a graph artifact at the default repository output', async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(['graph', '/repository'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.writeGraphArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryRoot: '/repository',
        pretty: false,
        artifact: expect.objectContaining({
          artifactKind: 'repository-graph',
          schemaVersion: '1',
        }),
      }),
    );
    expect(getWrittenOutput(dependencies)).toContain(
      'Output: /repository/.lattice/graph.json',
    );
  });

  it('parses graph view, output, target, limits, and pretty options', async () => {
    const dependencies = createDependencies();

    await runCli(
      [
        'graph',
        '/repository',
        '--output',
        '.lattice/files.json',
        '--view',
        'file-dependencies',
        '--max-nodes',
        '10',
        '--max-relations',
        '20',
        '--pretty',
      ],
      dependencies,
    );

    expect(dependencies.writeGraphArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        outputPath: '.lattice/files.json',
        pretty: true,
        artifact: expect.objectContaining({
          view: expect.objectContaining({
            kind: 'file-dependencies',
            maxNodes: 10,
            maxRelations: 20,
          }),
        }),
      }),
    );
  });

  it('rejects unsupported graph views and invalid graph limits', async () => {
    const unsupported = createDependencies();
    const invalidLimit = createDependencies();

    expect(await runCli(['graph', '--view', 'runtime-flow'], unsupported)).toBe(
      1,
    );
    expect(await runCli(['graph', '--max-nodes', 'many'], invalidLimit)).toBe(
      1,
    );
    expect(unsupported.scan).not.toHaveBeenCalled();
    expect(invalidLimit.scan).not.toHaveBeenCalled();
  });

  it('analyzes an explicitly supplied repository path', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '../project'], dependencies);

    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '../project' });
  });

  it('emits valid JSON for an explicit repository path', async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(['analyze', '.', '--json'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '.' });
    const output = getWrittenOutput(dependencies);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: '3',
      command: 'analyze',
      summary: {
        scannedFileCount: 3,
        parsedFileCount: 2,
        skippedFileCount: 1,
        failedFileCount: 0,
        filesWithSyntaxErrors: 1,
        symbolCount: 1,
        importCount: 1,
        exportCount: 1,
      },
    });
  });

  it('emits a deterministic source-disabled file context package', async () => {
    const dependencies = createDependencies();
    const exitCode = await runCli(
      ['context', '--file', 'src/app.ts', '--no-source', '--json'],
      dependencies,
    );
    expect(exitCode).toBe(0);
    const output = getWrittenOutput(dependencies);
    expect(output.endsWith('\n')).toBe(true);
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: '1',
      target: { kind: 'file', relativePath: 'src/app.ts' },
      excerpts: [],
    });
    expect(output).not.toContain('absolutePath');
    expect(dependencies.writeError).not.toHaveBeenCalled();
  });

  it('requires exactly one context target', async () => {
    const dependencies = createDependencies();
    expect(await runCli(['context', '--json'], dependencies)).toBe(1);
    expect(dependencies.writeError).toHaveBeenCalledWith(
      expect.stringContaining('Usage: lattice context'),
    );
  });

  it('defaults JSON analysis to the current directory', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '--json'], dependencies);

    expect(dependencies.scan).toHaveBeenCalledWith({ rootPath: '/current' });
  });

  it('emits JSON only with exactly one trailing newline', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '--json'], dependencies);

    const output = getWrittenOutput(dependencies);
    expect(output).not.toContain('Repository analyzed successfully');
    expect(output).not.toContain('\nSymbols\n');
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  it('includes every detailed analysis collection without nondeterministic fields', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '--json'], dependencies);

    const output = getWrittenOutput(dependencies);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const outputAnalysis = parsed['analysis'] as {
      readonly files: readonly Record<string, unknown>[];
      readonly failures: readonly unknown[];
    };
    expect(outputAnalysis.failures).toEqual([]);
    expect(outputAnalysis.files[0]).toMatchObject({
      fileId: 'src/app.ts',
      relativePath: 'src/app.ts',
      symbols: expect.any(Array),
      imports: expect.any(Array),
      exports: expect.any(Array),
      diagnostics: expect.any(Array),
    });
    expect(outputAnalysis.files[1]).toMatchObject({
      diagnostics: [
        expect.objectContaining({ code: 'TREE_SITTER_SYNTAX_ERROR' }),
      ],
    });
    expect(output).not.toContain('analyzedAt');
    expect(output).not.toContain('duration');
  });

  it('keeps per-file failures in JSON while returning success', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.scan).mockResolvedValue({
      ...scan,
      totalFiles: 4,
      files: [
        ...scan.files,
        {
          ...createFile('src/missing.ts', SupportedLanguage.TypeScript),
          id: 'missing-file',
        },
      ],
    });
    vi.mocked(dependencies.analyze).mockResolvedValue({
      ...analysis,
      failedFileCount: 1,
      failures: [
        {
          fileId: 'missing-file',
          relativePath: 'src/missing.ts',
          code: 'SOURCE_READ_FAILED',
          message: 'Could not read source file: src/missing.ts',
        },
      ],
    });

    const exitCode = await runCli(['analyze', '--json'], dependencies);
    const parsed = JSON.parse(getWrittenOutput(dependencies)) as {
      readonly summary: { readonly failedFileCount: number };
      readonly analysis: { readonly failures: readonly unknown[] };
    };

    expect(exitCode).toBe(0);
    expect(parsed.summary.failedFileCount).toBe(1);
    expect(parsed.analysis.failures).toEqual([
      expect.objectContaining({
        relativePath: 'src/missing.ts',
        code: 'SOURCE_READ_FAILED',
      }),
    ]);
  });

  it('writes repository-level JSON mode failures only to stderr', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.scan).mockRejectedValue(
      new RepositoryNotFoundError('/missing'),
    );

    const exitCode = await runCli(
      ['analyze', '/missing', '--json'],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.writeOutput).not.toHaveBeenCalled();
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Repository path does not exist: /missing',
    );
  });

  it('rejects unknown and misplaced flags', async () => {
    const dependencies = createDependencies();

    await expect(runCli(['analyze', '.', '--xml'], dependencies)).resolves.toBe(
      1,
    );
    await expect(runCli(['index', '.', '--json'], dependencies)).resolves.toBe(
      1,
    );

    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Unknown option: --xml\nUsage: lattice analyze [repository-path] [--json]',
    );
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Unknown option: --json\nUsage: lattice index [repository-path]',
    );
    expect(dependencies.scan).not.toHaveBeenCalled();
  });

  it('preserves the exact human-readable analyze output', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '.'], dependencies);

    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      expect.stringContaining(
        'Repository knowledge\nProjects: 0\nFolders: 1\nFiles: 3',
      ),
    );
  });

  it('produces byte-for-byte identical JSON for identical analysis', async () => {
    const firstDependencies = createDependencies();
    const secondDependencies = createDependencies();

    await runCli(['analyze', '--json'], firstDependencies);
    await runCli(['analyze', '--json'], secondDependencies);

    expect(getWrittenOutput(firstDependencies)).toBe(
      getWrittenOutput(secondDependencies),
    );
  });

  it('uses fixed symbol summary key order and excludes sensitive file data', async () => {
    const dependencies = createDependencies();

    await runCli(['analyze', '--json'], dependencies);

    const output = getWrittenOutput(dependencies);
    const parsed = JSON.parse(output) as {
      readonly summary: { readonly symbolsByKind: Record<string, number> };
    };
    expect(Object.keys(parsed.summary.symbolsByKind)).toEqual(SYMBOL_KINDS);
    expect(output).not.toContain('absolutePath');
    expect(output).not.toContain('/repository/src/app.ts');
    expect(output).not.toContain('SUPER_SECRET_SOURCE_TEXT');
  });

  it('prints an actionable domain error for an invalid path', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.scan).mockRejectedValue(
      new RepositoryNotFoundError('/missing'),
    );

    const exitCode = await runCli(['index', '/missing'], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Repository path does not exist: /missing',
    );
  });

  it('rejects unsupported commands and extra arguments', async () => {
    const dependencies = createDependencies();

    await expect(runCli(['scan'], dependencies)).resolves.toBe(1);
    await expect(runCli(['index', '.', 'extra'], dependencies)).resolves.toBe(
      1,
    );
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Usage: lattice <index|analyze|context|graph> [repository-path]',
    );
  });

  it('returns a nonzero exit code for an invalid analysis path', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.scan).mockRejectedValue(
      new RepositoryNotFoundError('/missing'),
    );

    const exitCode = await runCli(['analyze', '/missing'], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.writeError).toHaveBeenCalledWith(
      'Repository path does not exist: /missing',
    );
  });

  it('reports isolated parse failures without failing the command', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.scan).mockResolvedValue({
      ...scan,
      totalFiles: 4,
      files: [
        ...scan.files,
        createFile('src/missing.ts', SupportedLanguage.TypeScript),
      ],
    });
    vi.mocked(dependencies.analyze).mockResolvedValue({
      ...analysis,
      failedFileCount: 1,
      failures: [
        {
          fileId: 'src/missing.ts',
          relativePath: 'src/missing.ts',
          code: 'SOURCE_READ_FAILED',
          message: 'Could not read source file: src/missing.ts',
        },
      ],
    });

    const exitCode = await runCli(['analyze', '.'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      expect.stringContaining('Parse failures: 1'),
    );
  });
});

describe('formatScanSummary', () => {
  it('formats stable language counts and duration', () => {
    expect(formatScanSummary(scan, 0.812)).toBe(
      [
        'Repository scanned successfully',
        'Directories: 2',
        'Files: 3',
        'Languages',
        'Markdown: 1',
        'TypeScript: 2',
        'Ignored: 4',
        'Duration: 0.81s',
      ].join('\n'),
    );
  });
});

describe('formatAnalysisSummary', () => {
  it('prints every symbol category and stable aggregate counts', () => {
    expect(formatAnalysisSummary(analysis, 0.812)).toBe(
      [
        'Repository analyzed successfully',
        'Files scanned: 3',
        'Files parsed: 2',
        'Files skipped: 1',
        'Parse failures: 0',
        'Symbols',
        'Functions: 1',
        'Classes: 0',
        'Methods: 0',
        'Constructors: 0',
        'Interfaces: 0',
        'Type aliases: 0',
        'Enums: 0',
        'Variables: 0',
        'Imports: 1',
        'Exports: 1',
        'Files with syntax errors: 1',
        'Module resolution',
        'Internal dependencies: 0',
        'External dependencies: 0',
        'Resolved symbol bindings: 0',
        'Unresolved dependencies: 1',
        'Dependency cycles: 0',
        'Use --json to inspect unresolved dependencies.',
        'Repository knowledge',
        'Projects: 0',
        'Folders: 1',
        'Files: 2',
        'Symbols: 1',
        'Public file symbols: 1',
        'Public project symbols: 0',
        'Cross-project dependencies: 0',
        'Orphan source files: 2',
        'Duration: 0.81s',
      ].join('\n'),
    );
  });
});

describe('module resolution output', () => {
  it('prints counts and omits the unresolved hint when resolution is complete', () => {
    const empty = resolveRepositoryAnalysis({
      scan: { ...scan, totalFiles: 0, files: [] },
      analysis: {
        ...analysis,
        scannedFileCount: 0,
        parsedFileCount: 0,
        skippedFileCount: 0,
        files: [],
      },
    });
    const output = formatAnalysisSummary(
      {
        ...analysis,
        scannedFileCount: 0,
        parsedFileCount: 0,
        skippedFileCount: 0,
        files: [],
      },
      0,
      empty,
    );
    expect(output).toContain('Unresolved dependencies: 0');
    expect(output).not.toContain('Use --json');
  });

  it('includes the schema-version-3 resolution section and fixed summary field order', async () => {
    const dependencies = createDependencies();
    await runCli(['analyze', '--json'], dependencies);
    const parsed = JSON.parse(getWrittenOutput(dependencies)) as {
      readonly resolution: Record<string, unknown>;
      readonly summary: Record<string, unknown>;
    };
    expect(Object.keys(parsed.resolution)).toEqual([
      'modules',
      'dependencies',
      'externalDependencies',
      'symbolBindings',
      'unresolvedDependencies',
      'cycles',
    ]);
    expect(Object.keys(parsed.summary).slice(-6)).toEqual([
      'knowledgeFileCount',
      'publicFileSymbolCount',
      'publicProjectSymbolCount',
      'crossProjectDependencyCount',
      'orphanFileCount',
      'symbolsByKind',
    ]);
  });
});

describe('serializeAnalyzeJson', () => {
  it('uses the exact versioned property order and one trailing newline', () => {
    const emptyAnalysis: RepositoryAnalysis = {
      rootPath: '/repository',
      analyzedAt: new Date('2099-01-01T00:00:00.000Z'),
      scannedFileCount: 0,
      parsedFileCount: 0,
      skippedFileCount: 0,
      failedFileCount: 0,
      files: [],
      failures: [],
    };

    const emptyResolution = resolveRepositoryAnalysis({
      scan: { ...scan, totalFiles: 0, files: [] },
      analysis: emptyAnalysis,
    });
    const emptyScan = { ...scan, totalFiles: 0, files: [] };
    const output = serializeAnalyzeJson(
      buildAnalyzeJsonOutput(
        emptyAnalysis,
        emptyResolution,
        buildRepositoryKnowledge({
          scan: emptyScan,
          analysis: emptyAnalysis,
          resolution: emptyResolution,
        }),
      ),
    );
    expect(output.startsWith('{\n  "schemaVersion": "3",\n')).toBe(true);
    expect(output).toContain('\n  "knowledge": {\n');
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });
});

function createDependencies(): CliDependencies {
  const times = [1_000, 1_812];
  return {
    analyze: vi.fn(async () => analysis),
    currentDirectory: vi.fn(() => '/current'),
    fileSystem: new NodeRepositoryFileSystem(),
    loadAliases: vi.fn(async () => []),
    nowMilliseconds: vi.fn(() => times.shift() ?? 1_812),
    scan: vi.fn(async () => scan),
    resolve: vi.fn(() => resolution),
    writeError: vi.fn(),
    writeOutput: vi.fn(),
    writeGraphArtifact: vi.fn(async ({ repositoryRoot, outputPath }) =>
      outputPath
        ? `${repositoryRoot}/${outputPath}`
        : `${repositoryRoot}/.lattice/graph.json`,
    ),
  };
}

function getWrittenOutput(dependencies: CliDependencies): string {
  const call = vi.mocked(dependencies.writeOutput).mock.calls[0];
  const output = call?.[0];
  if (output === undefined) {
    throw new Error('Expected CLI output to be written.');
  }
  return output;
}

function createFile(
  relativePath: string,
  language: SupportedLanguage,
): RepositoryScan['files'][number] {
  return {
    id: relativePath,
    relativePath,
    absolutePath: `/repository/${relativePath}`,
    extension: `.${relativePath.split('.').at(-1) ?? ''}`,
    language,
    sizeBytes: 1,
    contentHash: 'hash',
    lastModified: new Date('2026-07-20T12:00:00.000Z'),
  };
}
