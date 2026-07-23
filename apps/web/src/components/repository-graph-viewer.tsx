'use client';

import {
  ArrowsOut,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Graph,
  GitBranch,
  MagnifyingGlass,
  SlidersHorizontal,
  X,
} from '@phosphor-icons/react';
import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  RepositoryGraphArtifact,
} from '@lattice/core-graph';
import type { Core, ElementDefinition, EventObject } from 'cytoscape';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { RepositoryLoader } from './repository-loader';
import {
  graphStyles,
  hasHiddenHierarchyChildren,
  NODE_COLORS,
  repositoryExplorationNodeIds,
  resolveCircleCollisions,
  toCytoscapeElements,
  visibleElementIds,
} from '../lib/cytoscape-elements';

type LayoutName = 'breadthfirst' | 'cose' | 'concentric' | 'grid';
type Selection =
  | { readonly kind: 'node'; readonly value: GraphProjectionNode }
  | { readonly kind: 'edge'; readonly value: GraphProjectionEdge }
  | null;

export interface RepositoryGraphViewerProps {
  readonly artifact: RepositoryGraphArtifact;
  readonly onReload: () => Promise<void>;
}

export function RepositoryGraphViewer({
  artifact,
  onReload,
}: RepositoryGraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [query, setQuery] = useState('');
  const nodeKinds = useMemo(
    () => [...new Set(artifact.graph.nodes.map((node) => node.kind))].sort(),
    [artifact],
  );
  const relationKinds = useMemo(
    () => [...new Set(artifact.graph.edges.map((edge) => edge.kind))].sort(),
    [artifact],
  );
  const [enabledNodeKinds, setEnabledNodeKinds] = useState<Set<string>>(
    () => new Set(nodeKinds),
  );
  const [enabledRelationKinds, setEnabledRelationKinds] = useState<Set<string>>(
    () => new Set(relationKinds),
  );
  const [nodeColors, setNodeColors] = useState<Record<string, string>>(() => ({
    ...NODE_COLORS,
  }));
  const [layout, setLayout] = useState<LayoutName>('cose');
  const [edgeDistanceScale, setEdgeDistanceScale] = useState(100);
  const [circleScale, setCircleScale] = useState(100);
  const [selection, setSelection] = useState<Selection>(null);
  const [initializationError, setInitializationError] = useState<string>();
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [warningVisible, setWarningVisible] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | undefined>(
    'Arranging repository map',
  );
  const [layoutNotice, setLayoutNotice] = useState<string>();
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isolatedNodeId, setIsolatedNodeId] = useState<string>();
  const explorationNodeIds = useMemo(
    () =>
      repositoryExplorationNodeIds(artifact, {
        expandedNodeIds,
        collapsedNodeIds,
        isolatedNodeId,
        depth: 3,
      }),
    [artifact, collapsedNodeIds, expandedNodeIds, isolatedNodeId],
  );
  const isolatedNode = isolatedNodeId
    ? artifact.graph.nodes.find((node) => node.id === isolatedNodeId)
    : undefined;
  const explorationRef = useRef({
    expandedNodeIds,
    collapsedNodeIds,
    isolatedNodeId,
  });
  explorationRef.current = {
    expandedNodeIds,
    collapsedNodeIds,
    isolatedNodeId,
  };

  useEffect(() => {
    let disposed = false;
    let instance: Core | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let animationFrame: number | undefined;
    const initialize = async (): Promise<void> => {
      try {
        const { default: cytoscape } = await import('cytoscape');
        const mountWhenMeasured = (): void => {
          const container = containerRef.current;
          if (disposed || !container) return;
          const bounds = container.getBoundingClientRect();
          if (bounds.width === 0 || bounds.height === 0) {
            animationFrame = window.requestAnimationFrame(mountWhenMeasured);
            return;
          }
          instance = cytoscape({
            container,
            elements: toCytoscapeElements(artifact) as ElementDefinition[],
            style: graphStyles(),
            layout: { name: 'preset' },
            minZoom: 0.08,
            maxZoom: 3,
          });
          cyRef.current = instance;
          applyVisualTuning(instance, circleScale);
          applyFilters(
            instance,
            artifact,
            {
              query: '',
              nodeKinds: new Set(nodeKinds),
              relationKinds: new Set(relationKinds),
            },
            repositoryExplorationNodeIds(artifact, {
              expandedNodeIds: new Set(),
              collapsedNodeIds: new Set(),
              depth: 3,
            }),
          );
          instance.on('tap', 'node', (event: EventObject) => {
            const nodeId = event.target.id();
            const node = artifact.graph.nodes.find(
              (candidate) => candidate.id === nodeId,
            );
            if (node) {
              setSelection({ kind: 'node', value: node });
              const cy = instance;
              if (!cy) return;
              const targetZoom = Math.max(cy.zoom(), 1.15);
              cy.stop();
              cy.zoom(targetZoom);
              cy.center(event.target);
            }
          });
          instance.on('tap', 'edge', (event: EventObject) => {
            const edge = artifact.graph.edges.find(
              (candidate) => candidate.id === event.target.id(),
            );
            if (edge) setSelection({ kind: 'edge', value: edge });
          });
          instance.on('tap', (event: EventObject) => {
            if (event.target === instance) setSelection(null);
          });
          const initialElements = instance.elements().not('.filtered');
          const initialLayoutName = safeLayoutName(
            layout,
            initialElements.nodes().length,
          );
          if (initialLayoutName !== layout) {
            setLayout(initialLayoutName);
            setLayoutNotice(
              'Grid was selected because force-directed layout is limited to 300 visible nodes.',
            );
          }
          const initialLayout = initialElements.layout(
            layoutOptions(initialLayoutName, edgeDistanceScale),
          );
          initialLayout.one('layoutstop', () => {
            if (!disposed) {
              if (instance) fitVisibleGraph(instance, initialElements);
              setBusyLabel(undefined);
            }
          });
          initialLayout.run();
          resizeObserver = new ResizeObserver(() => {
            instance?.resize();
          });
          resizeObserver.observe(container);
        };
        animationFrame = window.requestAnimationFrame(mountWhenMeasured);
      } catch (error: unknown) {
        if (!disposed) {
          setBusyLabel(undefined);
          setInitializationError(
            error instanceof Error
              ? error.message
              : 'Cytoscape could not be initialized.',
          );
        }
      }
    };
    void initialize();
    return () => {
      disposed = true;
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      instance?.destroy();
      cyRef.current = null;
    };
  }, [artifact]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyFilters(
      cy,
      artifact,
      {
        query,
        nodeKinds: enabledNodeKinds,
        relationKinds: enabledRelationKinds,
      },
      explorationNodeIds,
    );
  }, [
    artifact,
    enabledNodeKinds,
    enabledRelationKinds,
    explorationNodeIds,
    query,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const kind = String(node.data('kind'));
        node.data('color', nodeColors[kind] ?? '#71717a');
      });
    });
  }, [nodeColors]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyVisualTuning(cy, circleScale);
    const visibleElements = cy.elements().not('.filtered');
    separateVisibleNodes(cy, visibleElements);
  }, [circleScale]);

  useEffect(() => {
    if (!cyRef.current) return;
    runLayout(
      layout,
      isolatedNodeId ? 'Building isolated view' : 'Updating repository map',
    );
  }, [explorationNodeIds]);

  const runLayout = (
    next: LayoutName,
    label = 'Arranging repository map',
    fitAfterLayout = true,
  ) => {
    setLayout(next);
    setLayoutNotice(undefined);
    const cy = cyRef.current;
    if (!cy) return;
    setBusyLabel(label);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const visibleElements = cy.elements().not('.filtered');
          const safeLayout = safeLayoutName(
            next,
            visibleElements.nodes().length,
          );
          if (safeLayout !== next) {
            setLayout(safeLayout);
            setLayoutNotice(
              'Grid was selected because force-directed layout is limited to 300 visible nodes.',
            );
          }
          const nextLayout = visibleElements.layout(
            layoutOptions(safeLayout, edgeDistanceScale),
          );
          nextLayout.one('layoutstop', () => {
            if (fitAfterLayout) fitVisibleGraph(cy, visibleElements);
            else {
              separateVisibleNodes(cy, visibleElements);
              cy.center(visibleElements);
            }
            setBusyLabel(undefined);
          });
          nextLayout.run();
        }, 40);
      });
    });
  };
  const toggleNodeBranch = (nodeId: string): void => {
    if (artifact.view.kind !== 'repository') return;
    const current = explorationRef.current;
    if (current.isolatedNodeId) return;
    const visible = repositoryExplorationNodeIds(artifact, {
      ...current,
      depth: 3,
    });
    const hasVisibleChildren = artifact.graph.edges.some(
      (edge) => edge.sourceId === nodeId && visible.has(edge.targetId),
    );
    const hasHiddenChildren = hasHiddenHierarchyChildren(
      artifact,
      nodeId,
      visible,
    );
    if (hasVisibleChildren) {
      setExpandedNodeIds(without(current.expandedNodeIds, nodeId));
      setCollapsedNodeIds(withValue(current.collapsedNodeIds, nodeId));
    } else if (hasHiddenChildren) {
      setCollapsedNodeIds(without(current.collapsedNodeIds, nodeId));
      setExpandedNodeIds(withValue(current.expandedNodeIds, nodeId));
    }
  };
  const reset = () => {
    setQuery('');
    setEnabledNodeKinds(new Set(nodeKinds));
    setEnabledRelationKinds(new Set(relationKinds));
    setSelection(null);
    setExpandedNodeIds(new Set());
    setCollapsedNodeIds(new Set());
    setIsolatedNodeId(undefined);
  };
  const large =
    artifact.summary.nodeCount > 300 || artifact.summary.edgeCount > 800;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background lg:h-[100dvh] lg:overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Graph size={19} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {artifact.repository.name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {artifact.view.kind}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{artifact.summary.nodeCount} nodes</Badge>
            <Badge>{artifact.summary.edgeCount} edges</Badge>
            <Badge>{artifact.summary.omissionCount} omitted</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBusyLabel('Refreshing graph artifact');
                void onReload().finally(() => setBusyLabel(undefined));
              }}
            >
              <ArrowClockwise size={15} /> Reload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cyRef.current?.fit(undefined, 36)}
            >
              <ArrowsOut size={15} /> Fit
            </Button>
          </div>
        </div>
      </header>

      {large && warningVisible ? (
        <Alert className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-4 rounded-lg md:mx-6">
          <span>
            This artifact is bounded. Expand branches deliberately or isolate a
            node to keep the map readable.
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss graph size warning"
            onClick={() => setWarningVisible(false)}
          >
            <X size={15} />
          </Button>
        </Alert>
      ) : null}

      <div
        className={`grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ${panelGridClass(leftPanelOpen, rightPanelOpen)}`}
      >
        <aside className="relative overflow-hidden border-b border-border lg:border-r lg:border-b-0">
          <Button
            className="absolute top-3 right-2 hidden lg:inline-flex"
            variant="ghost"
            size="icon"
            aria-label={leftPanelOpen ? 'Collapse filters' : 'Expand filters'}
            onClick={() => setLeftPanelOpen((open) => !open)}
          >
            {leftPanelOpen ? <CaretLeft size={15} /> : <CaretRight size={15} />}
          </Button>
          <div
            className={leftPanelOpen ? 'h-full overflow-y-auto p-4' : 'hidden'}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <SlidersHorizontal size={15} /> Filters
            </div>
            <label
              className="mt-4 block text-xs font-medium"
              htmlFor="graph-search"
            >
              Search nodes
            </label>
            <div className="relative mt-2">
              <MagnifyingGlass
                className="absolute top-2.5 left-3 text-muted-foreground"
                size={15}
              />
              <Input
                id="graph-search"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, path, or ID"
              />
            </div>
            <FilterGroup
              title="Node kinds"
              values={nodeKinds}
              enabled={enabledNodeKinds}
              colors={nodeColors}
              onColorChange={(kind, color) =>
                setNodeColors((current) => ({ ...current, [kind]: color }))
              }
              onToggle={(value) =>
                setEnabledNodeKinds(toggle(enabledNodeKinds, value))
              }
            />
            <FilterGroup
              title="Relations"
              values={relationKinds}
              enabled={enabledRelationKinds}
              onToggle={(value) =>
                setEnabledRelationKinds(toggle(enabledRelationKinds, value))
              }
            />
            <Separator className="my-4" />
            <label className="block text-xs font-medium" htmlFor="graph-layout">
              Layout
            </label>
            <select
              id="graph-layout"
              className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={layout}
              onChange={(event) => runLayout(event.target.value as LayoutName)}
            >
              <option value="breadthfirst">Breadth first</option>
              <option value="cose">Force directed</option>
              <option value="concentric">Concentric</option>
              <option value="grid">Grid</option>
            </select>
            <div className="mt-5 space-y-4">
              <GraphSlider
                label="Edge distance"
                value={edgeDistanceScale}
                max={400}
                onChange={setEdgeDistanceScale}
                onCommit={() =>
                  runLayout(layout, 'Updating edge distance', false)
                }
              />
              <GraphSlider
                label="Circle size"
                value={circleScale}
                max={400}
                onChange={setCircleScale}
              />
            </div>
            <Button
              className="mt-4 w-full"
              variant="ghost"
              size="sm"
              onClick={reset}
            >
              Reset filters
            </Button>
          </div>
        </aside>

        <section className="relative min-h-[52dvh] overflow-hidden bg-canvas lg:h-full lg:min-h-0">
          {initializationError ? (
            <Alert className="absolute top-4 right-4 left-4 z-10">
              Graph renderer failed to initialize: {initializationError}
            </Alert>
          ) : null}
          {artifact.graph.nodes.length === 0 ? (
            <div className="absolute inset-0 grid place-content-center p-8 text-center">
              <Graph className="mx-auto text-muted-foreground" size={32} />
              <p className="mt-3 font-medium">This projection has no nodes.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate another view or increase the graph limits.
              </p>
            </div>
          ) : null}
          <div
            ref={containerRef}
            className="absolute inset-0 h-full w-full"
            aria-label="Repository graph canvas"
          />
          {isolatedNode ? (
            <div className="absolute top-4 left-4 flex items-center gap-3 rounded-lg border border-border bg-background/92 px-3 py-2 shadow-sm backdrop-blur">
              <div className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
                <GitBranch size={14} weight="bold" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Isolated subtree
                </p>
                <p className="max-w-56 truncate text-xs font-semibold">
                  {isolatedNode.label}
                  <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                    {isolatedNode.kind}
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-7 px-2"
                onClick={() => setIsolatedNodeId(undefined)}
              >
                Return to overview
              </Button>
            </div>
          ) : null}
          {layoutNotice ? (
            <div className="absolute right-4 bottom-4 max-w-sm rounded-lg border border-border bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
              {layoutNotice}
            </div>
          ) : null}
          {busyLabel ? <RepositoryLoader label={busyLabel} fullscreen /> : null}
        </section>

        <aside className="relative overflow-hidden border-t border-border lg:border-t-0 lg:border-l">
          <Button
            className="absolute top-3 left-2 hidden lg:inline-flex"
            variant="ghost"
            size="icon"
            aria-label={
              rightPanelOpen ? 'Collapse inspector' : 'Expand inspector'
            }
            onClick={() => setRightPanelOpen((open) => !open)}
          >
            {rightPanelOpen ? (
              <CaretRight size={15} />
            ) : (
              <CaretLeft size={15} />
            )}
          </Button>
          <div className={rightPanelOpen ? 'h-full' : 'hidden'}>
            <DetailPanel
              artifact={artifact}
              selection={selection}
              isolatedNodeId={isolatedNodeId}
              onIsolate={setIsolatedNodeId}
              onToggleBranch={toggleNodeBranch}
              explorationNodeIds={explorationNodeIds}
              nodeColors={nodeColors}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function applyFilters(
  cy: Core,
  artifact: RepositoryGraphArtifact,
  filters: Parameters<typeof visibleElementIds>[1],
  explorationNodeIds: ReadonlySet<string>,
): void {
  const filtered = visibleElementIds(artifact, filters);
  const visible = new Set(
    [...filtered].filter((id) => {
      const edge = artifact.graph.edges.find(
        (candidate) => candidate.id === id,
      );
      return edge
        ? explorationNodeIds.has(edge.sourceId) &&
            explorationNodeIds.has(edge.targetId)
        : explorationNodeIds.has(id);
    }),
  );
  cy.batch(() => {
    cy.elements().forEach((element) => {
      element.toggleClass('filtered', !visible.has(element.id()));
    });
  });
}

function FilterGroup({
  title,
  values,
  enabled,
  onToggle,
  colors,
  onColorChange,
}: {
  readonly title: string;
  readonly values: readonly string[];
  readonly enabled: ReadonlySet<string>;
  readonly onToggle: (value: string) => void;
  readonly colors?: Readonly<Record<string, string>>;
  readonly onColorChange?: (value: string, color: string) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="text-xs font-medium">{title}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value) => {
          const color = colors?.[value] ?? '#71717a';
          return (
            <div
              key={value}
              className={`flex items-center overflow-hidden rounded-md border ${
                enabled.has(value)
                  ? 'border-transparent bg-primary'
                  : 'border-border bg-background'
              }`}
            >
              {onColorChange ? (
                <label
                  className="relative ml-1.5 size-4 shrink-0 cursor-pointer rounded-full border-2 border-white/70"
                  style={{ backgroundColor: color }}
                  title={`Change ${value} color`}
                >
                  <span className="sr-only">Change {value} color</span>
                  <input
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                    type="color"
                    value={color}
                    aria-label={`Change ${value} color`}
                    onChange={(event) =>
                      onColorChange(value, event.target.value)
                    }
                  />
                </label>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant={enabled.has(value) ? 'default' : 'outline'}
                aria-pressed={enabled.has(value)}
                onClick={() => onToggle(value)}
                className="h-7 border-0 px-2 font-mono text-[10px]"
              >
                {value}
              </Button>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function GraphSlider({
  label,
  value,
  min = 50,
  max,
  onChange,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly onCommit?: () => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium">
        {label}
        <span className="font-mono text-[10px] text-muted-foreground">
          {value}%
        </span>
      </span>
      <input
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        type="range"
        min="0"
        max="100"
        step="1"
        value={scaleToSliderPosition(value, min, max)}
        aria-label={label}
        onChange={(event) =>
          onChange(sliderPositionToScale(Number(event.target.value), min, max))
        }
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{min}</span>
        <span>100</span>
        <span>{max}</span>
      </span>
    </label>
  );
}

function scaleToSliderPosition(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return value <= 100
    ? ((value - minimum) / (100 - minimum)) * 50
    : 50 + ((value - 100) / (maximum - 100)) * 50;
}

function sliderPositionToScale(
  position: number,
  minimum: number,
  maximum: number,
): number {
  const value =
    position <= 50
      ? minimum + (position / 50) * (100 - minimum)
      : 100 + ((position - 50) / 50) * (maximum - 100);
  return Math.round(value / 5) * 5;
}

function DetailPanel({
  artifact,
  selection,
  isolatedNodeId,
  onIsolate,
  onToggleBranch,
  explorationNodeIds,
  nodeColors,
}: {
  readonly artifact: RepositoryGraphArtifact;
  readonly selection: Selection;
  readonly isolatedNodeId?: string;
  readonly onIsolate: (nodeId: string | undefined) => void;
  readonly onToggleBranch: (nodeId: string) => void;
  readonly explorationNodeIds: ReadonlySet<string>;
  readonly nodeColors: Readonly<Record<string, string>>;
}) {
  if (!selection)
    return (
      <div className="h-full p-5 pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Inspector
        </p>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Select a node or relationship to inspect its structural evidence.
        </p>
        <Legend artifact={artifact} nodeColors={nodeColors} />
      </div>
    );
  const value = selection.value;
  const selectedNode = selection.kind === 'node' ? selection.value : null;
  const incoming = selectedNode
    ? artifact.graph.edges.filter((edge) => edge.targetId === value.id)
    : [];
  const outgoing = selectedNode
    ? artifact.graph.edges.filter((edge) => edge.sourceId === value.id)
    : [];
  const edge = selection.kind === 'edge' ? selection.value : null;
  const source = edge
    ? artifact.graph.nodes.find((node) => node.id === edge.sourceId)
    : null;
  const target = edge
    ? artifact.graph.nodes.find((node) => node.id === edge.targetId)
    : null;
  const hasVisibleChildren = selectedNode
    ? artifact.graph.edges.some(
        (relation) =>
          relation.sourceId === selectedNode.id &&
          explorationNodeIds.has(relation.targetId),
      )
    : false;
  const hasHiddenChildren = selectedNode
    ? hasHiddenHierarchyChildren(artifact, selectedNode.id, explorationNodeIds)
    : false;
  return (
    <div className="max-h-[42dvh] overflow-auto p-5 pt-14 lg:max-h-full">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {selection.kind} evidence
      </p>
      <h2 className="mt-4 break-words text-lg font-semibold tracking-tight">
        {selection.kind === 'node'
          ? selection.value.label
          : selection.value.kind}
      </h2>
      <Badge className="mt-2">{value.kind}</Badge>
      {selectedNode ? (
        <div className="mt-4 grid gap-2">
          <Button
            className="w-full"
            variant={isolatedNodeId === selectedNode.id ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              onIsolate(
                isolatedNodeId === selectedNode.id
                  ? undefined
                  : selectedNode.id,
              )
            }
          >
            <GitBranch size={15} />
            {isolatedNodeId === selectedNode.id
              ? 'Return to repository overview'
              : 'Isolate this subtree'}
          </Button>
          {!isolatedNodeId && (hasVisibleChildren || hasHiddenChildren) ? (
            <Button
              className="w-full"
              variant="ghost"
              size="sm"
              onClick={() => onToggleBranch(selectedNode.id)}
            >
              {hasVisibleChildren
                ? 'Collapse descendants'
                : 'Reveal next three levels'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <dl className="mt-5 space-y-3 text-xs">
        <Detail label="ID" value={value.id} mono />
        {selectedNode ? (
          <>
            <Detail label="Subtitle" value={selectedNode.subtitle} />
            <Detail label="Path" value={selectedNode.path} mono />
            <Detail label="Project ID" value={selectedNode.projectId} mono />
            <Detail label="Incoming" value={String(incoming.length)} mono />
            <Detail label="Outgoing" value={String(outgoing.length)} mono />
          </>
        ) : (
          <>
            <Detail label="Source" value={source?.label ?? edge?.sourceId} />
            <Detail label="Target" value={target?.label ?? edge?.targetId} />
          </>
        )}
      </dl>
      <Separator className="my-5" />
      <p className="text-xs font-medium">Metadata</p>
      <dl className="mt-3 space-y-2">
        {Object.entries(value.metadata).length === 0 ? (
          <p className="text-xs text-muted-foreground">No metadata.</p>
        ) : (
          Object.entries(value.metadata).map(([key, metadataValue]) => (
            <Detail key={key} label={key} value={String(metadataValue)} mono />
          ))
        )}
      </dl>
      {selectedNode && incoming.length + outgoing.length > 0 ? (
        <>
          <Separator className="my-5" />
          <p className="text-xs font-medium">Connected nodes</p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {[...incoming, ...outgoing].slice(0, 20).map((relation) => {
              const otherId =
                relation.sourceId === selectedNode.id
                  ? relation.targetId
                  : relation.sourceId;
              const other = artifact.graph.nodes.find(
                (node) => node.id === otherId,
              );
              return (
                <li key={relation.id} className="flex justify-between gap-3">
                  <span className="truncate">{other?.label ?? otherId}</span>
                  <span className="shrink-0 font-mono text-[10px]">
                    {relation.kind}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Legend({
  artifact,
  nodeColors,
}: {
  readonly artifact: RepositoryGraphArtifact;
  readonly nodeColors: Readonly<Record<string, string>>;
}) {
  const kinds = [
    ...new Set(artifact.graph.nodes.map((node) => node.kind)),
  ].sort();
  const relations = [
    ...new Set(artifact.graph.edges.map((edge) => edge.kind)),
  ].sort();
  return (
    <div className="mt-8">
      <Separator />
      <p className="mt-5 text-xs font-medium">Legend</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <Badge key={kind}>
            <span
              className="mr-1.5 size-2 rounded-full"
              style={{ backgroundColor: nodeColors[kind] ?? '#71717a' }}
            />
            {kind}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {relations.map((kind) => (
          <Badge key={kind}>{kind}</Badge>
        ))}
      </div>
    </div>
  );
}

function toggle(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function withValue(values: ReadonlySet<string>, value: string): Set<string> {
  return new Set([...values, value]);
}

function without(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function panelGridClass(leftOpen: boolean, rightOpen: boolean): string {
  if (leftOpen && rightOpen) return 'lg:grid-cols-[270px_minmax(0,1fr)_320px]';
  if (leftOpen) return 'lg:grid-cols-[270px_minmax(0,1fr)_52px]';
  if (rightOpen) return 'lg:grid-cols-[52px_minmax(0,1fr)_320px]';
  return 'lg:grid-cols-[52px_minmax(0,1fr)_52px]';
}

function safeLayoutName(
  requested: LayoutName,
  visibleNodeCount: number,
): LayoutName {
  return requested === 'cose' && visibleNodeCount > 300 ? 'grid' : requested;
}

function layoutOptions(name: LayoutName, edgeDistanceScale = 100) {
  const distanceMultiplier = edgeDistanceScale / 100;
  return name === 'breadthfirst'
    ? {
        name,
        directed: true,
        spacingFactor: 1.25 * distanceMultiplier,
        padding: 36,
      }
    : name === 'cose'
      ? {
          name,
          animate: false,
          numIter: 300,
          idealEdgeLength: 92 * distanceMultiplier,
          nodeRepulsion: 7200,
          nodeOverlap: 24,
          componentSpacing: 72,
          gravity: 0.22,
          randomize: true,
          padding: 36,
        }
      : { name, padding: 36 };
}

function applyVisualTuning(cy: Core, circleScale: number): void {
  const sizeMultiplier = circleScale / 100;
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const baseSize = Number(node.data('baseSize'));
      const size = Number.isFinite(baseSize)
        ? Math.max(20, baseSize * sizeMultiplier)
        : 38 * sizeMultiplier;
      const fontSize = Math.min(22, Math.max(8, Math.round(size / 6.75)));
      const label = String(node.data('label'));
      const characterLimit = Math.max(
        8,
        Math.min(30, Math.floor((size / fontSize) * 3)),
      );
      node.data('size', size);
      node.data('fontSize', fontSize);
      node.data(
        'displayLabel',
        label.length <= characterLimit
          ? label
          : `${label.slice(0, characterLimit - 1)}…`,
      );
      node.data('labelWidth', Math.max(16, size * 0.78));
    });
  });
}

function fitVisibleGraph(
  cy: Core,
  visibleElements: ReturnType<Core['elements']>,
): void {
  separateVisibleNodes(cy, visibleElements);
  cy.fit(visibleElements, 28);
  cy.zoom(Math.min(1.6, cy.zoom() * 1.28));
  cy.center(visibleElements);
}

function separateVisibleNodes(
  cy: Core,
  visibleElements: ReturnType<Core['elements']>,
): void {
  const nodes = visibleElements.nodes();
  const resolved = resolveCircleCollisions(
    nodes.map((node) => ({
      id: node.id(),
      x: node.position('x'),
      y: node.position('y'),
      radius: node.outerWidth() / 2,
    })),
  );
  cy.batch(() => {
    nodes.forEach((node) => {
      const position = resolved.get(node.id());
      if (position) node.position(position);
    });
  });
}
