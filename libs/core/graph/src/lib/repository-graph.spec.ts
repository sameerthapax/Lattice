import type {
  FileKnowledgeNode,
  KnowledgeRelation,
  ProjectKnowledgeNode,
  RepositoryKnowledge,
  RepositoryKnowledgeNode,
  SymbolKnowledgeNode,
} from '@lattice/core-knowledge';
import { describe, expect, it } from 'vitest';

import { RepositoryGraphInputError } from './errors';
import { createTargetNeighborhood } from './create-target-neighborhood';
import { createGraphViewProjection } from './create-graph-view';
import {
  createRepositoryGraphArtifact,
  parseRepositoryGraphArtifact,
  RepositoryGraphArtifactError,
  serializeRepositoryGraphArtifact,
} from './artifact';
import {
  createRepositoryGraph,
  getIncomingRelations,
  getNeighbors,
  getNode,
  getOutgoingRelations,
} from './repository-graph';

describe('createRepositoryGraph', () => {
  it('indexes an empty repository knowledge model without mutation', () => {
    const knowledge = model();
    const before = JSON.stringify(knowledge);
    const graph = createRepositoryGraph(knowledge);

    expect([...graph.nodeById.keys()]).toEqual(['repository']);
    expect(graph.relationById.size).toBe(0);
    expect(JSON.stringify(knowledge)).toBe(before);
    expect(graph.knowledge).toBe(knowledge);
  });

  it('looks up nodes and deterministically ordered incoming and outgoing relations', () => {
    const knowledge = model({
      files: [file('a', 'a.ts'), file('b', 'b.ts'), file('c', 'c.ts')],
      relations: [
        relation('z', 'depends-on', 'a', 'c'),
        relation('a', 'depends-on', 'a', 'b'),
        relation('m', 'depends-on', 'c', 'b'),
      ],
    });
    const graph = createRepositoryGraph(knowledge);

    expect(getNode(graph, 'a')?.qualifiedName).toBe('a.ts');
    expect(getNode(graph, 'missing')).toBeUndefined();
    expect(getOutgoingRelations(graph, 'a').map((item) => item.id)).toEqual([
      'a',
      'z',
    ]);
    expect(getIncomingRelations(graph, 'b').map((item) => item.id)).toEqual([
      'a',
      'm',
    ]);
  });

  it('filters relations and neighbors by relation and node kind', () => {
    const symbolNode = symbol('symbol', 'a');
    const knowledge = model({
      files: [file('a', 'a.ts'), file('b', 'b.ts')],
      symbols: [symbolNode],
      relations: [
        relation('dependency', 'depends-on', 'a', 'b'),
        relation('declaration', 'declares', 'a', symbolNode.id),
      ],
    });
    const graph = createRepositoryGraph(knowledge);

    expect(
      getOutgoingRelations(graph, 'a', { relationKinds: ['declares'] }).map(
        (item) => item.id,
      ),
    ).toEqual(['declaration']);
    expect(
      getNeighbors(graph, 'a', {
        direction: 'outgoing',
        nodeKinds: ['symbol'],
      }).map((item) => item.node.id),
    ).toEqual(['symbol']);
  });

  it('indexes a valid self-relation', () => {
    const graph = createRepositoryGraph(
      model({
        files: [file('a', 'a.ts')],
        relations: [relation('self', 'depends-on', 'a', 'a')],
      }),
    );

    expect(getNeighbors(graph, 'a')).toHaveLength(2);
  });

  it.each([
    {
      code: 'DUPLICATE_NODE_ID',
      knowledge: model({ files: [file('repository', 'a.ts')] }),
    },
    {
      code: 'DUPLICATE_RELATION_ID',
      knowledge: model({
        files: [file('a', 'a.ts')],
        relations: [
          relation('same', 'depends-on', 'a', 'a'),
          relation('same', 'depends-on', 'a', 'a'),
        ],
      }),
    },
    {
      code: 'MISSING_RELATION_ENDPOINT',
      knowledge: model({
        relations: [relation('missing', 'contains', 'repository', 'absent')],
      }),
    },
    {
      code: 'INCONSISTENT_ENDPOINT_KINDS',
      knowledge: model({
        files: [file('a', 'a.ts')],
        relations: [relation('bad', 'declares', 'repository', 'a')],
      }),
    },
  ])('rejects invalid knowledge with $code', ({ code, knowledge }) => {
    expectGraphError(() => createRepositoryGraph(knowledge), code);
  });

  it('rejects unknown runtime node and relation kinds', () => {
    const invalidNode = {
      ...file('a', 'a.ts'),
      kind: 'future-node',
    } as unknown as FileKnowledgeNode;
    expectGraphError(
      () => createRepositoryGraph(model({ files: [invalidNode] })),
      'INVALID_NODE_KIND',
    );

    const invalidRelation = {
      ...relation('future', 'depends-on', 'repository', 'repository'),
      kind: 'future-relation',
    } as unknown as KnowledgeRelation;
    expectGraphError(
      () => createRepositoryGraph(model({ relations: [invalidRelation] })),
      'INVALID_RELATION_KIND',
    );
  });
});

describe('createTargetNeighborhood', () => {
  const cyclicKnowledge = model({
    files: [file('a', 'a.ts'), file('b', 'b.ts'), file('c', 'c.ts')],
    relations: [
      relation('ab', 'depends-on', 'a', 'b'),
      relation('bc', 'depends-on', 'b', 'c'),
      relation('ca', 'depends-on', 'c', 'a'),
    ],
  });

  it('is cycle-safe and respects bounded depth', () => {
    const graph = createRepositoryGraph(cyclicKnowledge);

    expect(
      createTargetNeighborhood(graph, 'a', {
        direction: 'outgoing',
        maxDepth: 1,
      }).nodes.map((node) => node.id),
    ).toEqual(['a', 'b']);
    expect(
      createTargetNeighborhood(graph, 'a', {
        direction: 'outgoing',
        maxDepth: 2,
      }).nodes.map((node) => node.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('reports node and relation omissions at deterministic limits', () => {
    const projection = createTargetNeighborhood(
      createRepositoryGraph({
        ...cyclicKnowledge,
        relations: [
          ...cyclicKnowledge.relations,
          relation('ab-second', 'depends-on', 'a', 'b'),
        ],
      }),
      'a',
      { maxDepth: 2, maxNodes: 2, maxRelations: 1 },
    );

    expect(projection.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(projection.edges).toHaveLength(1);
    expect(projection.omissions).toEqual([
      { reason: 'NODE_LIMIT', entityKind: 'node', count: 1 },
      { reason: 'RELATION_LIMIT', entityKind: 'relation', count: 1 },
    ]);
  });

  it('produces stable presentation-safe output independently of input order', () => {
    const first = createTargetNeighborhood(
      createRepositoryGraph(cyclicKnowledge),
      'a',
      { maxDepth: 2 },
    );
    const second = createTargetNeighborhood(
      createRepositoryGraph({
        ...cyclicKnowledge,
        files: [...cyclicKnowledge.files].reverse(),
        relations: [...cyclicKnowledge.relations].reverse(),
      }),
      'a',
      { maxDepth: 2 },
    );

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('1');
    expect(first.nodes[0]).not.toHaveProperty('contentHash');
    expect(first).not.toHaveProperty('knowledge');
  });

  it('filters a projection by relation and node kinds', () => {
    const project = projectNode('project');
    const knowledge = model({
      projects: [project],
      files: [file('a', 'a.ts')],
      relations: [
        relation('contains-project', 'contains', 'repository', project.id),
        relation('contains-file', 'contains', 'repository', 'a'),
      ],
    });
    const projection = createTargetNeighborhood(
      createRepositoryGraph(knowledge),
      'repository',
      { relationKinds: ['contains'], nodeKinds: ['project'] },
    );

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'repository',
      'project',
    ]);
    expect(projection.edges.map((edge) => edge.id)).toEqual([
      'contains-project',
    ]);
  });

  it('rejects unknown targets and invalid limits', () => {
    const graph = createRepositoryGraph(model());
    expectGraphError(
      () => createTargetNeighborhood(graph, 'missing'),
      'TARGET_NODE_NOT_FOUND',
    );
    expectGraphError(
      () => createTargetNeighborhood(graph, 'repository', { maxNodes: 0 }),
      'INVALID_PROJECTION_OPTIONS',
    );
  });
});

describe('graph views and artifacts', () => {
  it('creates deterministic file dependency and full views', () => {
    const knowledge = model({
      files: [file('b', 'b.ts'), file('a', 'a.ts')],
      relations: [relation('dependency', 'depends-on', 'a', 'b')],
    });
    const graph = createRepositoryGraph(knowledge);

    expect(
      createGraphViewProjection(graph, { kind: 'file-dependencies' }),
    ).toMatchObject({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ id: 'dependency' }],
    });
    expect(
      createGraphViewProjection(graph, { kind: 'full' }).nodes,
    ).toHaveLength(3);
  });

  it('creates a valid artifact without exposing the repository root path', () => {
    const artifact = createRepositoryGraphArtifact(
      createRepositoryGraph(model()),
    );
    const serialized = serializeRepositoryGraphArtifact(artifact, true);

    expect(artifact.repository).toEqual({ id: 'repository', name: 'repo' });
    expect(artifact.graph.nodes[0]).not.toHaveProperty('subtitle');
    expect(serialized).not.toContain('/repo');
    expect(parseRepositoryGraphArtifact(JSON.parse(serialized))).toEqual(
      artifact,
    );
  });

  it('reports deterministic view omissions', () => {
    const artifact = createRepositoryGraphArtifact(
      createRepositoryGraph(
        model({ files: [file('a', 'a.ts'), file('b', 'b.ts')] }),
      ),
      { kind: 'file-dependencies', maxNodes: 1 },
    );

    expect(artifact.summary).toMatchObject({ nodeCount: 1, omissionCount: 1 });
    expect(artifact.graph.omissions).toEqual([
      { reason: 'NODE_LIMIT', entityKind: 'node', count: 1 },
    ]);
  });

  it('rejects unsupported schemas and count mismatches', () => {
    expect(() =>
      parseRepositoryGraphArtifact({ schemaVersion: '2' }),
    ).toThrowError(RepositoryGraphArtifactError);
    const artifact = createRepositoryGraphArtifact(
      createRepositoryGraph(model()),
    );
    expect(() =>
      parseRepositoryGraphArtifact({
        ...artifact,
        summary: { ...artifact.summary, nodeCount: 99 },
      }),
    ).toThrowError(/count mismatch/i);
  });
});

function model(
  overrides: Partial<RepositoryKnowledge> = {},
): RepositoryKnowledge {
  return {
    repository: repositoryNode(),
    projects: [],
    folders: [],
    files: [],
    symbols: [],
    relations: [],
    projectDependencies: [],
    summaries: {
      projectCount: 0,
      folderCount: 0,
      fileCount: 0,
      parsedFileCount: 0,
      symbolCount: 0,
      publicFileSymbolCount: 0,
      publicProjectSymbolCount: 0,
      internalFileDependencyCount: 0,
      crossProjectDependencyCount: 0,
      orphanFileCount: 0,
      rootFileCount: 0,
    },
    ...overrides,
  };
}

function repositoryNode(): RepositoryKnowledgeNode {
  return {
    id: 'repository',
    kind: 'repository',
    name: 'repo',
    qualifiedName: '/repo',
    rootPath: '/repo',
    projectIds: [],
    topLevelFolderIds: [],
    fileIds: [],
  };
}

function projectNode(id: string): ProjectKnowledgeNode {
  return {
    id,
    kind: 'project',
    name: id,
    qualifiedName: id,
    projectKind: 'library',
    rootRelativePath: `libs/${id}`,
    sourceRootRelativePath: null,
    folderIds: [],
    fileIds: [],
    symbolIds: [],
    incomingProjectDependencyIds: [],
    outgoingProjectDependencyIds: [],
    publicSymbolIds: [],
  };
}

function file(id: string, relativePath: string): FileKnowledgeNode {
  return {
    id,
    kind: 'file',
    name: relativePath,
    qualifiedName: relativePath,
    fileId: id,
    relativePath,
    folderId: null,
    projectId: null,
    language: 'TypeScript',
    contentHash: `hash-${id}`,
    status: 'parsed',
    symbolIds: [],
    publicSymbolIds: [],
    importCount: 0,
    exportCount: 0,
    internalDependencyCount: 0,
    externalDependencyCount: 0,
    incomingFileDependencyIds: [],
    outgoingFileDependencyIds: [],
    diagnosticCount: 0,
    hasSyntaxErrors: false,
    orphan: false,
  };
}

function symbol(id: string, fileNodeId: string): SymbolKnowledgeNode {
  return {
    id,
    kind: 'symbol',
    name: id,
    qualifiedName: `${fileNodeId}.ts#${id}`,
    symbolId: id,
    symbolKind: 'function',
    fileId: fileNodeId,
    fileNodeId,
    folderId: null,
    projectId: null,
    exported: false,
    defaultExport: false,
    typeOnly: false,
    async: false,
    parentSymbolId: null,
    childSymbolIds: [],
    incomingBindingIds: [],
    location: {
      startLine: 1,
      startColumn: 0,
      endLine: 1,
      endColumn: 1,
    },
  };
}

function relation(
  id: string,
  kind: KnowledgeRelation['kind'],
  sourceNodeId: string,
  targetNodeId: string,
): KnowledgeRelation {
  return {
    id,
    kind,
    sourceNodeId,
    targetNodeId,
    sourceEntityId: null,
    metadata: null,
  };
}

function expectGraphError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected graph operation to fail.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RepositoryGraphInputError);
    expect((error as RepositoryGraphInputError).code).toBe(code);
  }
}
