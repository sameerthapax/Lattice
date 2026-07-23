import type {
  FileKnowledgeNode,
  FolderKnowledgeNode,
  KnowledgeNodeKind,
  KnowledgeRelation,
  KnowledgeRelationKind,
  ProjectKnowledgeNode,
  RepositoryKnowledge,
  RepositoryKnowledgeNode,
  SymbolKnowledgeNode,
} from '@lattice/core-knowledge';

export type KnowledgeNode =
  | RepositoryKnowledgeNode
  | ProjectKnowledgeNode
  | FolderKnowledgeNode
  | FileKnowledgeNode
  | SymbolKnowledgeNode;

export interface RepositoryGraph {
  readonly knowledge: RepositoryKnowledge;
  readonly nodeById: ReadonlyMap<string, KnowledgeNode>;
  readonly relationById: ReadonlyMap<string, KnowledgeRelation>;
  readonly outgoingByNodeId: ReadonlyMap<string, readonly KnowledgeRelation[]>;
  readonly incomingByNodeId: ReadonlyMap<string, readonly KnowledgeRelation[]>;
}

export interface GraphRelationOptions {
  readonly relationKinds?: readonly KnowledgeRelationKind[];
}

export type GraphDirection = 'incoming' | 'outgoing' | 'both';

export interface GraphNeighborOptions extends GraphRelationOptions {
  readonly direction?: GraphDirection;
  readonly nodeKinds?: readonly KnowledgeNodeKind[];
}

export interface GraphNeighbor {
  readonly node: KnowledgeNode;
  readonly relation: KnowledgeRelation;
  readonly direction: Exclude<GraphDirection, 'both'>;
}

export interface CreateTargetNeighborhoodOptions extends GraphNeighborOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxRelations?: number;
}

export interface GraphProjection {
  readonly schemaVersion: '1';
  readonly rootNodeIds: readonly string[];
  readonly nodes: readonly GraphProjectionNode[];
  readonly edges: readonly GraphProjectionEdge[];
  readonly omissions: readonly GraphProjectionOmission[];
}

export interface GraphProjectionNode {
  readonly id: string;
  readonly kind: KnowledgeNodeKind;
  readonly label: string;
  readonly subtitle?: string;
  readonly path?: string;
  readonly projectId?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface GraphProjectionEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: KnowledgeRelationKind;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type GraphProjectionOmissionReason = 'NODE_LIMIT' | 'RELATION_LIMIT';

export interface GraphProjectionOmission {
  readonly reason: GraphProjectionOmissionReason;
  readonly entityKind: 'node' | 'relation';
  readonly count: number;
}

export type GraphViewKind =
  | 'repository'
  | 'project-dependencies'
  | 'file-dependencies'
  | 'public-api'
  | 'full';

export interface CreateGraphViewOptions {
  readonly kind?: GraphViewKind;
  readonly targetNodeId?: string;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxRelations?: number;
}

export interface RepositoryGraphArtifact {
  readonly artifactKind: 'repository-graph';
  readonly schemaVersion: '1';
  readonly repository: {
    readonly id: string;
    readonly name: string;
  };
  readonly view: {
    readonly kind: GraphViewKind;
    readonly targetNodeId: string | null;
    readonly maxDepth: number | null;
    readonly maxNodes: number;
    readonly maxRelations: number;
  };
  readonly summary: {
    readonly nodeCount: number;
    readonly edgeCount: number;
    readonly omissionCount: number;
  };
  readonly graph: GraphProjection;
}
