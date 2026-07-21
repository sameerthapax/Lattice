import type { RepositoryScan } from '@lattice/core-indexer';
import type {
  ParseableLanguage,
  RepositoryAnalysis,
  SourceImportKind,
} from '@lattice/core-parser';

export type ModuleSourceKind =
  'relative' | 'workspace' | 'external' | 'unsupported';

export type ImportResolutionStatus =
  'resolved-symbol' | 'resolved-module' | 'external' | 'unresolved';

export interface ResolvedImport {
  readonly importId: string;
  readonly sourceFileId: string;
  readonly sourceSpecifier: string;
  readonly sourceKind: ModuleSourceKind;
  readonly importKind: SourceImportKind;
  readonly typeOnly: boolean;
  readonly status: ImportResolutionStatus;
  readonly targetFileId: string | null;
  readonly targetExportId: string | null;
  readonly targetSymbolId: string | null;
}

export type ExportResolutionStatus =
  | 'local-symbol'
  | 'resolved-re-export'
  | 'resolved-export-all'
  | 'external'
  | 'unresolved';

export interface ResolvedExport {
  readonly exportId: string;
  readonly sourceFileId: string;
  readonly exportedName: string;
  readonly typeOnly: boolean;
  readonly localSymbolId: string | null;
  readonly targetFileId: string | null;
  readonly targetExportId: string | null;
  readonly targetSymbolId: string | null;
  readonly status: ExportResolutionStatus;
}

export interface ResolvedModule {
  readonly fileId: string;
  readonly relativePath: string;
  readonly language: ParseableLanguage;
  readonly imports: readonly ResolvedImport[];
  readonly exports: readonly ResolvedExport[];
  readonly incomingDependencyIds: readonly string[];
  readonly outgoingDependencyIds: readonly string[];
}

export type ModuleDependencyKind =
  'import' | 'side-effect-import' | 're-export' | 'export-all';

export interface ModuleDependency {
  readonly id: string;
  readonly sourceFileId: string;
  readonly targetFileId: string;
  readonly sourceSpecifier: string;
  readonly kind: ModuleDependencyKind;
  readonly typeOnly: boolean;
}

export type SymbolBindingKind =
  'default-import' | 'named-import' | 're-export' | 'export-all';

export interface SymbolBinding {
  readonly id: string;
  readonly kind: SymbolBindingKind;
  readonly sourceFileId: string;
  readonly sourceEntityId: string;
  readonly targetFileId: string;
  readonly targetExportId: string | null;
  readonly targetSymbolId: string | null;
  readonly importedName: string | null;
  readonly localName: string | null;
}

export type UnresolvedDependencyReason =
  | 'MODULE_NOT_FOUND'
  | 'PATH_ESCAPES_REPOSITORY'
  | 'TARGET_NOT_PARSED'
  | 'EXPORT_NOT_FOUND'
  | 'AMBIGUOUS_EXPORT'
  | 'UNSUPPORTED_SPECIFIER'
  | 'WORKSPACE_ALIAS_NOT_FOUND';

export interface UnresolvedDependency {
  readonly id: string;
  readonly sourceFileId: string;
  readonly sourceRelativePath: string;
  readonly sourceEntityId: string;
  readonly sourceSpecifier: string;
  readonly importedName: string | null;
  readonly reason: UnresolvedDependencyReason;
}

export interface ExternalModuleDependency {
  readonly sourceFileId: string;
  readonly sourceSpecifier: string;
  readonly typeOnly: boolean;
  readonly importIds: readonly string[];
  readonly exportIds: readonly string[];
}

export interface ModuleCycle {
  readonly id: string;
  readonly fileIds: readonly string[];
  readonly relativePaths: readonly string[];
}

export interface ResolvedRepositoryAnalysis {
  readonly rootPath: string;
  readonly scannedFileCount: number;
  readonly parsedFileCount: number;
  readonly modules: readonly ResolvedModule[];
  readonly dependencies: readonly ModuleDependency[];
  readonly externalDependencies: readonly ExternalModuleDependency[];
  readonly symbolBindings: readonly SymbolBinding[];
  readonly unresolvedDependencies: readonly UnresolvedDependency[];
  readonly cycles: readonly ModuleCycle[];
}

export interface WorkspaceModuleAlias {
  readonly alias: string;
  readonly targetRelativePaths: readonly string[];
}

export interface ResolveRepositoryAnalysisOptions {
  readonly scan: RepositoryScan;
  readonly analysis: RepositoryAnalysis;
  readonly workspaceAliases?: readonly WorkspaceModuleAlias[];
}
