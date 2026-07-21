import { SupportedLanguage, type RepositoryScan } from '@lattice/core-indexer';
import type {
  ParsedSourceFile,
  RepositoryAnalysis,
  SourceExport,
  SourceImport,
  SourceSymbol,
} from '@lattice/core-parser';
import { describe, expect, it } from 'vitest';

import { ResolverInputError } from './errors';
import { resolveRepositoryAnalysis } from './resolve-repository-analysis';

const location = { startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 };

describe('resolveRepositoryAnalysis', () => {
  it.each([
    ['./exact.ts', 'exact.ts'],
    ['./typed', 'typed.ts'],
    ['./component', 'component.tsx'],
    ['./script', 'script.js'],
    ['./view', 'view.jsx'],
    ['./folder', 'folder/index.ts'],
    ['./exact.ts', 'exact.ts'],
    ['./nested/../typed', 'typed.ts'],
  ])('resolves relative specifier %s to %s', (specifier, targetPath) => {
    const result = resolve(
      fixture([
        file('consumer.ts', {
          imports: [
            sourceImport(
              'i',
              'consumer.ts',
              specifier,
              'namespace',
              '*',
              'value',
            ),
          ],
        }),
        file(targetPath),
      ]),
    );
    expect(
      result.modules.find((item) => item.fileId === 'consumer.ts')?.imports[0],
    ).toMatchObject({ status: 'resolved-module', targetFileId: targetPath });
  });

  it('uses deterministic extension mapping and candidate precedence', () => {
    const result = resolve(
      fixture([
        file('consumer.ts', {
          imports: [
            sourceImport(
              'js',
              'consumer.ts',
              './module.js',
              'namespace',
              '*',
              'js',
            ),
            sourceImport(
              'jsx',
              'consumer.ts',
              './component.jsx',
              'namespace',
              '*',
              'jsx',
            ),
          ],
        }),
        file('module.js'),
        file('module.ts'),
        file('component.tsx'),
      ]),
    );
    expect(
      result.modules
        .find((item) => item.fileId === 'consumer.ts')
        ?.imports.map((item) => item.targetFileId),
    ).toEqual(['module.js', 'component.tsx']);
    expect(
      resolve(
        fixture([
          file('consumer.ts', {
            imports: [
              sourceImport(
                'i',
                'consumer.ts',
                './module.js',
                'namespace',
                '*',
                'm',
              ),
            ],
          }),
          file('module.ts'),
        ]),
      ).modules.find((item) => item.fileId === 'consumer.ts')?.imports[0]
        ?.targetFileId,
    ).toBe('module.ts');
  });

  it('distinguishes escaping, missing, and scanned-but-unparsed targets', () => {
    const input = fixture(
      [
        file('src/consumer.ts', {
          imports: [
            sourceImport(
              'escape',
              'src/consumer.ts',
              '../../secret',
              'namespace',
              '*',
              'secret',
            ),
            sourceImport(
              'missing',
              'src/consumer.ts',
              './missing',
              'namespace',
              '*',
              'missing',
            ),
            sourceImport(
              'unparsed',
              'src/consumer.ts',
              './broken',
              'namespace',
              '*',
              'broken',
            ),
          ],
        }),
      ],
      ['src/broken.ts'],
    );
    expect(
      resolve(input).unresolvedDependencies.map((item) => item.reason),
    ).toEqual([
      'PATH_ESCAPES_REPOSITORY',
      'MODULE_NOT_FOUND',
      'TARGET_NOT_PARSED',
    ]);
  });

  it('resolves workspace aliases and subpaths without confusing external scoped packages', () => {
    const result = resolve(
      fixture([
        file('consumer.ts', {
          imports: [
            sourceImport(
              'alias',
              'consumer.ts',
              '@lattice/parser',
              'namespace',
              '*',
              'parser',
            ),
            sourceImport(
              'subpath',
              'consumer.ts',
              '@lattice/parser/tool',
              'namespace',
              '*',
              'tool',
            ),
            sourceImport(
              'missing',
              'consumer.ts',
              '@lattice/missing',
              'namespace',
              '*',
              'missing',
            ),
            sourceImport(
              'external',
              'consumer.ts',
              '@other/package',
              'namespace',
              '*',
              'other',
            ),
          ],
        }),
        file('libs/parser/src/index.ts'),
        file('libs/parser/src/tool.ts'),
      ]),
      [
        {
          alias: '@lattice/parser',
          targetRelativePaths: ['libs/parser/src/index.ts'],
        },
      ],
    );
    expect(
      result.modules[0]?.imports.map((item) => [item.sourceKind, item.status]),
    ).toEqual([
      ['workspace', 'resolved-module'],
      ['workspace', 'resolved-module'],
      ['workspace', 'unresolved'],
      ['external', 'external'],
    ]);
    expect(result.unresolvedDependencies[0]?.reason).toBe(
      'WORKSPACE_ALIAS_NOT_FOUND',
    );
  });

  it('rejects malformed workspace alias configuration', () => {
    expect(() =>
      resolve(fixture([]), [
        { alias: '@lattice/parser', targetRelativePaths: [] },
      ]),
    ).toThrowError(ResolverInputError);
  });

  it('records external imports, including type-only imports, without unresolved failures', () => {
    const result = resolve(
      fixture([
        file('consumer.ts', {
          imports: [
            sourceImport(
              'react',
              'consumer.ts',
              'react',
              'default',
              'default',
              'React',
            ),
            sourceImport(
              'fastify',
              'consumer.ts',
              'fastify',
              'named',
              'FastifyInstance',
              'FastifyInstance',
              true,
            ),
            sourceImport(
              'node',
              'consumer.ts',
              'node:path',
              'namespace',
              '*',
              'path',
            ),
          ],
        }),
      ]),
    );
    expect(result.externalDependencies).toHaveLength(3);
    expect(result.unresolvedDependencies).toEqual([]);
    expect(
      result.modules[0]?.imports.every((item) => item.status === 'external'),
    ).toBe(true);
  });

  it('creates one dependency for multiple specifiers and resolves named, alias, default, namespace, and side-effect imports', () => {
    const target = file('service.ts', {
      symbols: [
        symbol('user-symbol', 'service.ts', 'UserService'),
        symbol('default-symbol', 'service.ts', 'createService'),
      ],
      exports: [
        sourceExport(
          'user-export',
          'service.ts',
          'named',
          'UserService',
          'UserService',
          null,
          'user-symbol',
        ),
        sourceExport(
          'default-export',
          'service.ts',
          'default',
          'default',
          'createService',
          null,
          'default-symbol',
        ),
      ],
    });
    const consumer = file('consumer.ts', {
      imports: [
        sourceImport(
          'named',
          'consumer.ts',
          './service',
          'named',
          'UserService',
          'UserService',
        ),
        sourceImport(
          'alias',
          'consumer.ts',
          './service',
          'named',
          'UserService',
          'Service',
        ),
        sourceImport(
          'default',
          'consumer.ts',
          './service',
          'default',
          'default',
          'create',
        ),
        sourceImport(
          'namespace',
          'consumer.ts',
          './service',
          'namespace',
          '*',
          'services',
        ),
        sourceImport(
          'side',
          'consumer.ts',
          './service',
          'side-effect',
          null,
          null,
        ),
      ],
    });
    const result = resolve(fixture([consumer, target]));
    expect(result.dependencies.map((edge) => edge.kind)).toEqual([
      'import',
      'side-effect-import',
    ]);
    expect(result.symbolBindings).toHaveLength(3);
    expect(result.modules[0]?.imports.map((item) => item.status)).toEqual([
      'resolved-symbol',
      'resolved-symbol',
      'resolved-symbol',
      'resolved-module',
      'resolved-module',
    ]);
    expect(result.modules[0]?.outgoingDependencyIds).toHaveLength(2);
    expect(result.modules[1]?.incomingDependencyIds).toEqual(
      result.modules[0]?.outgoingDependencyIds,
    );
  });

  it('reports missing named exports while keeping module resolution successful', () => {
    const result = resolve(
      fixture([
        file('consumer.ts', {
          imports: [
            sourceImport(
              'i',
              'consumer.ts',
              './target',
              'named',
              'Missing',
              'Missing',
            ),
          ],
        }),
        file('target.ts'),
      ]),
    );
    expect(result.unresolvedDependencies[0]?.reason).toBe('EXPORT_NOT_FOUND');
    expect(result.dependencies).toHaveLength(1);
  });

  it('resolves aliased and type-only re-export chains to the originating symbol', () => {
    const result = resolve(
      fixture([
        file('a.ts', {
          symbols: [symbol('s', 'a.ts', 'User')],
          exports: [
            sourceExport(
              'a-export',
              'a.ts',
              'named',
              'User',
              'User',
              null,
              's',
              true,
            ),
          ],
        }),
        file('b.ts', {
          exports: [
            sourceExport(
              'b-export',
              'b.ts',
              're-export',
              'Person',
              'User',
              './a',
              null,
              true,
            ),
          ],
        }),
        file('index.ts', {
          exports: [
            sourceExport(
              'index-export',
              'index.ts',
              're-export',
              'Person',
              'Person',
              './b',
            ),
          ],
        }),
        file('consumer.ts', {
          imports: [
            sourceImport(
              'i',
              'consumer.ts',
              './index',
              'named',
              'Person',
              'LocalPerson',
              true,
            ),
          ],
        }),
      ]),
    );
    expect(
      result.modules.find((item) => item.fileId === 'consumer.ts')?.imports[0],
    ).toMatchObject({ status: 'resolved-symbol', targetSymbolId: 's' });
    expect(
      result.symbolBindings.some(
        (item) => item.targetFileId === 'a.ts' && item.targetSymbolId === 's',
      ),
    ).toBe(true);
  });

  it('resolves export-all chains, excludes default, honors explicit exports, and reports conflicts', () => {
    const result = resolve(
      fixture([
        file('a.ts', {
          symbols: [
            symbol('a-shared', 'a.ts', 'Shared'),
            symbol('a-only', 'a.ts', 'Only'),
            symbol('a-default', 'a.ts', 'Default'),
          ],
          exports: [
            sourceExport(
              'a-shared-export',
              'a.ts',
              'named',
              'Shared',
              'Shared',
              null,
              'a-shared',
            ),
            sourceExport(
              'a-only-export',
              'a.ts',
              'named',
              'Only',
              'Only',
              null,
              'a-only',
            ),
            sourceExport(
              'a-default-export',
              'a.ts',
              'default',
              'default',
              'Default',
              null,
              'a-default',
            ),
          ],
        }),
        file('b.ts', {
          symbols: [symbol('b-shared', 'b.ts', 'Shared')],
          exports: [
            sourceExport(
              'b-shared-export',
              'b.ts',
              'named',
              'Shared',
              'Shared',
              null,
              'b-shared',
            ),
          ],
        }),
        file('barrel.ts', {
          exports: [
            sourceExport('all-a', 'barrel.ts', 'export-all', '*', null, './a'),
            sourceExport('all-b', 'barrel.ts', 'export-all', '*', null, './b'),
          ],
        }),
        file('consumer.ts', {
          imports: [
            sourceImport(
              'only',
              'consumer.ts',
              './barrel',
              'named',
              'Only',
              'Only',
            ),
            sourceImport(
              'shared',
              'consumer.ts',
              './barrel',
              'named',
              'Shared',
              'Shared',
            ),
            sourceImport(
              'default',
              'consumer.ts',
              './barrel',
              'default',
              'default',
              'Default',
            ),
          ],
        }),
      ]),
    );
    expect(
      result.modules
        .find((item) => item.fileId === 'consumer.ts')
        ?.imports.map((item) => item.status),
    ).toEqual(['resolved-symbol', 'unresolved', 'unresolved']);
    expect(
      result.unresolvedDependencies.map((item) => item.reason).sort(),
    ).toEqual(['AMBIGUOUS_EXPORT', 'EXPORT_NOT_FOUND']);
  });

  it('detects and canonically deduplicates sorted cycles without failing', () => {
    const result = resolve(
      fixture([
        file('a.ts', {
          imports: [sourceImport('ab', 'a.ts', './b', 'namespace', '*', 'b')],
        }),
        file('b.ts', {
          imports: [sourceImport('bc', 'b.ts', './c', 'namespace', '*', 'c')],
        }),
        file('c.ts', {
          imports: [sourceImport('ca', 'c.ts', './a', 'namespace', '*', 'a')],
        }),
        file('self.ts', {
          imports: [
            sourceImport('self', 'self.ts', './self', 'namespace', '*', 'self'),
          ],
        }),
      ]),
    );
    expect(result.cycles.map((cycle) => cycle.relativePaths)).toEqual([
      ['a.ts', 'b.ts', 'c.ts'],
      ['self.ts'],
    ]);
  });

  it('is deeply deterministic and sorts every top-level collection', () => {
    const input = fixture([file('z.ts'), file('a.ts')]);
    const first = resolve(input);
    expect(resolve(input)).toEqual(first);
    expect(first.modules.map((item) => item.relativePath)).toEqual([
      'a.ts',
      'z.ts',
    ]);
  });

  it('supports empty and unsupported-only analyses', () => {
    expect(resolve(fixture([], ['README.md'])).modules).toEqual([]);
  });

  it('rejects parser files absent from the scan', () => {
    const input = fixture([]);
    const invalid = {
      ...input,
      analysis: {
        ...input.analysis,
        files: [file('missing.ts')],
        parsedFileCount: 1,
      },
    };
    expect(() => resolveRepositoryAnalysis(invalid)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_ANALYSIS_FILE' }),
    );
  });
});

function resolve(
  input: ReturnType<typeof fixture>,
  aliases: Parameters<
    typeof resolveRepositoryAnalysis
  >[0]['workspaceAliases'] = [],
) {
  return resolveRepositoryAnalysis({ ...input, workspaceAliases: aliases });
}

function fixture(
  files: readonly ParsedSourceFile[],
  extraScannedPaths: readonly string[] = [],
): { scan: RepositoryScan; analysis: RepositoryAnalysis } {
  const paths = [
    ...new Set([
      ...files.map((item) => item.relativePath),
      ...extraScannedPaths,
      'README.md',
    ]),
  ];
  return {
    scan: {
      rootPath: '/repository',
      scannedAt: new Date(0),
      totalFiles: paths.length,
      totalDirectories: 1,
      totalIgnoredEntries: 0,
      files: paths.map((relativePath) => ({
        id: relativePath,
        relativePath,
        absolutePath: `/repository/${relativePath}`,
        extension: `.${relativePath.split('.').at(-1) ?? ''}`,
        language: relativePath.endsWith('.ts')
          ? SupportedLanguage.TypeScript
          : relativePath.endsWith('.tsx')
            ? SupportedLanguage.TSX
            : relativePath.endsWith('.js')
              ? SupportedLanguage.JavaScript
              : relativePath.endsWith('.jsx')
                ? SupportedLanguage.JSX
                : SupportedLanguage.Markdown,
        sizeBytes: 1,
        contentHash: 'hash',
        lastModified: new Date(0),
      })),
    },
    analysis: {
      rootPath: '/repository',
      analyzedAt: new Date(0),
      scannedFileCount: paths.length,
      parsedFileCount: files.length,
      skippedFileCount: paths.length - files.length,
      failedFileCount: 0,
      files,
      failures: [],
    },
  };
}

function file(
  relativePath: string,
  values: Partial<
    Pick<ParsedSourceFile, 'symbols' | 'imports' | 'exports'>
  > = {},
): ParsedSourceFile {
  return {
    fileId: relativePath,
    relativePath,
    language: relativePath.endsWith('x')
      ? relativePath.endsWith('.tsx')
        ? 'TSX'
        : 'JSX'
      : relativePath.endsWith('.js')
        ? 'JavaScript'
        : 'TypeScript',
    contentHash: 'hash',
    symbols: values.symbols ?? [],
    imports: values.imports ?? [],
    exports: values.exports ?? [],
    diagnostics: [],
  };
}

function sourceImport(
  id: string,
  fileId: string,
  source: string,
  kind: SourceImport['kind'],
  importedName: string | null,
  localName: string | null,
  typeOnly = false,
): SourceImport {
  return {
    id,
    fileId,
    source,
    kind,
    importedName,
    localName,
    typeOnly,
    location,
  };
}
function sourceExport(
  id: string,
  fileId: string,
  kind: SourceExport['kind'],
  exportedName: string,
  localName: string | null,
  source: string | null,
  symbolId: string | null = null,
  typeOnly = false,
): SourceExport {
  return {
    id,
    fileId,
    kind,
    exportedName,
    localName,
    source,
    symbolId,
    typeOnly,
    location,
  };
}
function symbol(id: string, fileId: string, name: string): SourceSymbol {
  return {
    id,
    fileId,
    name,
    qualifiedName: name,
    kind: 'class',
    parentSymbolId: null,
    exported: true,
    async: false,
    location,
  };
}
