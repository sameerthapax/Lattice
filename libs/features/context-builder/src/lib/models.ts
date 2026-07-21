import type {
  ModuleDependencyKind,
  SymbolBindingKind,
  ExportResolutionStatus,
} from '@lattice/core-analyzer';
import type {
  FileKnowledgeStatus,
  WorkspaceProjectKind,
} from '@lattice/core-knowledge';
import type {
  SourceLocation,
  SourceSymbolKind,
  ParseDiagnostic,
} from '@lattice/core-parser';
import type { RepositoryScan } from '@lattice/core-indexer';
import type { RepositoryAnalysis } from '@lattice/core-parser';
import type { ResolvedRepositoryAnalysis } from '@lattice/core-analyzer';
import type { RepositoryKnowledge } from '@lattice/core-knowledge';

export interface FileContextTarget {
  readonly kind: 'file';
  readonly fileId?: string;
  readonly relativePath?: string;
}
export interface SymbolContextTarget {
  readonly kind: 'symbol';
  readonly symbolId?: string;
  readonly qualifiedName?: string;
  readonly fileId?: string;
  readonly fileRelativePath?: string;
}
export interface FolderContextTarget {
  readonly kind: 'folder';
  readonly folderId?: string;
  readonly relativePath?: string;
}
export interface ProjectContextTarget {
  readonly kind: 'project';
  readonly projectId?: string;
  readonly name?: string;
  readonly rootRelativePath?: string;
}
export type ContextTarget =
  | FileContextTarget
  | SymbolContextTarget
  | FolderContextTarget
  | ProjectContextTarget;

export interface ContextSelectionOptions {
  readonly includeSource?: boolean;
  readonly maxFiles?: number;
  readonly maxSymbols?: number;
  readonly maxRelations?: number;
  readonly maxExcerpts?: number;
  readonly maxExcerptCharacters?: number;
  readonly maxTotalSourceCharacters?: number;
  readonly dependencyDepth?: number;
  readonly dependentDepth?: number;
  readonly folderDepth?: number;
  readonly includeExternalDependencies?: boolean;
  readonly includeDiagnostics?: boolean;
}
export type NormalizedContextSelectionOptions =
  Required<ContextSelectionOptions>;
export interface ContextSourceProvider {
  readSource(input: {
    readonly fileId: string;
    readonly relativePath: string;
    readonly expectedContentHash: string;
  }): Promise<ContextSourceFile>;
}
export interface ContextSourceFile {
  readonly fileId: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly content: string;
}
export interface BuildContextPackageInput {
  readonly scan: RepositoryScan;
  readonly analysis: RepositoryAnalysis;
  readonly resolution: ResolvedRepositoryAnalysis;
  readonly knowledge: RepositoryKnowledge;
  readonly target: ContextTarget;
  readonly options?: ContextSelectionOptions;
  readonly sourceProvider?: ContextSourceProvider;
}

export type ContextSelectionReason =
  | 'target'
  | 'contains-target'
  | 'target-declaration'
  | 'target-export'
  | 'parent-symbol'
  | 'child-symbol'
  | 'same-file-symbol'
  | 'direct-dependency'
  | 'transitive-dependency'
  | 'direct-dependent'
  | 'transitive-dependent'
  | 'bound-symbol'
  | 'binding-source'
  | 'project-entry-point'
  | 'project-public-symbol'
  | 'folder-member'
  | 'project-member';
export interface ResolvedContextTarget {
  readonly kind: ContextTarget['kind'];
  readonly nodeId: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly relativePath: string | null;
  readonly projectId: string | null;
  readonly fileId: string | null;
  readonly symbolId: string | null;
}
export interface ContextRepositorySummary {
  readonly nodeId: string;
  readonly name: string;
  readonly projectCount: number;
  readonly fileCount: number;
  readonly symbolCount: number;
}
export interface ContextHierarchy {
  readonly repositoryId: string;
  readonly projectIds: string[];
  readonly folderIds: string[];
  readonly fileIds: string[];
  readonly symbolIds: string[];
}
export interface ContextProject {
  readonly nodeId: string;
  readonly name: string;
  readonly projectKind: WorkspaceProjectKind;
  readonly rootRelativePath: string;
  readonly sourceRootRelativePath: string | null;
  readonly publicSymbolIds: string[];
  readonly incomingProjectDependencyCount: number;
  readonly outgoingProjectDependencyCount: number;
}
export interface ContextFolder {
  readonly nodeId: string;
  readonly relativePath: string;
  readonly projectId: string | null;
  readonly parentFolderId: string | null;
  readonly descendantFileCount: number;
  readonly descendantSymbolCount: number;
}
export interface ContextFile {
  readonly nodeId: string;
  readonly fileId: string;
  readonly relativePath: string;
  readonly projectId: string | null;
  readonly folderId: string | null;
  readonly language: string | null;
  readonly status: FileKnowledgeStatus;
  readonly contentHash: string;
  readonly symbolIds: string[];
  readonly publicSymbolIds: string[];
  readonly importCount: number;
  readonly exportCount: number;
  readonly incomingInternalDependencyCount: number;
  readonly outgoingInternalDependencyCount: number;
  readonly externalDependencyCount: number;
  readonly diagnosticCount: number;
  readonly hasSyntaxErrors: boolean;
  readonly diagnostics: ParseDiagnostic[];
  readonly selectionReasons: ContextSelectionReason[];
}
export interface ContextSymbol {
  readonly nodeId: string;
  readonly symbolId: string;
  readonly fileId: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly symbolKind: SourceSymbolKind;
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly typeOnly: boolean;
  readonly async: boolean;
  readonly parentSymbolId: string | null;
  readonly childSymbolIds: string[];
  readonly incomingBindingCount: number;
  readonly location: SourceLocation;
  readonly selectionReasons: ContextSelectionReason[];
}
export interface ContextExternalModule {
  readonly sourceSpecifier: string;
  readonly sourceFileIds: string[];
  readonly typeOnly: boolean;
  readonly contributingEntityIds: string[];
}
export interface ContextEntities {
  readonly projects: ContextProject[];
  readonly folders: ContextFolder[];
  readonly files: ContextFile[];
  readonly symbols: ContextSymbol[];
  readonly externalModules: ContextExternalModule[];
}
export interface ContextFileDependency {
  readonly id: string;
  readonly sourceFileId: string;
  readonly targetFileId: string;
  readonly sourceSpecifier: string;
  readonly kind: ModuleDependencyKind;
  readonly typeOnly: boolean;
  readonly depthFromTarget: number;
}
export interface ContextSymbolBinding {
  readonly id: string;
  readonly sourceFileId: string;
  readonly targetSymbolId: string;
  readonly bindingKind: SymbolBindingKind;
  readonly importedName: string | null;
  readonly localName: string | null;
  readonly typeOnly: boolean;
}
export interface ContextExportRelationship {
  readonly id: string;
  readonly fileId: string;
  readonly exportedName: string;
  readonly targetSymbolId: string | null;
  readonly targetFileId: string | null;
  readonly typeOnly: boolean;
  readonly defaultExport: boolean;
  readonly status: ExportResolutionStatus;
}
export interface ContextContainmentRelationship {
  readonly id: string;
  readonly parentNodeId: string;
  readonly childNodeId: string;
  readonly kind: 'contains' | 'declares' | 'parent-symbol';
}
export interface ContextProjectDependency {
  readonly id: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly dependencyCount: number;
  readonly typeOnlyDependencyCount: number;
}
export interface ContextRelationships {
  readonly fileDependencies: ContextFileDependency[];
  readonly symbolBindings: ContextSymbolBinding[];
  readonly exports: ContextExportRelationship[];
  readonly containment: ContextContainmentRelationship[];
  readonly projectDependencies: ContextProjectDependency[];
}
export type ContextExcerptReason =
  | 'target-symbol'
  | 'target-file-header'
  | 'exported-symbol'
  | 'bound-symbol'
  | 'dependency-entry-point'
  | 'project-entry-point';
export interface ContextSourceExcerpt {
  readonly id: string;
  readonly fileId: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly text: string;
  readonly reasons: ContextExcerptReason[];
  readonly symbolIds: string[];
  readonly truncated: boolean;
}
export type ContextOmissionReason =
  | 'FILE_LIMIT'
  | 'SYMBOL_LIMIT'
  | 'RELATION_LIMIT'
  | 'EXCERPT_LIMIT'
  | 'EXCERPT_CHARACTER_LIMIT'
  | 'TOTAL_SOURCE_CHARACTER_LIMIT'
  | 'SOURCE_DISABLED'
  | 'SOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_FILE'
  | 'BINARY_FILE'
  | 'FAILED_FILE'
  | 'UNRESOLVED_RELATIONSHIP';
export interface ContextOmission {
  readonly reason: ContextOmissionReason;
  readonly entityKind: 'file' | 'symbol' | 'relation' | 'excerpt' | 'source';
  readonly entityId: string | null;
  readonly count: number;
  readonly details: string | null;
}
export interface ContextPackageMetrics {
  readonly sourceCharacterCount: number;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly relationCount: number;
  readonly excerptCount: number;
  readonly projectCount: number;
  readonly folderCount: number;
  readonly externalModuleCount: number;
}
export interface ContextSelectionSummary {
  readonly requestedTarget: ContextTarget;
  readonly resolvedTargetNodeId: string;
  readonly options: NormalizedContextSelectionOptions;
  readonly selectedFileCount: number;
  readonly selectedSymbolCount: number;
  readonly selectedRelationCount: number;
  readonly selectedExcerptCount: number;
  readonly omittedFileCount: number;
  readonly omittedSymbolCount: number;
  readonly omittedRelationCount: number;
  readonly omittedExcerptCount: number;
}
export interface ContextPackage {
  readonly schemaVersion: '1';
  readonly id: string;
  readonly target: ResolvedContextTarget;
  readonly repository: ContextRepositorySummary;
  readonly hierarchy: ContextHierarchy;
  readonly entities: ContextEntities;
  readonly relationships: ContextRelationships;
  readonly excerpts: ContextSourceExcerpt[];
  readonly omissions: ContextOmission[];
  readonly metrics: ContextPackageMetrics;
  readonly selection: ContextSelectionSummary;
}
