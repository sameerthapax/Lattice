import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  FileSystemAccessError,
  NodeRepositoryFileSystem,
} from '@lattice/filesystem';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InvalidRepositoryError,
  PermissionDeniedError,
  RepositoryNotFoundError,
  RepositoryScanError,
} from './errors';
import { detectLanguage, SupportedLanguage } from './language';
import { RepositoryScanner, scanRepository } from './repository-scanner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('RepositoryScanner', () => {
  it('scans an existing repository and nested directories', async () => {
    const rootPath = await createRepository({
      'README.md': '# Project',
      'src/index.ts': 'export const value = 1;\n',
      'src/nested/tool.py': 'value = 1\n',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.rootPath).toBe(await realpath(rootPath));
    expect(scan.totalDirectories).toBe(2);
    expect(scan.totalFiles).toBe(3);
    expect(scan.files.map((file) => file.relativePath)).toEqual([
      'README.md',
      'src/index.ts',
      'src/nested/tool.py',
    ]);
    expect(scan.files[1]).toMatchObject({
      extension: '.ts',
      language: SupportedLanguage.TypeScript,
      sizeBytes: Buffer.byteLength('export const value = 1;\n'),
    });
  });

  it('returns an empty scan for an empty repository', async () => {
    const rootPath = await createRepository({});

    const scan = await scanRepository({ rootPath });

    expect(scan).toMatchObject({
      rootPath: await realpath(rootPath),
      totalDirectories: 0,
      totalFiles: 0,
      totalIgnoredEntries: 0,
      files: [],
    });
  });

  it('throws a domain error when the repository is missing', async () => {
    const rootPath = path.join(tmpdir(), `missing-lattice-${Date.now()}`);

    await expect(scanRepository({ rootPath })).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    );
  });

  it('throws a domain error when the repository path is a file', async () => {
    const rootPath = await createRepository({ 'file.txt': 'content' });

    await expect(
      scanRepository({ rootPath: path.join(rootPath, 'file.txt') }),
    ).rejects.toBeInstanceOf(InvalidRepositoryError);
  });

  it('wraps permission failures in a domain error', async () => {
    class PermissionDeniedFileSystem extends NodeRepositoryFileSystem {
      public override async getMetadata(): Promise<never> {
        throw new FileSystemAccessError('denied', 'permission-denied');
      }
    }

    const scanner = new RepositoryScanner(new PermissionDeniedFileSystem());

    await expect(
      scanner.scan({ rootPath: '/repository' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('rejects an invalid maximum file size', async () => {
    const rootPath = await createRepository({});

    await expect(
      scanRepository({ rootPath, maxFileSizeBytes: -1 }),
    ).rejects.toBeInstanceOf(RepositoryScanError);
  });

  it('always excludes hardcoded folders and files', async () => {
    const rootPath = await createRepository({
      '.DS_Store': 'metadata',
      '.env': 'SECRET=value',
      '.git/config': 'config',
      '.lattice/cache.json': '{}',
      '.latticeignore': '!node_modules/\n',
      'dist/output.js': 'generated',
      'node_modules/package/index.js': 'dependency',
      'src/index.ts': 'source',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      '.latticeignore',
      'src/index.ts',
    ]);
    expect(scan.totalIgnoredEntries).toBe(6);
  });

  it('respects gitignore patterns and negations', async () => {
    const rootPath = await createRepository({
      '.gitignore': '*.log\nlogs/\n!keep.log\n',
      'debug.log': 'ignored',
      'keep.log': 'kept',
      'logs/app.txt': 'ignored directory',
      'src/app.ts': 'kept',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      '.gitignore',
      'keep.log',
      'src/app.ts',
    ]);
  });

  it('respects root-anchored gitignore patterns', async () => {
    const rootPath = await createRepository({
      '.gitignore': '/root.txt\n',
      'nested/root.txt': 'kept',
      'root.txt': 'ignored',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      '.gitignore',
      'nested/root.txt',
    ]);
  });

  it('applies latticeignore after gitignore', async () => {
    const rootPath = await createRepository({
      '.gitignore': '*.ts\n',
      '.latticeignore': '!keep.ts\nnotes/**\n',
      'drop.ts': 'ignored',
      'keep.ts': 'included by higher-priority rules',
      'notes/deep/item.md': 'ignored',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      '.gitignore',
      '.latticeignore',
      'keep.ts',
    ]);
  });

  it('skips files over the configured size without reading them', async () => {
    const rootPath = await createRepository({
      'large.txt': '12345',
      'small.txt': '1234',
    });

    const scan = await scanRepository({ rootPath, maxFileSizeBytes: 4 });

    expect(scan.files.map((file) => file.relativePath)).toEqual(['small.txt']);
    expect(scan.totalIgnoredEntries).toBe(1);
  });

  it('skips binary files', async () => {
    const rootPath = await createRepository({
      'image.bin': Buffer.from([1, 2, 0, 4]),
      'source.c': 'int main(void) { return 0; }',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual(['source.c']);
    expect(scan.totalIgnoredEntries).toBe(1);
  });

  it('maps unknown extensions and extensionless files to Unknown', async () => {
    const rootPath = await createRepository({
      Makefile: 'all:',
      'notes.custom': 'notes',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files).toEqual([
      expect.objectContaining({
        relativePath: 'Makefile',
        extension: null,
        language: SupportedLanguage.Unknown,
      }),
      expect.objectContaining({
        relativePath: 'notes.custom',
        extension: '.custom',
        language: SupportedLanguage.Unknown,
      }),
    ]);
  });

  it('generates stable path IDs and content-only hashes', async () => {
    const rootPath = await createRepository({ 'src/file.ts': 'abc' });

    const scan = await scanRepository({ rootPath });
    const file = scan.files[0];

    expect(file?.id).toBe(sha256('src/file.ts'));
    expect(file?.contentHash).toBe(sha256('abc'));
  });

  it('sorts paths independently of creation and traversal order', async () => {
    const rootPath = await createRepository({
      'z.ts': 'z',
      'deep/c.ts': 'c',
      'a.ts': 'a',
      'deep/a.ts': 'nested a',
    });

    const scan = await scanRepository({ rootPath });

    expect(scan.files.map((file) => file.relativePath)).toEqual([
      'a.ts',
      'deep/a.ts',
      'deep/c.ts',
      'z.ts',
    ]);
  });

  it('produces identical results for repeated unchanged scans with the same clock', async () => {
    const rootPath = await createRepository({
      'src/index.ts': 'export {};\n',
      'README.md': '# Read me\n',
    });
    const scanner = new RepositoryScanner(
      new NodeRepositoryFileSystem(),
      () => new Date('2026-07-20T12:00:00.000Z'),
    );

    const firstScan = await scanner.scan({ rootPath });
    const secondScan = await scanner.scan({ rootPath });

    expect(secondScan).toEqual(firstScan);
  });
});

describe('detectLanguage', () => {
  it.each([
    ['.ts', SupportedLanguage.TypeScript],
    ['.tsx', SupportedLanguage.TSX],
    ['.js', SupportedLanguage.JavaScript],
    ['.jsx', SupportedLanguage.JSX],
    ['.py', SupportedLanguage.Python],
    ['.go', SupportedLanguage.Go],
    ['.java', SupportedLanguage.Java],
    ['.rs', SupportedLanguage.Rust],
    ['.cs', SupportedLanguage.CSharp],
    ['.cpp', SupportedLanguage.CPlusPlus],
    ['.c', SupportedLanguage.C],
    ['.json', SupportedLanguage.JSON],
    ['.yaml', SupportedLanguage.YAML],
    ['.yml', SupportedLanguage.YAML],
    ['.md', SupportedLanguage.Markdown],
    ['.other', SupportedLanguage.Unknown],
    [null, SupportedLanguage.Unknown],
  ] as const)('maps %s deterministically', (extension, expected) => {
    expect(detectLanguage(extension)).toBe(expected);
  });
});

async function createRepository(
  files: Readonly<Record<string, string | Buffer>>,
): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'lattice-indexer-'));
  temporaryDirectories.push(rootPath);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return rootPath;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
