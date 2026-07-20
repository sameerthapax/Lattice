import {
  RepositoryNotFoundError,
  SupportedLanguage,
  type RepositoryScan,
} from '@lattice/core-indexer';
import { describe, expect, it, vi } from 'vitest';

import { formatScanSummary, runCli, type CliDependencies } from './cli';

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
      'Usage: lattice index [repository-path]',
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

function createDependencies(): CliDependencies {
  const times = [1_000, 1_812];
  return {
    currentDirectory: vi.fn(() => '/current'),
    nowMilliseconds: vi.fn(() => times.shift() ?? 1_812),
    scan: vi.fn(async () => scan),
    writeError: vi.fn(),
    writeOutput: vi.fn(),
  };
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
