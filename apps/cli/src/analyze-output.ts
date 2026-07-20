import type {
  ParseableLanguage,
  RepositoryAnalysis,
  SourceExportKind,
  SourceImportKind,
  SourceSymbolKind,
} from '@lattice/core-parser';

export interface AnalyzeSummary {
  readonly scannedFileCount: number;
  readonly parsedFileCount: number;
  readonly skippedFileCount: number;
  readonly failedFileCount: number;
  readonly filesWithSyntaxErrors: number;
  readonly symbolCount: number;
  readonly importCount: number;
  readonly exportCount: number;
  readonly symbolsByKind: Readonly<Record<SourceSymbolKind, number>>;
}

export interface AnalyzeJsonOutput {
  readonly schemaVersion: '1';
  readonly command: 'analyze';
  readonly repository: {
    readonly rootPath: string;
  };
  readonly summary: AnalyzeSummary;
  readonly analysis: {
    readonly files: readonly AnalyzeJsonFile[];
    readonly failures: readonly AnalyzeJsonFailure[];
  };
}

export interface AnalyzeJsonLocation {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface AnalyzeJsonSymbol {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SourceSymbolKind;
  readonly fileId: string;
  readonly parentSymbolId: string | null;
  readonly exported: boolean;
  readonly async: boolean;
  readonly location: AnalyzeJsonLocation;
}

export interface AnalyzeJsonImport {
  readonly id: string;
  readonly fileId: string;
  readonly source: string;
  readonly kind: SourceImportKind;
  readonly importedName: string | null;
  readonly localName: string | null;
  readonly typeOnly: boolean;
  readonly location: AnalyzeJsonLocation;
}

export interface AnalyzeJsonExport {
  readonly id: string;
  readonly fileId: string;
  readonly kind: SourceExportKind;
  readonly exportedName: string;
  readonly localName: string | null;
  readonly source: string | null;
  readonly symbolId: string | null;
  readonly typeOnly: boolean;
  readonly location: AnalyzeJsonLocation;
}

export interface AnalyzeJsonDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly location: AnalyzeJsonLocation | null;
}

export interface AnalyzeJsonFile {
  readonly fileId: string;
  readonly relativePath: string;
  readonly language: ParseableLanguage;
  readonly contentHash: string;
  readonly symbols: readonly AnalyzeJsonSymbol[];
  readonly imports: readonly AnalyzeJsonImport[];
  readonly exports: readonly AnalyzeJsonExport[];
  readonly diagnostics: readonly AnalyzeJsonDiagnostic[];
}

export interface AnalyzeJsonFailure {
  readonly fileId: string;
  readonly relativePath: string;
  readonly code: string;
  readonly message: string;
}

export const SYMBOL_KINDS: readonly SourceSymbolKind[] = [
  'function',
  'class',
  'method',
  'constructor',
  'interface',
  'type-alias',
  'enum',
  'variable',
];

const SYMBOL_LABELS: Readonly<Record<SourceSymbolKind, string>> = {
  function: 'Functions',
  class: 'Classes',
  method: 'Methods',
  constructor: 'Constructors',
  interface: 'Interfaces',
  'type-alias': 'Type aliases',
  enum: 'Enums',
  variable: 'Variables',
};

export function buildAnalyzeSummary(
  analysis: RepositoryAnalysis,
): AnalyzeSummary {
  const symbolsByKind: Record<SourceSymbolKind, number> = {
    function: 0,
    class: 0,
    method: 0,
    constructor: 0,
    interface: 0,
    'type-alias': 0,
    enum: 0,
    variable: 0,
  };
  let symbolCount = 0;
  let importCount = 0;
  let exportCount = 0;
  let filesWithSyntaxErrors = 0;

  for (const file of analysis.files) {
    for (const symbol of file.symbols) {
      symbolsByKind[symbol.kind] += 1;
      symbolCount += 1;
    }
    importCount += file.imports.length;
    exportCount += file.exports.length;
    if (
      file.diagnostics.some(
        (diagnostic) => diagnostic.code === 'TREE_SITTER_SYNTAX_ERROR',
      )
    ) {
      filesWithSyntaxErrors += 1;
    }
  }

  return {
    scannedFileCount: analysis.scannedFileCount,
    parsedFileCount: analysis.parsedFileCount,
    skippedFileCount: analysis.skippedFileCount,
    failedFileCount: analysis.failedFileCount,
    filesWithSyntaxErrors,
    symbolCount,
    importCount,
    exportCount,
    symbolsByKind,
  };
}

export function formatAnalyzeSummary(
  summary: AnalyzeSummary,
  durationSeconds: number,
): string {
  return [
    'Repository analyzed successfully',
    `Files scanned: ${summary.scannedFileCount}`,
    `Files parsed: ${summary.parsedFileCount}`,
    `Files skipped: ${summary.skippedFileCount}`,
    `Parse failures: ${summary.failedFileCount}`,
    'Symbols',
    ...SYMBOL_KINDS.map(
      (kind) => `${SYMBOL_LABELS[kind]}: ${summary.symbolsByKind[kind]}`,
    ),
    `Imports: ${summary.importCount}`,
    `Exports: ${summary.exportCount}`,
    `Files with syntax errors: ${summary.filesWithSyntaxErrors}`,
    `Duration: ${durationSeconds.toFixed(2)}s`,
  ].join('\n');
}

export function buildAnalyzeJsonOutput(
  analysis: RepositoryAnalysis,
): AnalyzeJsonOutput {
  return {
    schemaVersion: '1',
    command: 'analyze',
    repository: {
      rootPath: analysis.rootPath,
    },
    summary: buildAnalyzeSummary(analysis),
    analysis: {
      files: analysis.files.map((file) => ({
        fileId: file.fileId,
        relativePath: file.relativePath,
        language: file.language,
        contentHash: file.contentHash,
        symbols: file.symbols.map((symbol) => ({
          id: symbol.id,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          fileId: symbol.fileId,
          parentSymbolId: symbol.parentSymbolId,
          exported: symbol.exported,
          async: symbol.async,
          location: copyLocation(symbol.location),
        })),
        imports: file.imports.map((sourceImport) => ({
          id: sourceImport.id,
          fileId: sourceImport.fileId,
          source: sourceImport.source,
          kind: sourceImport.kind,
          importedName: sourceImport.importedName,
          localName: sourceImport.localName,
          typeOnly: sourceImport.typeOnly,
          location: copyLocation(sourceImport.location),
        })),
        exports: file.exports.map((sourceExport) => ({
          id: sourceExport.id,
          fileId: sourceExport.fileId,
          kind: sourceExport.kind,
          exportedName: sourceExport.exportedName,
          localName: sourceExport.localName,
          source: sourceExport.source,
          symbolId: sourceExport.symbolId,
          typeOnly: sourceExport.typeOnly,
          location: copyLocation(sourceExport.location),
        })),
        diagnostics: file.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          location:
            diagnostic.location === null
              ? null
              : copyLocation(diagnostic.location),
        })),
      })),
      failures: analysis.failures.map((failure) => ({
        fileId: failure.fileId,
        relativePath: failure.relativePath,
        code: failure.code,
        message: failure.message,
      })),
    },
  };
}

export function serializeAnalyzeJson(output: AnalyzeJsonOutput): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

function copyLocation(location: AnalyzeJsonLocation): AnalyzeJsonLocation {
  return {
    startLine: location.startLine,
    startColumn: location.startColumn,
    endLine: location.endLine,
    endColumn: location.endColumn,
  };
}
