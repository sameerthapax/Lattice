import type { RepositoryScan } from '@lattice/core-indexer';
import type { RepositoryFileSystem } from '@lattice/filesystem';

export type ParseableLanguage = 'TypeScript' | 'TSX' | 'JavaScript' | 'JSX';

export type SourceSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'constructor'
  | 'interface'
  | 'type-alias'
  | 'enum'
  | 'variable';

export interface SourceLocation {
  /** One-based line number. */
  readonly startLine: number;
  /** Zero-based UTF-8 byte column, matching Tree-sitter points. */
  readonly startColumn: number;
  /** One-based line number. */
  readonly endLine: number;
  /** Zero-based UTF-8 byte column, matching Tree-sitter points. */
  readonly endColumn: number;
}

export interface SourceSymbol {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SourceSymbolKind;
  readonly fileId: string;
  readonly parentSymbolId: string | null;
  readonly exported: boolean;
  readonly async: boolean;
  readonly location: SourceLocation;
}

export type SourceImportKind =
  'default' | 'named' | 'namespace' | 'side-effect';

export interface SourceImport {
  readonly id: string;
  readonly fileId: string;
  readonly source: string;
  readonly kind: SourceImportKind;
  readonly importedName: string | null;
  readonly localName: string | null;
  readonly typeOnly: boolean;
  readonly location: SourceLocation;
}

export type SourceExportKind = 'named' | 'default' | 're-export' | 'export-all';

export interface SourceExport {
  readonly id: string;
  readonly fileId: string;
  readonly kind: SourceExportKind;
  readonly exportedName: string;
  readonly localName: string | null;
  readonly source: string | null;
  readonly symbolId: string | null;
  readonly typeOnly: boolean;
  readonly location: SourceLocation;
}

export interface ParseDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly location: SourceLocation | null;
}

export interface ParseFailure {
  readonly fileId: string;
  readonly relativePath: string;
  readonly code: string;
  readonly message: string;
}

export interface ParsedSourceFile {
  readonly fileId: string;
  readonly relativePath: string;
  readonly language: ParseableLanguage;
  readonly contentHash: string;
  readonly symbols: readonly SourceSymbol[];
  readonly imports: readonly SourceImport[];
  readonly exports: readonly SourceExport[];
  readonly diagnostics: readonly ParseDiagnostic[];
}

export interface RepositoryAnalysis {
  readonly rootPath: string;
  readonly analyzedAt: Date;
  readonly scannedFileCount: number;
  readonly parsedFileCount: number;
  readonly skippedFileCount: number;
  readonly failedFileCount: number;
  readonly files: readonly ParsedSourceFile[];
  readonly failures: readonly ParseFailure[];
}

export interface AnalyzeRepositoryOptions {
  readonly scan: RepositoryScan;
  readonly fileSystem: RepositoryFileSystem;
  readonly now?: () => Date;
}
