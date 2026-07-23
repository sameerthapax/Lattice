import type { ElementDefinition, StylesheetJson } from 'cytoscape';
import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  RepositoryGraphArtifact,
} from '@lattice/core-graph';

export interface GraphFilters {
  readonly query: string;
  readonly nodeKinds: ReadonlySet<string>;
  readonly relationKinds: ReadonlySet<string>;
}

export interface RepositoryExplorationOptions {
  readonly expandedNodeIds: ReadonlySet<string>;
  readonly collapsedNodeIds: ReadonlySet<string>;
  readonly isolatedNodeId?: string;
  readonly depth: number;
}

export interface GraphCircle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const HIERARCHY_RELATION_KINDS = new Set([
  'contains',
  'declares',
  'parent-symbol',
]);

export const NODE_COLORS: Readonly<Record<string, string>> = {
  repository: '#27272a',
  project: '#0f766e',
  folder: '#b45309',
  file: '#315f85',
  symbol: '#b53a5d',
};

export function toCytoscapeElements(
  artifact: RepositoryGraphArtifact,
): readonly ElementDefinition[] {
  const connectionCountByNodeId = new Map<string, number>();
  for (const edge of artifact.graph.edges) {
    connectionCountByNodeId.set(
      edge.sourceId,
      (connectionCountByNodeId.get(edge.sourceId) ?? 0) + 1,
    );
    if (edge.targetId !== edge.sourceId) {
      connectionCountByNodeId.set(
        edge.targetId,
        (connectionCountByNodeId.get(edge.targetId) ?? 0) + 1,
      );
    }
  }
  return [
    ...artifact.graph.nodes.map((node) =>
      toNodeElement(node, connectionCountByNodeId.get(node.id) ?? 0),
    ),
    ...artifact.graph.edges.map(toEdgeElement),
  ];
}

export function toNodeElement(
  node: GraphProjectionNode,
  connectionCount = 0,
): ElementDefinition {
  const size = nodeSize(connectionCount);
  const fontSize = nodeFontSize(size);
  return {
    group: 'nodes',
    data: {
      ...node,
      color: NODE_COLORS[node.kind] ?? '#71717a',
      connectionCount,
      baseSize: size,
      size,
      fontSize,
      displayLabel: displayNodeLabel(node.label, size, fontSize),
      labelWidth: Math.max(22, size * 0.78),
    },
  };
}

export function toEdgeElement(edge: GraphProjectionEdge): ElementDefinition {
  return {
    group: 'edges',
    data: {
      ...edge,
      source: edge.sourceId,
      target: edge.targetId,
    },
  };
}

export function visibleElementIds(
  artifact: RepositoryGraphArtifact,
  filters: GraphFilters,
): ReadonlySet<string> {
  const query = filters.query.trim().toLocaleLowerCase('en');
  const visibleNodes = new Set(
    artifact.graph.nodes
      .filter(
        (node) =>
          filters.nodeKinds.has(node.kind) &&
          (query.length === 0 || searchableNodeText(node).includes(query)),
      )
      .map((node) => node.id),
  );
  return new Set([
    ...visibleNodes,
    ...artifact.graph.edges
      .filter(
        (edge) =>
          filters.relationKinds.has(edge.kind) &&
          visibleNodes.has(edge.sourceId) &&
          visibleNodes.has(edge.targetId),
      )
      .map((edge) => edge.id),
  ]);
}

export function repositoryExplorationNodeIds(
  artifact: RepositoryGraphArtifact,
  options: RepositoryExplorationOptions,
): ReadonlySet<string> {
  if (options.isolatedNodeId) {
    return isolatedNeighborhoodNodeIds(
      artifact,
      options.isolatedNodeId,
      options.depth,
    );
  }
  if (artifact.view.kind !== 'repository') {
    return new Set(artifact.graph.nodes.map((node) => node.id));
  }
  const roots =
    artifact.graph.rootNodeIds.length > 0
      ? artifact.graph.rootNodeIds
      : artifact.graph.nodes
          .filter((node) => node.kind === 'repository')
          .map((node) => node.id);
  const childrenByNodeId = adjacencyBySource(
    artifact.graph.edges.filter((edge) =>
      HIERARCHY_RELATION_KINDS.has(edge.kind),
    ),
  );
  const visible = new Set<string>();
  const bestRemainingDepth = new Map<string, number>();
  const queue = roots.map((nodeId) => ({ nodeId, remaining: options.depth }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const remaining = Math.max(
      current.remaining,
      options.expandedNodeIds.has(current.nodeId) ? options.depth : 0,
    );
    if ((bestRemainingDepth.get(current.nodeId) ?? -1) >= remaining) continue;
    bestRemainingDepth.set(current.nodeId, remaining);
    visible.add(current.nodeId);
    if (remaining === 0 || options.collapsedNodeIds.has(current.nodeId)) {
      continue;
    }
    for (const childId of childrenByNodeId.get(current.nodeId) ?? []) {
      queue.push({ nodeId: childId, remaining: remaining - 1 });
    }
  }
  return visible;
}

export function hasHiddenHierarchyChildren(
  artifact: RepositoryGraphArtifact,
  nodeId: string,
  visibleNodeIds: ReadonlySet<string>,
): boolean {
  return artifact.graph.edges.some(
    (edge) =>
      edge.sourceId === nodeId &&
      HIERARCHY_RELATION_KINDS.has(edge.kind) &&
      !visibleNodeIds.has(edge.targetId),
  );
}

export function resolveCircleCollisions(
  circles: readonly GraphCircle[],
  gap = 10,
  iterations = 32,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const positions = [...circles]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((circle) => ({ ...circle }));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let collisionFound = false;
    for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
      const left = positions[leftIndex];
      if (!left) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < positions.length;
        rightIndex += 1
      ) {
        const right = positions[rightIndex];
        if (!right) continue;
        let deltaX = right.x - left.x;
        let deltaY = right.y - left.y;
        let distance = Math.hypot(deltaX, deltaY);
        const minimumDistance = left.radius + right.radius + gap;
        if (distance >= minimumDistance) continue;
        collisionFound = true;
        if (distance < 0.001) {
          const angle = deterministicAngle(left.id, right.id);
          deltaX = Math.cos(angle);
          deltaY = Math.sin(angle);
          distance = 1;
        }
        const displacement = (minimumDistance - distance) / 2;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        left.x -= unitX * displacement;
        left.y -= unitY * displacement;
        right.x += unitX * displacement;
        right.y += unitY * displacement;
      }
    }
    if (!collisionFound) break;
  }
  return new Map(positions.map(({ id, x, y }) => [id, { x, y }] as const));
}

function isolatedNeighborhoodNodeIds(
  artifact: RepositoryGraphArtifact,
  targetNodeId: string,
  _depth: number,
): ReadonlySet<string> {
  const visible = new Set([targetNodeId]);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of artifact.graph.edges) {
    if (HIERARCHY_RELATION_KINDS.has(edge.kind)) {
      addAdjacent(parents, edge.targetId, edge.sourceId);
      addAdjacent(children, edge.sourceId, edge.targetId);
    }
  }
  const descendantQueue = [targetNodeId];
  while (descendantQueue.length > 0) {
    const nodeId = descendantQueue.shift();
    if (!nodeId) break;
    for (const childId of children.get(nodeId) ?? []) {
      if (visible.has(childId)) continue;
      visible.add(childId);
      descendantQueue.push(childId);
    }
  }
  let frontier = [targetNodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const parentId of parents.get(nodeId) ?? []) {
        if (visible.has(parentId)) continue;
        visible.add(parentId);
        next.push(parentId);
      }
    }
    frontier = next;
  }
  return visible;
}

function adjacencyBySource(
  edges: RepositoryGraphArtifact['graph']['edges'],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const edge of edges) addAdjacent(result, edge.sourceId, edge.targetId);
  for (const values of result.values()) values.sort();
  return result;
}

function addAdjacent(
  adjacency: Map<string, string[]>,
  nodeId: string,
  adjacentNodeId: string,
): void {
  const values = adjacency.get(nodeId) ?? [];
  if (!values.includes(adjacentNodeId)) values.push(adjacentNodeId);
  adjacency.set(nodeId, values);
}

export function graphStyles(): StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        label: 'data(displayLabel)',
        color: '#fafafa',
        'font-family': 'Geist, ui-sans-serif, system-ui',
        'font-size': 'data(fontSize)',
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-overflow-wrap': 'anywhere',
        'text-justification': 'center',
        'line-height': 1.05,
        'text-max-width': 'data(labelWidth)',
        width: 'data(size)',
        height: 'data(size)',
        'border-width': 2,
        'border-color': '#fafafa',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.25,
        'line-color': '#62626b',
        'target-arrow-color': '#52525b',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        opacity: 0.82,
      },
    },
    {
      selector: ':selected',
      style: {
        'border-color': '#14b8a6',
        'border-width': 4,
        'line-color': '#0f766e',
        'target-arrow-color': '#0f766e',
        opacity: 1,
      },
    },
    { selector: '.filtered', style: { display: 'none' } },
  ];
}

function searchableNodeText(node: GraphProjectionNode): string {
  return [node.id, node.label, node.subtitle, node.path]
    .filter((value): value is string => value !== undefined)
    .join('\n')
    .toLocaleLowerCase('en');
}

function nodeSize(connectionCount: number): number {
  return Math.min(88, Math.round(38 + Math.sqrt(connectionCount) * 6));
}

function nodeFontSize(size: number): number {
  return Math.min(22, Math.max(8, Math.round(size / 6.75)));
}

function displayNodeLabel(
  label: string,
  size: number,
  fontSize: number,
): string {
  const characterLimit = Math.max(
    8,
    Math.min(30, Math.floor((size / fontSize) * 3)),
  );
  return label.length <= characterLimit
    ? label
    : `${label.slice(0, characterLimit - 1)}…`;
}

function deterministicAngle(leftId: string, rightId: string): number {
  let hash = 0;
  for (const character of `${leftId}:${rightId}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (hash / 0xffffffff) * Math.PI * 2;
}
