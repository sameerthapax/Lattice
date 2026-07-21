import {
  NodeRepositoryFileSystem,
  type RepositoryFileSystem,
} from '@lattice/filesystem';
import {
  SupportedLanguage,
  type RepositoryScan,
  type ScannedFile,
} from '@lattice/core-indexer';
import { describe, expect, it } from 'vitest';

import { analyzeRepository } from './analyze-repository';

const analyzedAt = new Date('2026-07-20T12:00:00.000Z');

describe('analyzeRepository language support', () => {
  it.each([
    [
      'source.ts',
      SupportedLanguage.TypeScript,
      'TypeScript',
      'export function value() {}',
      'value',
    ],
    [
      'source.tsx',
      SupportedLanguage.TSX,
      'TSX',
      'export const View = () => <div />;',
      'View',
    ],
    [
      'source.js',
      SupportedLanguage.JavaScript,
      'JavaScript',
      'export function value() {}',
      'value',
    ],
    [
      'source.jsx',
      SupportedLanguage.JSX,
      'JSX',
      'export const View = () => <div />;',
      'View',
    ],
  ] as const)(
    'parses %s as %s',
    async (path, scannerLanguage, parserLanguage, content, symbolName) => {
      const { analysis } = await analyzeFiles({
        [path]: {
          language: scannerLanguage,
          content,
        },
      });

      expect(analysis.files[0]).toMatchObject({
        language: parserLanguage,
        symbols: [expect.objectContaining({ name: symbolName })],
      });
    },
  );

  it.each([SupportedLanguage.Markdown, SupportedLanguage.Unknown])(
    'skips unsupported scanner language %s',
    async (language) => {
      const { analysis } = await analyzeFiles({
        'source.txt': { language, content: 'function ignored() {}' },
      });

      expect(analysis).toMatchObject({
        parsedFileCount: 0,
        skippedFileCount: 1,
        failedFileCount: 0,
        files: [],
      });
    },
  );
});

describe('symbol extraction', () => {
  it('extracts supported top-level, class, variable, and object symbols', async () => {
    const source = [
      'export async function run() {}',
      'const arrow = async () => 1;',
      'const expression = function () {};',
      'export class Service {',
      '  constructor() {}',
      '  execute() {}',
      '  static async create() {}',
      '}',
      'export interface Config {}',
      'export type Result = string;',
      'export enum State { Ready }',
      'export const value = 1;',
      'const handlers = { handle() {}, async load() {}, save: () => {} };',
    ].join('\n');

    const { analysis } = await analyzeFiles({
      'symbols.ts': { language: SupportedLanguage.TypeScript, content: source },
    });
    const symbols = analysis.files[0]?.symbols ?? [];

    expect(
      symbols.map(({ qualifiedName, kind }) => [qualifiedName, kind]),
    ).toEqual([
      ['run', 'function'],
      ['arrow', 'function'],
      ['expression', 'function'],
      ['Service', 'class'],
      ['Service.constructor', 'constructor'],
      ['Service.execute', 'method'],
      ['Service.create', 'method'],
      ['Config', 'interface'],
      ['Result', 'type-alias'],
      ['State', 'enum'],
      ['value', 'variable'],
      ['handlers.handle', 'method'],
      ['handlers.load', 'method'],
      ['handlers.save', 'method'],
    ]);
    expect(symbols.find((symbol) => symbol.name === 'run')).toMatchObject({
      exported: true,
      async: true,
    });
    expect(symbols.find((symbol) => symbol.name === 'arrow')?.async).toBe(true);

    const service = symbols.find((symbol) => symbol.name === 'Service');
    expect(service).toBeDefined();
    expect(
      symbols
        .filter((symbol) => symbol.qualifiedName.startsWith('Service.'))
        .map((symbol) => symbol.parentSymbolId),
    ).toEqual([service?.id, service?.id, service?.id]);
  });

  it.each([
    {
      description: 'arrow function',
      fileName: 'arrow.ts',
      language: SupportedLanguage.TypeScript,
      source: 'const fn = () => {};',
      symbolName: 'fn',
      expectedKind: 'function',
      expectedAsync: false,
    },
    {
      description: 'function expression',
      fileName: 'function-expression.ts',
      language: SupportedLanguage.TypeScript,
      source: 'const fn = function () {};',
      symbolName: 'fn',
      expectedKind: 'function',
      expectedAsync: false,
    },
    {
      description: 'async arrow function',
      fileName: 'async-arrow.ts',
      language: SupportedLanguage.TypeScript,
      source: 'const fn = async () => {};',
      symbolName: 'fn',
      expectedKind: 'function',
      expectedAsync: true,
    },
    {
      description: 'async function expression',
      fileName: 'async-function-expression.ts',
      language: SupportedLanguage.TypeScript,
      source: 'const fn = async function () {};',
      symbolName: 'fn',
      expectedKind: 'function',
      expectedAsync: true,
    },
    {
      description: 'generator function expression',
      fileName: 'generator.ts',
      language: SupportedLanguage.TypeScript,
      source: 'const fn = function* () {};',
      symbolName: 'fn',
      expectedKind: 'function',
      expectedAsync: false,
    },
    {
      description: 'numeric variable',
      fileName: 'number.ts',
      language: SupportedLanguage.TypeScript,
      source: 'export const value = 123;',
      symbolName: 'value',
      expectedKind: 'variable',
      expectedAsync: false,
    },
    {
      description: 'object variable',
      fileName: 'object.ts',
      language: SupportedLanguage.TypeScript,
      source: 'export const config = {};',
      symbolName: 'config',
      expectedKind: 'variable',
      expectedAsync: false,
    },
    {
      description: 'array variable',
      fileName: 'array.ts',
      language: SupportedLanguage.TypeScript,
      source: 'export const items = [];',
      symbolName: 'items',
      expectedKind: 'variable',
      expectedAsync: false,
    },
    {
      description: 'class-expression variable',
      fileName: 'class-expression.ts',
      language: SupportedLanguage.TypeScript,
      source: 'export const Service = class {};',
      symbolName: 'Service',
      expectedKind: 'variable',
      expectedAsync: false,
    },
    {
      description: 'JSX component arrow function',
      fileName: 'component.tsx',
      language: SupportedLanguage.TSX,
      source: 'const Button = () => <button />;',
      symbolName: 'Button',
      expectedKind: 'function',
      expectedAsync: false,
    },
  ] as const)(
    'classifies a $description as $expectedKind',
    async ({
      fileName,
      language,
      source,
      symbolName,
      expectedKind,
      expectedAsync,
    }) => {
      const { analysis } = await analyzeFiles({
        [fileName]: { language, content: source },
      });

      expect(analysis.files[0]?.symbols).toEqual([
        expect.objectContaining({
          name: symbolName,
          qualifiedName: symbolName,
          kind: expectedKind,
          async: expectedAsync,
        }),
      ]);
    },
  );

  it('links an exported typed arrow declaration to its function symbol', async () => {
    const { analysis } = await analyzeFiles({
      'user.ts': {
        language: SupportedLanguage.TypeScript,
        content: [
          'interface User { id: string; name: string }',
          'export const createDefaultUser = (): User => ({',
          '  id: "1",',
          '  name: "Default",',
          '});',
        ].join('\n'),
      },
    });
    const file = analysis.files[0];
    const symbol = file?.symbols.find(
      (candidate) => candidate.name === 'createDefaultUser',
    );

    expect(symbol).toMatchObject({
      kind: 'function',
      name: 'createDefaultUser',
      qualifiedName: 'createDefaultUser',
      async: false,
      exported: true,
    });
    expect(
      file?.exports.find(
        (sourceExport) => sourceExport.exportedName === 'createDefaultUser',
      )?.symbolId,
    ).toBe(symbol?.id);
  });

  it('produces stable symbol IDs and ordering for repeated input', async () => {
    const files = {
      'source.ts': {
        language: SupportedLanguage.TypeScript,
        content: 'function z() {}\nfunction a() {}\n',
      },
    } as const;

    const first = (await analyzeFiles(files)).analysis;
    const second = (await analyzeFiles(files)).analysis;

    expect(first.files[0]?.symbols).toEqual(second.files[0]?.symbols);
    expect(first.files[0]?.symbols.map((symbol) => symbol.name)).toEqual([
      'z',
      'a',
    ]);
  });

  it('uses one-based lines and zero-based columns in public locations', async () => {
    const { analysis } = await analyzeFiles({
      'source.ts': {
        language: SupportedLanguage.TypeScript,
        content: '\n  function positioned() {}',
      },
    });

    // Public locations intentionally use one-based lines and zero-based columns.
    expect(analysis.files[0]?.symbols[0]?.location).toEqual({
      startLine: 2,
      startColumn: 2,
      endLine: 2,
      endColumn: 26,
    });
  });
});

describe('import extraction', () => {
  it('extracts all static ES module import forms with stable IDs', async () => {
    const source = [
      "import defaultValue, { value, other as alias } from './module';",
      "import * as namespace from './namespace';",
      "import './side-effect';",
      "import type TypeDefault from './type-default';",
      "import { type Shape } from './shape';",
    ].join('\n');
    const first = (
      await analyzeFiles({
        'imports.ts': {
          language: SupportedLanguage.TypeScript,
          content: source,
        },
      })
    ).analysis;
    const second = (
      await analyzeFiles({
        'imports.ts': {
          language: SupportedLanguage.TypeScript,
          content: source,
        },
      })
    ).analysis;
    const imports = first.files[0]?.imports ?? [];

    expect(
      imports.map((item) => ({
        kind: item.kind,
        importedName: item.importedName,
        localName: item.localName,
        source: item.source,
        typeOnly: item.typeOnly,
      })),
    ).toEqual([
      {
        kind: 'default',
        importedName: 'default',
        localName: 'defaultValue',
        source: './module',
        typeOnly: false,
      },
      {
        kind: 'named',
        importedName: 'value',
        localName: 'value',
        source: './module',
        typeOnly: false,
      },
      {
        kind: 'named',
        importedName: 'other',
        localName: 'alias',
        source: './module',
        typeOnly: false,
      },
      {
        kind: 'namespace',
        importedName: '*',
        localName: 'namespace',
        source: './namespace',
        typeOnly: false,
      },
      {
        kind: 'side-effect',
        importedName: null,
        localName: null,
        source: './side-effect',
        typeOnly: false,
      },
      {
        kind: 'default',
        importedName: 'default',
        localName: 'TypeDefault',
        source: './type-default',
        typeOnly: true,
      },
      {
        kind: 'named',
        importedName: 'Shape',
        localName: 'Shape',
        source: './shape',
        typeOnly: true,
      },
    ]);
    expect(imports.map((item) => item.id)).toEqual(
      second.files[0]?.imports.map((item) => item.id),
    );
  });
});

describe('export extraction', () => {
  it('extracts declarations, lists, aliases, defaults, and re-exports', async () => {
    const source = [
      'function local() {}',
      'const listedVariable = 1;',
      'export function value() {}',
      'export class Service {}',
      'export const item = 1;',
      'export interface Config {}',
      'export type Result = string;',
      'export { local };',
      'export { listedVariable };',
      'export { local as alias };',
      "export { remote } from './remote';",
      "export type { Shape } from './shape';",
      "export * from './all';",
      'export default Service;',
    ].join('\n');
    const first = (
      await analyzeFiles({
        'exports.ts': {
          language: SupportedLanguage.TypeScript,
          content: source,
        },
      })
    ).analysis;
    const second = (
      await analyzeFiles({
        'exports.ts': {
          language: SupportedLanguage.TypeScript,
          content: source,
        },
      })
    ).analysis;
    const file = first.files[0];

    expect(
      file?.exports.map(
        ({
          kind,
          exportedName,
          localName,
          source: moduleSource,
          typeOnly,
        }) => ({
          kind,
          exportedName,
          localName,
          source: moduleSource,
          typeOnly,
        }),
      ),
    ).toEqual([
      {
        kind: 'named',
        exportedName: 'value',
        localName: 'value',
        source: null,
        typeOnly: false,
      },
      {
        kind: 'named',
        exportedName: 'Service',
        localName: 'Service',
        source: null,
        typeOnly: false,
      },
      {
        kind: 'named',
        exportedName: 'item',
        localName: 'item',
        source: null,
        typeOnly: false,
      },
      {
        kind: 'named',
        exportedName: 'Config',
        localName: 'Config',
        source: null,
        typeOnly: true,
      },
      {
        kind: 'named',
        exportedName: 'Result',
        localName: 'Result',
        source: null,
        typeOnly: true,
      },
      {
        kind: 'named',
        exportedName: 'local',
        localName: 'local',
        source: null,
        typeOnly: false,
      },
      {
        kind: 'named',
        exportedName: 'listedVariable',
        localName: 'listedVariable',
        source: null,
        typeOnly: false,
      },
      {
        kind: 'named',
        exportedName: 'alias',
        localName: 'local',
        source: null,
        typeOnly: false,
      },
      {
        kind: 're-export',
        exportedName: 'remote',
        localName: 'remote',
        source: './remote',
        typeOnly: false,
      },
      {
        kind: 're-export',
        exportedName: 'Shape',
        localName: 'Shape',
        source: './shape',
        typeOnly: true,
      },
      {
        kind: 'export-all',
        exportedName: '*',
        localName: null,
        source: './all',
        typeOnly: false,
      },
      {
        kind: 'default',
        exportedName: 'default',
        localName: 'Service',
        source: null,
        typeOnly: false,
      },
    ]);
    expect(
      file?.exports.find((item) => item.exportedName === 'local')?.symbolId,
    ).toBe(file?.symbols.find((symbol) => symbol.name === 'local')?.id);
    expect(
      file?.symbols.find((symbol) => symbol.name === 'listedVariable'),
    ).toMatchObject({
      kind: 'variable',
      exported: true,
    });
    expect(file?.exports.map((item) => item.id)).toEqual(
      second.files[0]?.exports.map((item) => item.id),
    );
  });

  it('handles an anonymous default export without crashing', async () => {
    const { analysis } = await analyzeFiles({
      'anonymous.js': {
        language: SupportedLanguage.JavaScript,
        content: 'export default function () {}',
      },
    });

    expect(analysis.files[0]?.exports).toEqual([
      expect.objectContaining({
        kind: 'default',
        exportedName: 'default',
        localName: null,
        symbolId: null,
      }),
    ]);
    expect(analysis.files[0]?.diagnostics).toEqual([]);
  });
});

describe('diagnostics and repository resilience', () => {
  it('returns recoverable syntax diagnostics and symbols from a malformed file', async () => {
    const { analysis } = await analyzeFiles({
      'broken.ts': {
        language: SupportedLanguage.TypeScript,
        content: 'export function valid() {}\nconst broken = ;',
      },
      'valid.ts': {
        language: SupportedLanguage.TypeScript,
        content: 'export const okay = 1;',
      },
    });

    expect(analysis.parsedFileCount).toBe(2);
    expect(analysis.failedFileCount).toBe(0);
    expect(analysis.files[0]?.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TREE_SITTER_SYNTAX_ERROR',
        severity: 'error',
      }),
    ]);
    expect(analysis.files[0]?.symbols).toEqual([
      expect.objectContaining({ name: 'valid' }),
    ]);
  });

  it('isolates read failures and sorts parsed files and failures', async () => {
    const fileSystem = new MemoryFileSystem(
      {
        '/repository/z.ts': 'export const z = 1;',
        '/repository/a.ts': 'export const a = 1;',
      },
      new Set(['/repository/b.ts', '/repository/c.ts']),
    );
    const scan = createScan(fileSystem, [
      fileSystem.file('z.ts', SupportedLanguage.TypeScript),
      fileSystem.file('c.ts', SupportedLanguage.TypeScript, 'unreadable'),
      fileSystem.file('a.ts', SupportedLanguage.TypeScript),
      fileSystem.file('b.ts', SupportedLanguage.TypeScript, 'unreadable'),
      fileSystem.file('README.md', SupportedLanguage.Markdown, '# readme'),
    ]);

    const analysis = await analyzeRepository({
      scan,
      fileSystem,
      now: () => analyzedAt,
    });

    expect(analysis).toMatchObject({
      scannedFileCount: 5,
      parsedFileCount: 2,
      skippedFileCount: 1,
      failedFileCount: 2,
    });
    expect(analysis.files.map((file) => file.relativePath)).toEqual([
      'a.ts',
      'z.ts',
    ]);
    expect(analysis.failures.map((failure) => failure.relativePath)).toEqual([
      'b.ts',
      'c.ts',
    ]);
    expect(analysis.failures[0]?.code).toBe('SOURCE_READ_FAILED');
  });

  it('reports a changed file as a typed failure', async () => {
    const fileSystem = new MemoryFileSystem({
      '/repository/source.ts': 'new content',
    });
    const scannedFile = fileSystem.file(
      'source.ts',
      SupportedLanguage.TypeScript,
      'old content',
    );
    const analysis = await analyzeRepository({
      scan: createScan(fileSystem, [scannedFile]),
      fileSystem,
      now: () => analyzedAt,
    });

    expect(analysis.failures).toEqual([
      expect.objectContaining({
        code: 'FILE_CHANGED_SINCE_SCAN',
        relativePath: 'source.ts',
      }),
    ]);
  });

  it.each(['', '// comments only\n'])(
    'parses empty or comment-only source without diagnostics',
    async (content) => {
      const { analysis } = await analyzeFiles({
        'empty.ts': { language: SupportedLanguage.TypeScript, content },
      });
      expect(analysis.files[0]).toMatchObject({
        symbols: [],
        imports: [],
        exports: [],
        diagnostics: [],
      });
    },
  );

  it('returns deterministic empty and unsupported-only analyses with an injected clock', async () => {
    const fileSystem = new MemoryFileSystem({});
    const empty = await analyzeRepository({
      scan: createScan(fileSystem, []),
      fileSystem,
      now: () => analyzedAt,
    });
    expect(empty).toEqual({
      rootPath: '/repository',
      analyzedAt,
      scannedFileCount: 0,
      parsedFileCount: 0,
      skippedFileCount: 0,
      failedFileCount: 0,
      files: [],
      failures: [],
    });

    const repeated = await analyzeRepository({
      scan: createScan(fileSystem, []),
      fileSystem,
      now: () => analyzedAt,
    });
    expect(repeated).toEqual(empty);
  });
});

async function analyzeFiles(
  sources: Readonly<
    Record<
      string,
      { readonly language: SupportedLanguage; readonly content: string }
    >
  >,
): Promise<{
  readonly analysis: Awaited<ReturnType<typeof analyzeRepository>>;
}> {
  const contents = Object.fromEntries(
    Object.entries(sources).map(([relativePath, source]) => [
      `/repository/${relativePath}`,
      source.content,
    ]),
  );
  const fileSystem = new MemoryFileSystem(contents);
  const files = Object.entries(sources).map(([relativePath, source]) =>
    fileSystem.file(relativePath, source.language),
  );
  return {
    analysis: await analyzeRepository({
      scan: createScan(fileSystem, files),
      fileSystem,
      now: () => analyzedAt,
    }),
  };
}

class MemoryFileSystem
  extends NodeRepositoryFileSystem
  implements RepositoryFileSystem
{
  public constructor(
    private readonly contents: Readonly<Record<string, string>>,
    private readonly unreadablePaths: ReadonlySet<string> = new Set(),
  ) {
    super();
  }

  public override async readBytes(filePath: string): Promise<Buffer> {
    if (
      this.unreadablePaths.has(filePath) ||
      this.contents[filePath] === undefined
    ) {
      throw new Error('unreadable');
    }
    return Buffer.from(this.contents[filePath], 'utf8');
  }

  public file(
    relativePath: string,
    language: SupportedLanguage,
    scannedContent: string = this.contents[`/repository/${relativePath}`] ?? '',
  ): ScannedFile {
    const content = Buffer.from(scannedContent, 'utf8');
    return {
      id: this.hashText(relativePath),
      relativePath,
      absolutePath: `/repository/${relativePath}`,
      extension: relativePath.includes('.')
        ? `.${relativePath.split('.').at(-1)}`
        : null,
      language,
      sizeBytes: content.length,
      contentHash: this.hashBytes(content),
      lastModified: analyzedAt,
    };
  }
}

function createScan(
  _fileSystem: RepositoryFileSystem,
  files: readonly ScannedFile[],
): RepositoryScan {
  return {
    rootPath: '/repository',
    scannedAt: analyzedAt,
    totalFiles: files.length,
    totalDirectories: 0,
    totalIgnoredEntries: 0,
    files,
  };
}
