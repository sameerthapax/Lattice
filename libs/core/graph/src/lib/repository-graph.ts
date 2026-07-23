import type {
  KnowledgeNodeKind,
  KnowledgeRelation,
  KnowledgeRelationKind,
  RepositoryKnowledge,
} from '@lattice/core-knowledge';

import { RepositoryGraphInputError } from './errors';
import type {
  GraphNeighbor,
  GraphNeighborOptions,
  GraphRelationOptions,
  KnowledgeNode,
  RepositoryGraph,
} from './models';

const NODE_KINDS: readonly KnowledgeNodeKind[] = [
  'repository',
  'project',
  'folder',
  'file',
  'symbol',
];
const RELATION_KINDS: readonly KnowledgeRelationKind[] = [
  'contains',
  'belongs-to-project',
  'declares',
  'exports',
  'depends-on',
  'binds-to',
  'parent-symbol',
  'project-depends-on',
];
export function createRepositoryGraph(
  knowledge: RepositoryKnowledge,
): RepositoryGraph {
  const nodes: KnowledgeNode[] = [
    knowledge.repository,
    ...knowledge.projects,
    ...knowledge.folders,
    ...knowledge.files,
    ...knowledge.symbols,
  ];
  const nodeById = new Map<string, KnowledgeNode>();
  for (const node of nodes) {
    if (!NODE_KINDS.includes(node.kind))
      throw new RepositoryGraphInputError(
        'INVALID_NODE_KIND',
        `Unknown knowledge node kind: ${String(node.kind)}`,
      );
    if (nodeById.has(node.id))
      throw new RepositoryGraphInputError(
        'DUPLICATE_NODE_ID',
        `Duplicate knowledge node ID: ${node.id}`,
      );
    nodeById.set(node.id, node);
  }

  const relationById = new Map<string, KnowledgeRelation>();
  const outgoing = new Map<string, KnowledgeRelation[]>();
  const incoming = new Map<string, KnowledgeRelation[]>();
  for (const relation of knowledge.relations) {
    if (!RELATION_KINDS.includes(relation.kind))
      throw new RepositoryGraphInputError(
        'INVALID_RELATION_KIND',
        `Unknown knowledge relation kind: ${String(relation.kind)}`,
      );
    if (relationById.has(relation.id))
      throw new RepositoryGraphInputError(
        'DUPLICATE_RELATION_ID',
        `Duplicate knowledge relation ID: ${relation.id}`,
      );
    const source = nodeById.get(relation.sourceNodeId);
    const target = nodeById.get(relation.targetNodeId);
    if (!source || !target)
      throw new RepositoryGraphInputError(
        'MISSING_RELATION_ENDPOINT',
        `Relation references a missing node: ${relation.id}`,
      );
    if (!hasValidEndpointKinds(relation.kind, source.kind, target.kind))
      throw new RepositoryGraphInputError(
        'INCONSISTENT_ENDPOINT_KINDS',
        `Relation ${relation.id} has invalid endpoint kinds ${source.kind} -> ${target.kind}.`,
      );
    relationById.set(relation.id, relation);
    append(outgoing, relation.sourceNodeId, relation);
    append(incoming, relation.targetNodeId, relation);
  }
  for (const relations of outgoing.values()) relations.sort(compareRelations);
  for (const relations of incoming.values()) relations.sort(compareRelations);

  return {
    knowledge,
    nodeById,
    relationById,
    outgoingByNodeId: outgoing,
    incomingByNodeId: incoming,
  };
}

function hasValidEndpointKinds(
  relationKind: KnowledgeRelationKind,
  sourceKind: KnowledgeNodeKind,
  targetKind: KnowledgeNodeKind,
): boolean {
  switch (relationKind) {
    case 'contains':
      return (
        (sourceKind === 'repository' &&
          (targetKind === 'project' ||
            targetKind === 'folder' ||
            targetKind === 'file')) ||
        (sourceKind === 'project' &&
          (targetKind === 'folder' ||
            targetKind === 'file' ||
            targetKind === 'symbol')) ||
        (sourceKind === 'folder' &&
          (targetKind === 'folder' || targetKind === 'file'))
      );
    case 'belongs-to-project':
      return (
        (sourceKind === 'file' || sourceKind === 'symbol') &&
        targetKind === 'project'
      );
    case 'declares':
    case 'exports':
    case 'binds-to':
      return sourceKind === 'file' && targetKind === 'symbol';
    case 'depends-on':
      return sourceKind === 'file' && targetKind === 'file';
    case 'parent-symbol':
      return sourceKind === 'symbol' && targetKind === 'symbol';
    case 'project-depends-on':
      return sourceKind === 'project' && targetKind === 'project';
  }
}

export function getNode(
  graph: RepositoryGraph,
  nodeId: string,
): KnowledgeNode | undefined {
  return graph.nodeById.get(nodeId);
}

export function getOutgoingRelations(
  graph: RepositoryGraph,
  nodeId: string,
  options: GraphRelationOptions = {},
): readonly KnowledgeRelation[] {
  return filterRelations(graph.outgoingByNodeId.get(nodeId) ?? [], options);
}

export function getIncomingRelations(
  graph: RepositoryGraph,
  nodeId: string,
  options: GraphRelationOptions = {},
): readonly KnowledgeRelation[] {
  return filterRelations(graph.incomingByNodeId.get(nodeId) ?? [], options);
}

export function getNeighbors(
  graph: RepositoryGraph,
  nodeId: string,
  options: GraphNeighborOptions = {},
): readonly GraphNeighbor[] {
  const result: GraphNeighbor[] = [];
  const direction = options.direction ?? 'both';
  if (direction === 'outgoing' || direction === 'both')
    for (const relation of getOutgoingRelations(graph, nodeId, options)) {
      const node = graph.nodeById.get(relation.targetNodeId);
      if (node && matchesNodeKind(node, options.nodeKinds))
        result.push({ node, relation, direction: 'outgoing' });
    }
  if (direction === 'incoming' || direction === 'both')
    for (const relation of getIncomingRelations(graph, nodeId, options)) {
      const node = graph.nodeById.get(relation.sourceNodeId);
      if (node && matchesNodeKind(node, options.nodeKinds))
        result.push({ node, relation, direction: 'incoming' });
    }
  return result.sort(
    (a, b) =>
      compareNodes(a.node, b.node) ||
      compareRelations(a.relation, b.relation) ||
      compareText(a.direction, b.direction),
  );
}

export function compareNodes(a: KnowledgeNode, b: KnowledgeNode): number {
  return (
    NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) ||
    compareText(a.qualifiedName, b.qualifiedName) ||
    compareText(a.id, b.id)
  );
}

export function compareRelations(
  a: KnowledgeRelation,
  b: KnowledgeRelation,
): number {
  return (
    compareText(a.sourceNodeId, b.sourceNodeId) ||
    compareText(a.kind, b.kind) ||
    compareText(a.targetNodeId, b.targetNodeId) ||
    compareText(a.id, b.id)
  );
}

function append(
  map: Map<string, KnowledgeRelation[]>,
  key: string,
  relation: KnowledgeRelation,
): void {
  map.set(key, [...(map.get(key) ?? []), relation]);
}

function filterRelations(
  relations: readonly KnowledgeRelation[],
  options: GraphRelationOptions,
): readonly KnowledgeRelation[] {
  if (!options.relationKinds) return relations;
  const kinds = new Set(options.relationKinds);
  return relations.filter((relation) => kinds.has(relation.kind));
}

function matchesNodeKind(
  node: KnowledgeNode,
  kinds: readonly KnowledgeNodeKind[] | undefined,
): boolean {
  return kinds === undefined || kinds.includes(node.kind);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}
