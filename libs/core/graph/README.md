# Core graph

`@lattice/core-graph` provides pure, deterministic indexes, queries, and bounded
visualization projections over `RepositoryKnowledge`. The knowledge model remains
the canonical source of repository facts; this library neither reparses source nor
creates a parallel graph model.

## Public API

```ts
const graph = createRepositoryGraph(knowledge);
const node = getNode(graph, nodeId);
const outgoing = getOutgoingRelations(graph, nodeId, {
  relationKinds: ['depends-on'],
});
const incoming = getIncomingRelations(graph, nodeId);
const neighbors = getNeighbors(graph, nodeId, {
  direction: 'both',
  nodeKinds: ['file'],
});
const projection = createTargetNeighborhood(graph, nodeId, {
  maxDepth: 2,
  maxNodes: 50,
  maxRelations: 100,
});
```

Graph construction reuses every knowledge node and relation object and ID. It
validates runtime node and relation kinds, duplicate node and relation IDs, missing
endpoints, and relation endpoint-kind compatibility. Invalid input throws
`RepositoryGraphInputError` with a stable code. Self-relations are accepted when
their kinds are structurally valid. Indexes do not mutate the knowledge model.

Incoming and outgoing indexes sort relations by source ID, relation kind, target ID,
then relation ID. Neighbors sort by node kind, qualified name, node ID, relation,
and direction. Target-neighborhood traversal is breadth-first and cycle-safe; nodes
sort by depth and the same node comparator.

## Projection schema

`createTargetNeighborhood` emits transport-neutral schema version `"1"`. It contains
one root ID, presentation-safe nodes, typed edges, and aggregated node/relation-limit
omissions. Defaults are depth 1, 50 nodes, and 100 relations. Safety ceilings are
depth 10, 5,000 nodes, and 20,000 relations. Projections omit absolute repository paths,
source, hashes, timestamps, layout coordinates, colors, and renderer-specific data.

The DTO can support repository hierarchy, project and file dependency views, public
exports, declarations and bindings, explicit symbol nesting, and target-centered
neighborhoods. Consumers choose relation/node filters; the graph library does not
reinterpret dependency edges as runtime flow.

`createGraphViewProjection` provides deterministic `repository`,
`project-dependencies`, `file-dependencies`, `public-api`, and `full` presets.
`createRepositoryGraphArtifact` wraps a projection in independently versioned schema
`"1"`; `parseRepositoryGraphArtifact` validates untrusted artifacts and
`serializeRepositoryGraphArtifact` emits compact or pretty deterministic JSON.

## Boundaries and planned consumers

The library performs no I/O, parsing, module resolution, persistence, inference,
ranking, UI layout, or rendering. Context-specific ranking stays in
`@lattice/context-builder`; it may reuse graph traversal in a later focused refactor.
Wiki, search, web, API, CLI, and MCP integrations are downstream consumers and are
not implemented here.

Static import and binding evidence cannot establish calls, control flow, data flow,
event delivery, or runtime order. Those views require future call-graph, CFG/data-flow,
runtime trace, framework-route, or producer/consumer evidence.
