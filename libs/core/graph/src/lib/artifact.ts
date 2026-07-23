import { z } from 'zod';

import { createGraphViewProjection } from './create-graph-view';
import type {
  CreateGraphViewOptions,
  RepositoryGraph,
  RepositoryGraphArtifact,
} from './models';

export type RepositoryGraphArtifactErrorCode =
  'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_ARTIFACT';

export class RepositoryGraphArtifactError extends Error {
  public constructor(
    public readonly code: RepositoryGraphArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryGraphArtifactError';
  }
}

const valueSchema = z.union([z.string(), z.number(), z.boolean()]);
const nodeKindSchema = z.enum([
  'repository',
  'project',
  'folder',
  'file',
  'symbol',
]);
const relationKindSchema = z.enum([
  'contains',
  'belongs-to-project',
  'declares',
  'exports',
  'depends-on',
  'binds-to',
  'parent-symbol',
  'project-depends-on',
]);
const viewKindSchema = z.enum([
  'repository',
  'project-dependencies',
  'file-dependencies',
  'public-api',
  'full',
]);
const projectionSchema = z
  .object({
    schemaVersion: z.literal('1'),
    rootNodeIds: z.array(z.string()),
    nodes: z.array(
      z.object({
        id: z.string(),
        kind: nodeKindSchema,
        label: z.string(),
        subtitle: z.string().optional(),
        path: z.string().optional(),
        projectId: z.string().optional(),
        metadata: z.record(z.string(), valueSchema),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        sourceId: z.string(),
        targetId: z.string(),
        kind: relationKindSchema,
        label: z.string(),
        metadata: z.record(z.string(), valueSchema),
      }),
    ),
    omissions: z.array(
      z.object({
        reason: z.enum(['NODE_LIMIT', 'RELATION_LIMIT']),
        entityKind: z.enum(['node', 'relation']),
        count: z.number().int().positive(),
      }),
    ),
  })
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id))
        context.addIssue({
          code: 'custom',
          message: `Duplicate graph node ID: ${node.id}`,
        });
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id))
        context.addIssue({
          code: 'custom',
          message: `Duplicate graph edge ID: ${edge.id}`,
        });
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId))
        context.addIssue({
          code: 'custom',
          message: `Graph edge references a missing node: ${edge.id}`,
        });
    }
    for (const root of graph.rootNodeIds)
      if (!nodeIds.has(root))
        context.addIssue({
          code: 'custom',
          message: `Graph root references a missing node: ${root}`,
        });
  });

const artifactSchema = z
  .object({
    artifactKind: z.literal('repository-graph'),
    schemaVersion: z.literal('1'),
    repository: z.object({ id: z.string(), name: z.string() }),
    view: z.object({
      kind: viewKindSchema,
      targetNodeId: z.string().nullable(),
      maxDepth: z.number().int().min(0).max(10).nullable(),
      maxNodes: z.number().int().positive().max(5000),
      maxRelations: z.number().int().positive().max(20000),
    }),
    summary: z.object({
      nodeCount: z.number().int().nonnegative(),
      edgeCount: z.number().int().nonnegative(),
      omissionCount: z.number().int().nonnegative(),
    }),
    graph: projectionSchema,
  })
  .superRefine((artifact, context) => {
    const omitted = artifact.graph.omissions.reduce(
      (sum, omission) => sum + omission.count,
      0,
    );
    if (artifact.summary.nodeCount !== artifact.graph.nodes.length)
      context.addIssue({
        code: 'custom',
        message: 'Graph node count mismatch.',
      });
    if (artifact.summary.edgeCount !== artifact.graph.edges.length)
      context.addIssue({
        code: 'custom',
        message: 'Graph edge count mismatch.',
      });
    if (artifact.summary.omissionCount !== omitted)
      context.addIssue({
        code: 'custom',
        message: 'Graph omission count mismatch.',
      });
  });

export function createRepositoryGraphArtifact(
  graph: RepositoryGraph,
  options: CreateGraphViewOptions = {},
): RepositoryGraphArtifact {
  const normalized = {
    kind: options.kind ?? 'repository',
    targetNodeId: options.targetNodeId ?? null,
    maxDepth: options.maxDepth ?? null,
    maxNodes: options.maxNodes ?? 5000,
    maxRelations: options.maxRelations ?? 20000,
  };
  const projection = createGraphViewProjection(graph, options);
  return parseRepositoryGraphArtifact({
    artifactKind: 'repository-graph',
    schemaVersion: '1',
    repository: {
      id: graph.knowledge.repository.id,
      name: graph.knowledge.repository.name,
    },
    view: normalized,
    summary: {
      nodeCount: projection.nodes.length,
      edgeCount: projection.edges.length,
      omissionCount: projection.omissions.reduce(
        (sum, omission) => sum + omission.count,
        0,
      ),
    },
    graph: projection,
  });
}

export function parseRepositoryGraphArtifact(
  value: unknown,
): RepositoryGraphArtifact {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== '1'
  )
    throw new RepositoryGraphArtifactError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported repository graph artifact schema: ${String(value.schemaVersion)}`,
    );
  const result = artifactSchema.safeParse(value);
  if (!result.success)
    throw new RepositoryGraphArtifactError(
      'INVALID_ARTIFACT',
      `Invalid repository graph artifact: ${result.error.issues[0]?.message ?? 'validation failed'}`,
    );
  return result.data;
}

export function serializeRepositoryGraphArtifact(
  artifact: RepositoryGraphArtifact,
  pretty = false,
): string {
  const validated = parseRepositoryGraphArtifact(artifact);
  return `${JSON.stringify(validated, null, pretty ? 2 : undefined)}\n`;
}
