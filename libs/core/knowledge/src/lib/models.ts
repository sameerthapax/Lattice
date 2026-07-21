import type { SourceLocation, SourceSymbolKind } from '@lattice/core-parser';

export type WorkspaceProjectKind = 'application' | 'library' | 'unknown';

export interface WorkspaceProjectEntryPoint {
  readonly exportName?: string;
  readonly relativePath: string;
}

export interface WorkspaceProjectDefinition {
  readonly name: string;
  readonly kind: WorkspaceProjectKind;
  readonly rootRelativePath: string;
  readonly sourceRootRelativePath?: string;
  readonly entryPoints?: readonly WorkspaceProjectEntryPoint[];
}

export type KnowledgeNodeKind =
  'repository' | 'project' | 'folder' | 'file' | 'symbol';

export interface BaseKnowledgeNode {
  readonly id: string;
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly qualifiedName: string;
}

export interface RepositoryKnowledgeNode extends BaseKnowledgeNode {
  readonly kind: 'repository';
  readonly rootPath: string;
  readonly projectIds: readonly string[];
  readonly topLevelFolderIds: readonly string[];
  readonly fileIds: readonly string[];
}

export interface ProjectKnowledgeNode extends BaseKnowledgeNode {
  readonly kind: 'project';
  readonly projectKind: WorkspaceProjectKind;
  readonly rootRelativePath: string;
  readonly sourceRootRelativePath: string | null;
  readonly folderIds: readonly string[];
  readonly fileIds: readonly string[];
  readonly symbolIds: readonly string[];
  readonly incomingProjectDependencyIds: readonly string[];
  readonly outgoingProjectDependencyIds: readonly string[];
  readonly publicSymbolIds: readonly string[];
}

export interface FolderKnowledgeNode extends BaseKnowledgeNode {
  readonly kind: 'folder';
  readonly relativePath: string;
  readonly parentFolderId: string | null;
  readonly projectId: string | null;
  readonly childFolderIds: readonly string[];
  readonly fileIds: readonly string[];
  readonly descendantFileCount: number;
  readonly descendantSymbolCount: number;
}

export type FileKnowledgeStatus = 'parsed' | 'skipped' | 'failed';

export interface FileKnowledgeNode extends BaseKnowledgeNode {
  readonly kind: 'file';
  readonly fileId: string;
  readonly relativePath: string;
  readonly folderId: string | null;
  readonly projectId: string | null;
  readonly language: string | null;
  readonly contentHash: string;
  readonly status: FileKnowledgeStatus;
  readonly symbolIds: readonly string[];
  readonly publicSymbolIds: readonly string[];
  readonly importCount: number;
  readonly exportCount: number;
  readonly internalDependencyCount: number;
  readonly externalDependencyCount: number;
  readonly incomingFileDependencyIds: readonly string[];
  readonly outgoingFileDependencyIds: readonly string[];
  readonly diagnosticCount: number;
  readonly hasSyntaxErrors: boolean;
  readonly orphan: boolean;
}

export interface SymbolKnowledgeNode extends BaseKnowledgeNode {
  readonly kind: 'symbol';
  readonly symbolId: string;
  readonly symbolKind: SourceSymbolKind;
  readonly fileId: string;
  readonly fileNodeId: string;
  readonly folderId: string | null;
  readonly projectId: string | null;
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly typeOnly: boolean;
  readonly async: boolean;
  readonly parentSymbolId: string | null;
  readonly childSymbolIds: readonly string[];
  readonly incomingBindingIds: readonly string[];
  readonly location: SourceLocation;
}

export type KnowledgeRelationKind =
  | 'contains'
  | 'belongs-to-project'
  | 'declares'
  | 'exports'
  | 'depends-on'
  | 'binds-to'
  | 'parent-symbol'
  | 'project-depends-on';

export type KnowledgeRelationMetadata =
  | {
      readonly type: 'dependency';
      readonly dependencyId: string;
      readonly typeOnly: boolean;
    }
  | {
      readonly type: 'export';
      readonly exportId: string;
      readonly exportedName: string;
      readonly typeOnly: boolean;
    }
  | {
      readonly type: 'binding';
      readonly bindingId: string;
      readonly bindingKind: string;
      readonly importedName: string | null;
      readonly localName: string | null;
      readonly typeOnly: boolean;
    }
  | {
      readonly type: 'project-dependency';
      readonly projectDependencyId: string;
      readonly dependencyCount: number;
      readonly typeOnlyDependencyCount: number;
    };

export interface KnowledgeRelation {
  readonly id: string;
  readonly kind: KnowledgeRelationKind;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourceEntityId: string | null;
  readonly metadata: KnowledgeRelationMetadata | null;
}

export interface ProjectDependency {
  readonly id: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly fileDependencyIds: readonly string[];
  readonly dependencyCount: number;
  readonly typeOnlyDependencyCount: number;
}

export interface RepositoryKnowledgeSummary {
  readonly projectCount: number;
  readonly folderCount: number;
  readonly fileCount: number;
  readonly parsedFileCount: number;
  readonly symbolCount: number;
  readonly publicFileSymbolCount: number;
  readonly publicProjectSymbolCount: number;
  readonly internalFileDependencyCount: number;
  readonly crossProjectDependencyCount: number;
  readonly orphanFileCount: number;
  readonly rootFileCount: number;
}

export interface RepositoryKnowledge {
  readonly repository: RepositoryKnowledgeNode;
  readonly projects: readonly ProjectKnowledgeNode[];
  readonly folders: readonly FolderKnowledgeNode[];
  readonly files: readonly FileKnowledgeNode[];
  readonly symbols: readonly SymbolKnowledgeNode[];
  readonly relations: readonly KnowledgeRelation[];
  readonly projectDependencies: readonly ProjectDependency[];
  readonly summaries: RepositoryKnowledgeSummary;
}
