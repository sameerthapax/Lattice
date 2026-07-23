import type {
  KnowledgeRelation,
  KnowledgeRelationMetadata,
} from '@lattice/core-knowledge';

import { RepositoryGraphInputError } from './errors';
import type {
  CreateTargetNeighborhoodOptions,
  GraphProjection,
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionOmission,
  KnowledgeNode,
  RepositoryGraph,
} from './models';
import {
  compareNodes,
  compareRelations,
  getNeighbors,
} from './repository-graph';

const DEFAULTS = {
  direction: 'both' as const,
  maxDepth: 1,
  maxNodes: 50,
  maxRelations: 100,
};
const CEILINGS = { maxDepth: 10, maxNodes: 5000, maxRelations: 20000 } as const;

interface DiscoveredNode {
  readonly node: KnowledgeNode;
  readonly depth: number;
}

export function createTargetNeighborhood(
  graph: RepositoryGraph,
  targetNodeId: string,
  options: CreateTargetNeighborhoodOptions = {},
): GraphProjection {
  const target = graph.nodeById.get(targetNodeId);
  if (!target)
    throw new RepositoryGraphInputError(
      'TARGET_NODE_NOT_FOUND',
      `Graph target node was not found: ${targetNodeId}`,
    );
  const normalized = {
    ...DEFAULTS,
    ...options,
  };
  validateOptions(normalized);

  const discovered = discoverNodes(graph, target, normalized);
  const selected = discovered.slice(0, normalized.maxNodes);
  const selectedIds = new Set(selected.map((item) => item.node.id));
  const candidateRelations = [...graph.relationById.values()]
    .filter(
      (relation) =>
        selectedIds.has(relation.sourceNodeId) &&
        selectedIds.has(relation.targetNodeId) &&
        (!normalized.relationKinds ||
          normalized.relationKinds.includes(relation.kind)),
    )
    .sort(compareRelations);
  const relations = candidateRelations.slice(0, normalized.maxRelations);
  const omissions: GraphProjectionOmission[] = [];
  addOmission(
    omissions,
    'NODE_LIMIT',
    'node',
    discovered.length - selected.length,
  );
  addOmission(
    omissions,
    'RELATION_LIMIT',
    'relation',
    candidateRelations.length - relations.length,
  );

  return {
    schemaVersion: '1',
    rootNodeIds: [targetNodeId],
    nodes: selected.map((item) => projectKnowledgeNode(item.node)),
    edges: relations.map(projectKnowledgeRelation),
    omissions,
  };
}

function discoverNodes(
  graph: RepositoryGraph,
  target: KnowledgeNode,
  options: Required<
    Pick<
      CreateTargetNeighborhoodOptions,
      'direction' | 'maxDepth' | 'maxNodes' | 'maxRelations'
    >
  > &
    CreateTargetNeighborhoodOptions,
): DiscoveredNode[] {
  const discovered = new Map<string, DiscoveredNode>([
    [target.id, { node: target, depth: 0 }],
  ]);
  let frontier = [target];
  for (let depth = 1; depth <= options.maxDepth; depth += 1) {
    const next = new Map<string, KnowledgeNode>();
    for (const node of frontier.sort(compareNodes))
      for (const neighbor of getNeighbors(graph, node.id, options))
        if (!discovered.has(neighbor.node.id) && !next.has(neighbor.node.id))
          next.set(neighbor.node.id, neighbor.node);
    const ordered = [...next.values()].sort(compareNodes);
    for (const node of ordered) discovered.set(node.id, { node, depth });
    frontier = ordered;
  }
  return [...discovered.values()].sort(
    (a, b) => a.depth - b.depth || compareNodes(a.node, b.node),
  );
}

export function projectKnowledgeNode(node: KnowledgeNode): GraphProjectionNode {
  const base = {
    id: node.id,
    kind: node.kind,
    label: node.name,
    ...(node.qualifiedName === node.name
      ? {}
      : { subtitle: node.qualifiedName }),
  };
  switch (node.kind) {
    case 'repository':
      return {
        id: node.id,
        kind: node.kind,
        label: node.name,
        metadata: {
          projectCount: node.projectIds.length,
          fileCount: node.fileIds.length,
        },
      };
    case 'project':
      return {
        ...base,
        path: node.rootRelativePath,
        metadata: {
          projectKind: node.projectKind,
          fileCount: node.fileIds.length,
          symbolCount: node.symbolIds.length,
          publicSymbolCount: node.publicSymbolIds.length,
        },
      };
    case 'folder':
      return {
        ...base,
        path: node.relativePath,
        ...(node.projectId === null ? {} : { projectId: node.projectId }),
        metadata: {
          descendantFileCount: node.descendantFileCount,
          descendantSymbolCount: node.descendantSymbolCount,
        },
      };
    case 'file':
      return {
        ...base,
        path: node.relativePath,
        ...(node.projectId === null ? {} : { projectId: node.projectId }),
        metadata: {
          status: node.status,
          ...(node.language === null ? {} : { language: node.language }),
          symbolCount: node.symbolIds.length,
          publicSymbolCount: node.publicSymbolIds.length,
          internalDependencyCount: node.internalDependencyCount,
          externalDependencyCount: node.externalDependencyCount,
          hasSyntaxErrors: node.hasSyntaxErrors,
          orphan: node.orphan,
        },
      };
    case 'symbol':
      return {
        ...base,
        ...(node.projectId === null ? {} : { projectId: node.projectId }),
        metadata: {
          symbolKind: node.symbolKind,
          exported: node.exported,
          defaultExport: node.defaultExport,
          typeOnly: node.typeOnly,
          async: node.async,
          startLine: node.location.startLine,
          startColumn: node.location.startColumn,
        },
      };
  }
}

export function projectKnowledgeRelation(
  relation: KnowledgeRelation,
): GraphProjectionEdge {
  return {
    id: relation.id,
    sourceId: relation.sourceNodeId,
    targetId: relation.targetNodeId,
    kind: relation.kind,
    label: relation.kind,
    metadata: projectMetadata(relation.metadata),
  };
}

function projectMetadata(
  metadata: KnowledgeRelationMetadata | null,
): Readonly<Record<string, string | number | boolean>> {
  if (metadata === null) return {};
  switch (metadata.type) {
    case 'dependency':
      return { typeOnly: metadata.typeOnly };
    case 'export':
      return {
        exportedName: metadata.exportedName,
        typeOnly: metadata.typeOnly,
      };
    case 'binding':
      return {
        bindingKind: metadata.bindingKind,
        ...(metadata.importedName === null
          ? {}
          : { importedName: metadata.importedName }),
        ...(metadata.localName === null
          ? {}
          : { localName: metadata.localName }),
        typeOnly: metadata.typeOnly,
      };
    case 'project-dependency':
      return {
        dependencyCount: metadata.dependencyCount,
        typeOnlyDependencyCount: metadata.typeOnlyDependencyCount,
      };
  }
}

function validateOptions(options: {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxRelations: number;
}): void {
  for (const [key, ceiling] of Object.entries(CEILINGS)) {
    const value = options[key as keyof typeof CEILINGS];
    if (
      !Number.isInteger(value) ||
      value < (key === 'maxDepth' ? 0 : 1) ||
      value > ceiling
    )
      throw new RepositoryGraphInputError(
        'INVALID_PROJECTION_OPTIONS',
        `Invalid graph projection option ${key}.`,
      );
  }
}

function addOmission(
  omissions: GraphProjectionOmission[],
  reason: GraphProjectionOmission['reason'],
  entityKind: GraphProjectionOmission['entityKind'],
  count: number,
): void {
  if (count > 0) omissions.push({ reason, entityKind, count });
}
