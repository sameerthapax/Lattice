import type {
  ParseableLanguage,
  RepositoryAnalysis,
  SourceExportKind,
  SourceImportKind,
  SourceSymbolKind,
} from '@lattice/core-parser';
import type {
  FileKnowledgeNode,
  FolderKnowledgeNode,
  KnowledgeRelation,
  ProjectDependency,
  ProjectKnowledgeNode,
  RepositoryKnowledge,
  RepositoryKnowledgeNode,
  SymbolKnowledgeNode,
} from '@lattice/core-knowledge';

export interface AnalyzeSummary {
  readonly scannedFileCount: number;
  readonly parsedFileCount: number;
  readonly skippedFileCount: number;
  readonly failedFileCount: number;
  readonly filesWithSyntaxErrors: number;
  readonly symbolCount: number;
  readonly importCount: number;
  readonly exportCount: number;
  readonly internalDependencyCount: number;
  readonly externalDependencyCount: number;
  readonly resolvedSymbolBindingCount: number;
  readonly unresolvedDependencyCount: number;
  readonly cycleCount: number;
  readonly projectCount: number;
  readonly folderCount: number;
  readonly knowledgeFileCount: number;
  readonly publicFileSymbolCount: number;
  readonly publicProjectSymbolCount: number;
  readonly crossProjectDependencyCount: number;
  readonly orphanFileCount: number;
  readonly symbolsByKind: Readonly<Record<SourceSymbolKind, number>>;
}

export interface AnalyzeJsonOutput {
  readonly schemaVersion: '3';
  readonly command: 'analyze';
  readonly repository: {
    readonly rootPath: string;
  };
  readonly summary: AnalyzeSummary;
  readonly analysis: {
    readonly files: readonly AnalyzeJsonFile[];
    readonly failures: readonly AnalyzeJsonFailure[];
  };
  readonly resolution: {
    readonly modules: readonly ResolvedModuleDto[];
    readonly dependencies: readonly ModuleDependencyDto[];
    readonly externalDependencies: readonly ExternalModuleDependencyDto[];
    readonly symbolBindings: readonly SymbolBindingDto[];
    readonly unresolvedDependencies: readonly UnresolvedDependencyDto[];
    readonly cycles: readonly ModuleCycleDto[];
  };
  readonly knowledge: AnalyzeJsonKnowledge;
}

export interface AnalyzeJsonKnowledge {
  readonly repository: RepositoryKnowledgeNode;
  readonly projects: readonly ProjectKnowledgeNode[];
  readonly folders: readonly FolderKnowledgeNode[];
  readonly files: readonly FileKnowledgeNode[];
  readonly symbols: readonly SymbolKnowledgeNode[];
  readonly relations: readonly KnowledgeRelation[];
  readonly projectDependencies: readonly ProjectDependency[];
}

export type ResolvedModuleDto = ResolvedModule;
export type ModuleDependencyDto = ModuleDependency;
export type ExternalModuleDependencyDto = ExternalModuleDependency;
export type SymbolBindingDto = SymbolBinding;
export type UnresolvedDependencyDto = UnresolvedDependency;
export type ModuleCycleDto = ModuleCycle;

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
  resolution: ResolvedRepositoryAnalysis,
  knowledge: RepositoryKnowledge,
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
    internalDependencyCount: resolution.dependencies.length,
    externalDependencyCount: resolution.externalDependencies.length,
    resolvedSymbolBindingCount: resolution.symbolBindings.length,
    unresolvedDependencyCount: resolution.unresolvedDependencies.length,
    cycleCount: resolution.cycles.length,
    projectCount: knowledge.summaries.projectCount,
    folderCount: knowledge.summaries.folderCount,
    knowledgeFileCount: knowledge.summaries.fileCount,
    publicFileSymbolCount: knowledge.summaries.publicFileSymbolCount,
    publicProjectSymbolCount: knowledge.summaries.publicProjectSymbolCount,
    crossProjectDependencyCount:
      knowledge.summaries.crossProjectDependencyCount,
    orphanFileCount: knowledge.summaries.orphanFileCount,
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
    'Module resolution',
    `Internal dependencies: ${summary.internalDependencyCount}`,
    `External dependencies: ${summary.externalDependencyCount}`,
    `Resolved symbol bindings: ${summary.resolvedSymbolBindingCount}`,
    `Unresolved dependencies: ${summary.unresolvedDependencyCount}`,
    `Dependency cycles: ${summary.cycleCount}`,
    ...(summary.unresolvedDependencyCount > 0
      ? ['Use --json to inspect unresolved dependencies.']
      : []),
    'Repository knowledge',
    `Projects: ${summary.projectCount}`,
    `Folders: ${summary.folderCount}`,
    `Files: ${summary.knowledgeFileCount}`,
    `Symbols: ${summary.symbolCount}`,
    `Public file symbols: ${summary.publicFileSymbolCount}`,
    `Public project symbols: ${summary.publicProjectSymbolCount}`,
    `Cross-project dependencies: ${summary.crossProjectDependencyCount}`,
    `Orphan source files: ${summary.orphanFileCount}`,
    `Duration: ${durationSeconds.toFixed(2)}s`,
  ].join('\n');
}

export function buildAnalyzeJsonOutput(
  analysis: RepositoryAnalysis,
  resolution: ResolvedRepositoryAnalysis,
  knowledge: RepositoryKnowledge,
): AnalyzeJsonOutput {
  return {
    schemaVersion: '3',
    command: 'analyze',
    repository: {
      rootPath: analysis.rootPath,
    },
    summary: buildAnalyzeSummary(analysis, resolution, knowledge),
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
    resolution: {
      modules: resolution.modules.map(copyResolvedModule),
      dependencies: resolution.dependencies.map((dependency) => ({
        ...dependency,
      })),
      externalDependencies: resolution.externalDependencies.map(
        (dependency) => ({
          sourceFileId: dependency.sourceFileId,
          sourceSpecifier: dependency.sourceSpecifier,
          typeOnly: dependency.typeOnly,
          importIds: [...dependency.importIds],
          exportIds: [...dependency.exportIds],
        }),
      ),
      symbolBindings: resolution.symbolBindings.map((binding) => ({
        ...binding,
      })),
      unresolvedDependencies: resolution.unresolvedDependencies.map(
        (dependency) => ({ ...dependency }),
      ),
      cycles: resolution.cycles.map((cycle) => ({
        id: cycle.id,
        fileIds: [...cycle.fileIds],
        relativePaths: [...cycle.relativePaths],
      })),
    },
    knowledge: copyKnowledge(knowledge),
  };
}

function copyKnowledge(knowledge: RepositoryKnowledge): AnalyzeJsonKnowledge {
  return {
    repository: {
      ...knowledge.repository,
      projectIds: [...knowledge.repository.projectIds],
      topLevelFolderIds: [...knowledge.repository.topLevelFolderIds],
      fileIds: [...knowledge.repository.fileIds],
    },
    projects: knowledge.projects.map((item) => ({
      ...item,
      folderIds: [...item.folderIds],
      fileIds: [...item.fileIds],
      symbolIds: [...item.symbolIds],
      incomingProjectDependencyIds: [...item.incomingProjectDependencyIds],
      outgoingProjectDependencyIds: [...item.outgoingProjectDependencyIds],
      publicSymbolIds: [...item.publicSymbolIds],
    })),
    folders: knowledge.folders.map((item) => ({
      ...item,
      childFolderIds: [...item.childFolderIds],
      fileIds: [...item.fileIds],
    })),
    files: knowledge.files.map((item) => ({
      ...item,
      symbolIds: [...item.symbolIds],
      publicSymbolIds: [...item.publicSymbolIds],
      incomingFileDependencyIds: [...item.incomingFileDependencyIds],
      outgoingFileDependencyIds: [...item.outgoingFileDependencyIds],
    })),
    symbols: knowledge.symbols.map((item) => ({
      ...item,
      childSymbolIds: [...item.childSymbolIds],
      incomingBindingIds: [...item.incomingBindingIds],
      location: { ...item.location },
    })),
    relations: knowledge.relations.map((item) => ({
      ...item,
      metadata: item.metadata === null ? null : { ...item.metadata },
    })),
    projectDependencies: knowledge.projectDependencies.map((item) => ({
      ...item,
      fileDependencyIds: [...item.fileDependencyIds],
    })),
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

function copyResolvedModule(module: ResolvedModule): ResolvedModuleDto {
  return {
    fileId: module.fileId,
    relativePath: module.relativePath,
    language: module.language,
    imports: module.imports.map((item: ResolvedImport) => ({ ...item })),
    exports: module.exports.map((item: ResolvedExport) => ({ ...item })),
    incomingDependencyIds: [...module.incomingDependencyIds],
    outgoingDependencyIds: [...module.outgoingDependencyIds],
  };
}
import type {
  ExternalModuleDependency,
  ModuleCycle,
  ModuleDependency,
  ResolvedExport,
  ResolvedImport,
  ResolvedModule,
  ResolvedRepositoryAnalysis,
  SymbolBinding,
  UnresolvedDependency,
} from '@lattice/core-analyzer';
