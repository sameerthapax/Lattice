import type { RepositoryGraphArtifact } from '@lattice/core-graph';
import { describe, expect, it } from 'vitest';

import {
  repositoryExplorationNodeIds,
  resolveCircleCollisions,
  toCytoscapeElements,
  toNodeElement,
  visibleElementIds,
} from './cytoscape-elements';

const artifact: RepositoryGraphArtifact = {
  artifactKind: 'repository-graph',
  schemaVersion: '1',
  repository: { id: 'repo', name: 'fixture' },
  view: {
    kind: 'file-dependencies',
    targetNodeId: null,
    maxDepth: null,
    maxNodes: 500,
    maxRelations: 2000,
  },
  summary: { nodeCount: 2, edgeCount: 1, omissionCount: 0 },
  graph: {
    schemaVersion: '1',
    rootNodeIds: ['a'],
    nodes: [
      {
        id: 'a',
        kind: 'file',
        label: 'app.ts',
        path: 'src/app.ts',
        metadata: { status: 'parsed' },
      },
      {
        id: 'b',
        kind: 'file',
        label: 'tool.ts',
        path: 'src/tool.ts',
        metadata: { status: 'parsed' },
      },
    ],
    edges: [
      {
        id: 'edge',
        sourceId: 'a',
        targetId: 'b',
        kind: 'depends-on',
        label: 'depends-on',
        metadata: { typeOnly: false },
      },
    ],
    omissions: [],
  },
};

describe('Cytoscape graph adapter', () => {
  it('converts nodes and edges while preserving metadata', () => {
    const elements = toCytoscapeElements(artifact);

    expect(elements).toHaveLength(3);
    expect(elements[0]?.data).toMatchObject({
      id: 'a',
      path: 'src/app.ts',
      metadata: { status: 'parsed' },
      connectionCount: 1,
      size: 44,
    });
    expect(elements[2]?.data).toMatchObject({
      source: 'a',
      target: 'b',
      metadata: { typeOnly: false },
    });
  });

  it('uses a safe fallback color for an unexpected display kind', () => {
    const element = toNodeElement({
      id: 'future',
      kind: 'file',
      label: 'future',
      metadata: {},
    });
    expect(element.data).toMatchObject({ color: '#315f85' });
  });

  it('scales connected nodes without allowing hubs to dominate the canvas', () => {
    const node = artifact.graph.nodes[0];
    if (!node) throw new Error('Fixture node is required.');
    expect(toNodeElement(node, 0).data).toMatchObject({
      size: 38,
    });
    expect(toNodeElement(node, 1000).data).toMatchObject({
      size: 88,
    });
  });

  it('deterministically separates overlapping graph circles', () => {
    const circles = [
      { id: 'a', x: 0, y: 0, radius: 20 },
      { id: 'b', x: 5, y: 0, radius: 30 },
      { id: 'c', x: 0, y: 0, radius: 15 },
    ];
    const first = resolveCircleCollisions(circles, 10);
    const second = resolveCircleCollisions(circles, 10);

    expect(first).toEqual(second);
    for (let leftIndex = 0; leftIndex < circles.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < circles.length;
        rightIndex += 1
      ) {
        const left = circles[leftIndex];
        const right = circles[rightIndex];
        if (!left || !right) continue;
        const leftPosition = first.get(left.id);
        const rightPosition = first.get(right.id);
        if (!leftPosition || !rightPosition)
          throw new Error('Resolved positions are required.');
        expect(
          Math.hypot(
            rightPosition.x - leftPosition.x,
            rightPosition.y - leftPosition.y,
          ),
        ).toBeGreaterThanOrEqual(left.radius + right.radius + 9.99);
      }
    }
  });

  it('filters nodes and removes edges with hidden endpoints', () => {
    const visible = visibleElementIds(artifact, {
      query: 'app',
      nodeKinds: new Set(['file']),
      relationKinds: new Set(['depends-on']),
    });
    expect([...visible]).toEqual(['a']);
  });

  it('reveals three hierarchy levels and extends or collapses a branch', () => {
    const nodes = ['repo', 'one', 'two', 'three', 'four'].map((id, index) => ({
      id,
      kind: index === 0 ? ('repository' as const) : ('folder' as const),
      label: id,
      metadata: {},
    }));
    const hierarchyArtifact: RepositoryGraphArtifact = {
      ...artifact,
      view: { ...artifact.view, kind: 'repository' },
      summary: { nodeCount: 5, edgeCount: 4, omissionCount: 0 },
      graph: {
        schemaVersion: '1',
        rootNodeIds: ['repo'],
        nodes,
        edges: nodes.slice(1).map((node, index) => ({
          id: `edge-${index}`,
          sourceId: nodes[index]?.id ?? 'repo',
          targetId: node.id,
          kind: 'contains' as const,
          label: 'contains',
          metadata: {},
        })),
        omissions: [],
      },
    };

    expect(
      repositoryExplorationNodeIds(hierarchyArtifact, {
        expandedNodeIds: new Set(),
        collapsedNodeIds: new Set(),
        depth: 3,
      }),
    ).toEqual(new Set(['repo', 'one', 'two', 'three']));
    expect(
      repositoryExplorationNodeIds(hierarchyArtifact, {
        expandedNodeIds: new Set(['three']),
        collapsedNodeIds: new Set(),
        depth: 3,
      }),
    ).toContain('four');
    expect(
      repositoryExplorationNodeIds(hierarchyArtifact, {
        expandedNodeIds: new Set(),
        collapsedNodeIds: new Set(['one']),
        depth: 3,
      }),
    ).toEqual(new Set(['repo', 'one']));
    expect(
      repositoryExplorationNodeIds(hierarchyArtifact, {
        expandedNodeIds: new Set(),
        collapsedNodeIds: new Set(),
        isolatedNodeId: 'three',
        depth: 3,
      }),
    ).toEqual(new Set(['repo', 'one', 'two', 'three', 'four']));
  });
});
