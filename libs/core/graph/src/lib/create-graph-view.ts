import type {
  KnowledgeNodeKind,
  KnowledgeRelation,
  KnowledgeRelationKind,
} from '@lattice/core-knowledge';

import { RepositoryGraphInputError } from './errors';
import {
  createTargetNeighborhood,
  projectKnowledgeNode,
  projectKnowledgeRelation,
} from './create-target-neighborhood';
import type {
  CreateGraphViewOptions,
  GraphProjection,
  GraphProjectionOmission,
  GraphViewKind,
  KnowledgeNode,
  RepositoryGraph,
} from './models';
import { compareNodes, compareRelations } from './repository-graph';

const DEFAULT_MAX_NODES = 5000;
const DEFAULT_MAX_RELATIONS = 20000;

const VIEW_FILTERS: Readonly<
  Record<
    GraphViewKind,
    {
      readonly nodeKinds: readonly KnowledgeNodeKind[];
      readonly relationKinds: readonly KnowledgeRelationKind[];
    }
  >
> = {
  repository: {
    nodeKinds: ['repository', 'project', 'folder', 'file', 'symbol'],
    relationKinds: ['contains', 'declares', 'parent-symbol'],
  },
  'project-dependencies': {
    nodeKinds: ['project'],
    relationKinds: ['project-depends-on'],
  },
  'file-dependencies': {
    nodeKinds: ['file'],
    relationKinds: ['depends-on'],
  },
  'public-api': {
    nodeKinds: ['project', 'file', 'symbol'],
    relationKinds: ['contains', 'exports'],
  },
  full: {
    nodeKinds: ['repository', 'project', 'folder', 'file', 'symbol'],
    relationKinds: [
      'contains',
      'belongs-to-project',
      'declares',
      'exports',
      'depends-on',
      'binds-to',
      'parent-symbol',
      'project-depends-on',
    ],
  },
};

export function createGraphViewProjection(
  graph: RepositoryGraph,
  options: CreateGraphViewOptions = {},
): GraphProjection {
  const kind = options.kind ?? 'repository';
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxRelations = options.maxRelations ?? DEFAULT_MAX_RELATIONS;
  const targetNodeId = options.targetNodeId;
  if (targetNodeId)
    return createTargetView(graph, kind, {
      ...options,
      targetNodeId,
      maxNodes,
      maxRelations,
    });

  const candidates = selectViewNodes(graph, kind).sort(compareNodes);
  const selected = candidates.slice(0, maxNodes);
  const selectedIds = new Set(selected.map((node) => node.id));
  const relations = selectViewRelations(graph, kind)
    .filter(
      (relation) =>
        selectedIds.has(relation.sourceNodeId) &&
        selectedIds.has(relation.targetNodeId),
    )
    .sort(compareRelations);
  const keptRelations = relations.slice(0, maxRelations);
  const omissions: GraphProjectionOmission[] = [];
  addOmission(
    omissions,
    'NODE_LIMIT',
    'node',
    candidates.length - selected.length,
  );
  addOmission(
    omissions,
    'RELATION_LIMIT',
    'relation',
    relations.length - keptRelations.length,
  );
  return {
    schemaVersion: '1',
    rootNodeIds: rootsFor(kind, selected, keptRelations, graph),
    nodes: selected.map(projectKnowledgeNode),
    edges: keptRelations.map(projectKnowledgeRelation),
    omissions,
  };
}

function createTargetView(
  graph: RepositoryGraph,
  kind: GraphViewKind,
  options: CreateGraphViewOptions & {
    readonly targetNodeId: string;
    readonly maxNodes: number;
    readonly maxRelations: number;
  },
): GraphProjection {
  const target = graph.nodeById.get(options.targetNodeId);
  if (!target)
    throw new RepositoryGraphInputError(
      'TARGET_NODE_NOT_FOUND',
      `Graph target node was not found: ${options.targetNodeId}`,
    );
  const filter = VIEW_FILTERS[kind];
  if (!filter.nodeKinds.includes(target.kind))
    throw new RepositoryGraphInputError(
      'INVALID_PROJECTION_OPTIONS',
      `Target node kind ${target.kind} is not valid for ${kind}.`,
    );
  return createTargetNeighborhood(graph, target.id, {
    direction: kind === 'repository' ? 'outgoing' : 'both',
    nodeKinds: filter.nodeKinds,
    relationKinds: filter.relationKinds,
    maxDepth: options.maxDepth ?? 2,
    maxNodes: options.maxNodes,
    maxRelations: options.maxRelations,
  });
}

function selectViewNodes(
  graph: RepositoryGraph,
  kind: GraphViewKind,
): KnowledgeNode[] {
  const all = [...graph.nodeById.values()];
  if (kind === 'public-api') {
    const publicSymbols = new Set(
      graph.knowledge.projects.flatMap((project) => project.publicSymbolIds),
    );
    const publicFiles = new Set(
      graph.knowledge.symbols
        .filter((symbol) => publicSymbols.has(symbol.id))
        .map((symbol) => symbol.fileNodeId),
    );
    return all.filter(
      (node) =>
        node.kind === 'project' ||
        (node.kind === 'symbol' && publicSymbols.has(node.id)) ||
        (node.kind === 'file' && publicFiles.has(node.id)),
    );
  }
  return all.filter((node) => VIEW_FILTERS[kind].nodeKinds.includes(node.kind));
}

function selectViewRelations(
  graph: RepositoryGraph,
  kind: GraphViewKind,
): KnowledgeRelation[] {
  const relations = [...graph.relationById.values()].filter((relation) =>
    VIEW_FILTERS[kind].relationKinds.includes(relation.kind),
  );
  if (kind !== 'repository') return relations;
  return relations.filter((relation) =>
    isCanonicalHierarchyRelation(graph, relation),
  );
}

function isCanonicalHierarchyRelation(
  graph: RepositoryGraph,
  relation: KnowledgeRelation,
): boolean {
  const source = graph.nodeById.get(relation.sourceNodeId);
  const target = graph.nodeById.get(relation.targetNodeId);
  if (!source || !target) return false;
  if (relation.kind === 'parent-symbol') return true;
  if (relation.kind === 'declares')
    return target.kind === 'symbol' && target.parentSymbolId === null;
  if (relation.kind !== 'contains') return false;
  if (source.kind === 'repository')
    return (
      target.kind === 'project' ||
      (target.kind === 'folder' && target.parentFolderId === null) ||
      (target.kind === 'file' && target.folderId === null)
    );
  if (source.kind === 'folder')
    return (
      (target.kind === 'folder' && target.parentFolderId === source.id) ||
      (target.kind === 'file' && target.folderId === source.id)
    );
  if (source.kind === 'project' && target.kind === 'folder') {
    const parent =
      target.parentFolderId === null
        ? undefined
        : graph.nodeById.get(target.parentFolderId);
    return (
      target.projectId === source.id &&
      (parent?.kind !== 'folder' || parent.projectId !== source.id)
    );
  }
  return false;
}

function rootsFor(
  kind: GraphViewKind,
  nodes: readonly KnowledgeNode[],
  relations: readonly KnowledgeRelation[],
  graph: RepositoryGraph,
): string[] {
  if (
    (kind === 'repository' || kind === 'full') &&
    nodes.some((node) => node.id === graph.knowledge.repository.id)
  )
    return [graph.knowledge.repository.id];
  const incoming = new Set(relations.map((relation) => relation.targetNodeId));
  const roots = nodes
    .filter((node) => !incoming.has(node.id))
    .map((node) => node.id);
  return roots.length > 0 ? roots : nodes.map((node) => node.id);
}

function addOmission(
  omissions: GraphProjectionOmission[],
  reason: GraphProjectionOmission['reason'],
  entityKind: GraphProjectionOmission['entityKind'],
  count: number,
): void {
  if (count > 0) omissions.push({ reason, entityKind, count });
}
