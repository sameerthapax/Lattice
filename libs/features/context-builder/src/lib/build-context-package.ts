import { createHash } from 'node:crypto';
import type {
  FileKnowledgeNode,
  FolderKnowledgeNode,
  ProjectKnowledgeNode,
  SymbolKnowledgeNode,
} from '@lattice/core-knowledge';
import type { ModuleDependency } from '@lattice/core-analyzer';
import {
  ContextBuilderInputError,
  ContextSourceIntegrityError,
  ContextTargetAmbiguousError,
  ContextTargetNotFoundError,
} from './errors';
import type {
  BuildContextPackageInput,
  ContextExcerptReason,
  ContextFile,
  ContextOmission,
  ContextPackage,
  ContextSelectionOptions,
  ContextSelectionReason,
  ContextSourceExcerpt,
  ContextSymbol,
  NormalizedContextSelectionOptions,
  ResolvedContextTarget,
} from './models';

const DEFAULTS: NormalizedContextSelectionOptions = {
  includeSource: true,
  maxFiles: 20,
  maxSymbols: 80,
  maxRelations: 120,
  maxExcerpts: 20,
  maxExcerptCharacters: 4000,
  maxTotalSourceCharacters: 30000,
  dependencyDepth: 1,
  dependentDepth: 1,
  folderDepth: 1,
  includeExternalDependencies: true,
  includeDiagnostics: true,
};
const CEILINGS = {
  maxFiles: 500,
  maxSymbols: 5000,
  maxRelations: 10000,
  maxExcerpts: 500,
  maxExcerptCharacters: 100000,
  maxTotalSourceCharacters: 1000000,
  dependencyDepth: 5,
  dependentDepth: 5,
  folderDepth: 10,
} as const;
const REASON_ORDER: readonly ContextSelectionReason[] = [
  'target',
  'contains-target',
  'target-declaration',
  'target-export',
  'parent-symbol',
  'child-symbol',
  'same-file-symbol',
  'direct-dependency',
  'transitive-dependency',
  'direct-dependent',
  'transitive-dependent',
  'bound-symbol',
  'binding-source',
  'project-entry-point',
  'project-public-symbol',
  'folder-member',
  'project-member',
];
const EXCERPT_REASON_ORDER: readonly ContextExcerptReason[] = [
  'target-symbol',
  'target-file-header',
  'exported-symbol',
  'bound-symbol',
  'dependency-entry-point',
  'project-entry-point',
];
const SOURCE_SAFETY_CEILING = 2_000_000;
const TRUNCATION_MARKER = '\n/* … excerpt truncated … */\n';

interface Candidate<T> {
  readonly value: T;
  readonly priority: number;
  readonly depth: number;
  readonly reasons: readonly ContextSelectionReason[];
}
interface SelectedFile {
  readonly node: FileKnowledgeNode;
  readonly priority: number;
  readonly depth: number;
  readonly reasons: ContextSelectionReason[];
}
interface SelectedSymbol {
  readonly node: SymbolKnowledgeNode;
  readonly priority: number;
  readonly reasons: ContextSelectionReason[];
}
type RelationEntry = {
  [K in keyof ContextPackage['relationships']]: {
    readonly kind: K;
    readonly value: ContextPackage['relationships'][K][number];
    readonly priority: number;
  };
}[keyof ContextPackage['relationships']];

export async function buildContextPackage(
  input: BuildContextPackageInput,
): Promise<ContextPackage> {
  const options = normalizeOptions(input.options);
  validateStages(input);
  if (options.includeSource && !input.sourceProvider)
    throw new ContextBuilderInputError(
      'A source provider is required when source excerpts are enabled.',
      'SOURCE_PROVIDER_REQUIRED',
    );
  const target = resolveTarget(input);
  const scanById = new Map(input.scan.files.map((file) => [file.id, file]));
  const filesById = new Map(
    input.knowledge.files.map((file) => [file.fileId, file]),
  );
  const symbolsById = new Map(
    input.knowledge.symbols.flatMap((symbol) => [
      [symbol.id, symbol] as const,
      [symbol.symbolId, symbol] as const,
    ]),
  );
  const candidates = selectFileCandidates(
    input,
    target,
    filesById,
    symbolsById,
  );
  const mandatoryFileId =
    target.kind === 'file'
      ? target.fileId
      : target.kind === 'symbol'
        ? target.fileId
        : null;
  if (mandatoryFileId && options.maxFiles < 1)
    throw new ContextBuilderInputError(
      'The file limit cannot contain mandatory context entities.',
      'CONTEXT_LIMIT_TOO_SMALL',
    );
  const selectedFiles = candidates
    .slice(0, options.maxFiles)
    .map((candidate) => ({
      node: candidate.value,
      priority: candidate.priority,
      depth: candidate.depth,
      reasons: sortReasons(candidate.reasons),
    }));
  if (
    mandatoryFileId &&
    !selectedFiles.some((item) => item.node.fileId === mandatoryFileId)
  )
    throw new ContextBuilderInputError(
      'The file limit cannot contain mandatory context entities.',
      'CONTEXT_LIMIT_TOO_SMALL',
    );
  const selectedFileIds = new Set(
    selectedFiles.map((item) => item.node.fileId),
  );
  const symbolCandidates = selectSymbolCandidates(
    input,
    target,
    selectedFiles,
    symbolsById,
  );
  const mandatorySymbolId = target.symbolId;
  if (mandatorySymbolId && options.maxSymbols < 1)
    throw new ContextBuilderInputError(
      'The symbol limit cannot contain the target symbol.',
      'CONTEXT_LIMIT_TOO_SMALL',
    );
  const selectedSymbols = symbolCandidates
    .slice(0, options.maxSymbols)
    .map((candidate) => ({
      node: candidate.value,
      priority: candidate.priority,
      reasons: sortReasons(candidate.reasons),
    }));
  if (
    mandatorySymbolId &&
    !selectedSymbols.some((item) => item.node.symbolId === mandatorySymbolId)
  )
    throw new ContextBuilderInputError(
      'The symbol limit cannot contain the target symbol.',
      'CONTEXT_LIMIT_TOO_SMALL',
    );
  const selectedSymbolIds = new Set(
    selectedSymbols.map((item) => item.node.symbolId),
  );
  const projectIds = collectProjectIds(input, target, selectedFiles);
  const allRelations = buildRelationships(
    input,
    selectedFiles,
    selectedSymbols,
    selectedFileIds,
    selectedSymbolIds,
    projectIds,
    target,
  );
  const relationEntries: RelationEntry[] = [
    ...allRelations.fileDependencies.map((value) => ({
      kind: 'fileDependencies' as const,
      value,
      priority:
        value.sourceFileId === target.fileId ||
        value.targetFileId === target.fileId
          ? 1
          : 8,
    })),
    ...allRelations.symbolBindings.map((value) => ({
      kind: 'symbolBindings' as const,
      value,
      priority:
        value.targetSymbolId === target.symbolId ||
        value.sourceFileId === target.fileId
          ? 2
          : 4,
    })),
    ...allRelations.exports.map((value) => ({
      kind: 'exports' as const,
      value,
      priority:
        value.fileId === target.fileId ||
        value.targetSymbolId === target.symbolId
          ? 3
          : 5,
    })),
    ...allRelations.containment.map((value) => ({
      kind: 'containment' as const,
      value,
      priority: 9,
    })),
    ...allRelations.projectDependencies.map((value) => ({
      kind: 'projectDependencies' as const,
      value,
      priority:
        target.kind === 'project' &&
        (value.sourceProjectId === target.nodeId ||
          value.targetProjectId === target.nodeId)
          ? 0
          : 6,
    })),
  ].sort(compareRelationEntries);
  const kept = relationEntries.slice(0, options.maxRelations);
  const relationships = {
    fileDependencies: kept
      .filter((x) => x.kind === 'fileDependencies')
      .map((x) => x.value),
    symbolBindings: kept
      .filter((x) => x.kind === 'symbolBindings')
      .map((x) => x.value),
    exports: kept.filter((x) => x.kind === 'exports').map((x) => x.value),
    containment: kept
      .filter((x) => x.kind === 'containment')
      .map((x) => x.value),
    projectDependencies: kept
      .filter((x) => x.kind === 'projectDependencies')
      .map((x) => x.value),
  };
  const projects = input.knowledge.projects
    .filter((project) => projectIds.has(project.id))
    .sort(
      (a, b) =>
        compare(a.rootRelativePath, b.rootRelativePath) ||
        compare(a.name, b.name),
    );
  const folderIds = collectFolderIds(input, target, selectedFiles);
  const folders = input.knowledge.folders
    .filter((folder) => folderIds.has(folder.id))
    .sort((a, b) => compare(a.relativePath, b.relativePath));
  const omissions: ContextOmission[] = [];
  addOmission(
    omissions,
    'FILE_LIMIT',
    'file',
    candidates.length - selectedFiles.length,
  );
  addOmission(
    omissions,
    'SYMBOL_LIMIT',
    'symbol',
    symbolCandidates.length - selectedSymbols.length,
  );
  addOmission(
    omissions,
    'RELATION_LIMIT',
    'relation',
    relationEntries.length - kept.length,
  );
  const excerpts = await buildExcerpts(
    input,
    target,
    options,
    selectedFiles,
    selectedSymbols,
    scanById,
    omissions,
  );
  if (!options.includeSource)
    addOmission(omissions, 'SOURCE_DISABLED', 'source', selectedFiles.length);
  const contextFiles: ContextFile[] = selectedFiles.map((item) => {
    const parsed = input.analysis.files.find(
      (file) => file.fileId === item.node.fileId,
    );
    return {
      ...pickFile(item.node),
      diagnostics: options.includeDiagnostics
        ? [...(parsed?.diagnostics ?? [])].sort(
            (a, b) => compare(a.code, b.code) || compare(a.message, b.message),
          )
        : [],
      selectionReasons: item.reasons,
    };
  });
  const contextSymbols: ContextSymbol[] = selectedSymbols.map((item) => ({
    ...pickSymbol(item.node),
    selectionReasons: item.reasons,
  }));
  const externalModules = options.includeExternalDependencies
    ? buildExternalModules(input, selectedFileIds)
    : [];
  const relationCount = kept.length;
  const sourceCharacterCount = excerpts.reduce(
    (sum, x) => sum + x.text.length,
    0,
  );
  const base = {
    schemaVersion: '1' as const,
    target,
    repository: {
      nodeId: input.knowledge.repository.id,
      name: input.knowledge.repository.name,
      projectCount: input.knowledge.summaries.projectCount,
      fileCount: input.knowledge.summaries.fileCount,
      symbolCount: input.knowledge.summaries.symbolCount,
    },
    hierarchy: {
      repositoryId: input.knowledge.repository.id,
      projectIds: projects.map((x) => x.id),
      folderIds: folders.map((x) => x.id),
      fileIds: contextFiles.map((x) => x.fileId),
      symbolIds: contextSymbols.map((x) => x.symbolId),
    },
    entities: {
      projects: projects.map(pickProject),
      folders: folders.map(pickFolder),
      files: contextFiles,
      symbols: contextSymbols,
      externalModules,
    },
    relationships,
    excerpts,
    omissions: sortOmissions(omissions),
    metrics: {
      sourceCharacterCount,
      fileCount: contextFiles.length,
      symbolCount: contextSymbols.length,
      relationCount,
      excerptCount: excerpts.length,
      projectCount: projects.length,
      folderCount: folders.length,
      externalModuleCount: externalModules.length,
    },
    selection: {
      requestedTarget: input.target,
      resolvedTargetNodeId: target.nodeId,
      options,
      selectedFileCount: contextFiles.length,
      selectedSymbolCount: contextSymbols.length,
      selectedRelationCount: relationCount,
      selectedExcerptCount: excerpts.length,
      omittedFileCount: Math.max(0, candidates.length - selectedFiles.length),
      omittedSymbolCount: Math.max(
        0,
        symbolCandidates.length - selectedSymbols.length,
      ),
      omittedRelationCount: Math.max(0, relationEntries.length - kept.length),
      omittedExcerptCount: omissions
        .filter((x) => x.entityKind === 'excerpt')
        .reduce((s, x) => s + x.count, 0),
    },
  };
  const identity = {
    version: 'context:v1',
    repository: input.knowledge.repository.id,
    target: { kind: target.kind, nodeId: target.nodeId },
    options,
    hashes: options.includeSource
      ? selectedFiles.map((x) => [x.node.fileId, x.node.contentHash])
      : [],
  };
  return { ...base, id: sha(stableStringify(identity)) };
}

function normalizeOptions(
  options: ContextSelectionOptions | undefined,
): NormalizedContextSelectionOptions {
  const value = { ...DEFAULTS, ...options };
  for (const key of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
    const current = value[key];
    if (
      !Number.isInteger(current) ||
      current < 0 ||
      current > CEILINGS[key] ||
      (key.startsWith('max') && current === 0)
    )
      throw new ContextBuilderInputError(
        `Invalid context option ${key}.`,
        'INVALID_OPTIONS',
      );
  }
  return value;
}
function validateStages(input: BuildContextPackageInput): void {
  if (input.scan.rootPath !== input.analysis.rootPath)
    throw new ContextBuilderInputError(
      'Scan and analysis roots do not match.',
      'SCAN_ANALYSIS_MISMATCH',
    );
  if (input.scan.rootPath !== input.resolution.rootPath)
    throw new ContextBuilderInputError(
      'Scan and resolution roots do not match.',
      'SCAN_RESOLUTION_MISMATCH',
    );
  const scanIds = new Set(input.scan.files.map((x) => x.id));
  const knowledgeIds = new Set(input.knowledge.files.map((x) => x.fileId));
  for (const file of input.analysis.files)
    if (!scanIds.has(file.fileId))
      throw new ContextBuilderInputError(
        'Analysis references a file absent from the scan.',
        'SCAN_ANALYSIS_MISMATCH',
      );
  for (const module of input.resolution.modules)
    if (!scanIds.has(module.fileId))
      throw new ContextBuilderInputError(
        'Resolution references a file absent from the scan.',
        'SCAN_RESOLUTION_MISMATCH',
      );
  for (const file of input.knowledge.files)
    if (!scanIds.has(file.fileId))
      throw new ContextBuilderInputError(
        'Knowledge references a file absent from the scan.',
        'SCAN_KNOWLEDGE_MISMATCH',
      );
  for (const symbol of input.knowledge.symbols)
    if (!knowledgeIds.has(symbol.fileId))
      throw new ContextBuilderInputError(
        'Knowledge symbol references a missing file.',
        'SCAN_KNOWLEDGE_MISMATCH',
      );
  const nodeIds = new Set([
    input.knowledge.repository.id,
    ...input.knowledge.projects.map((x) => x.id),
    ...input.knowledge.folders.map((x) => x.id),
    ...input.knowledge.files.map((x) => x.id),
    ...input.knowledge.symbols.map((x) => x.id),
  ]);
  for (const relation of input.knowledge.relations)
    if (
      !nodeIds.has(relation.sourceNodeId) ||
      !nodeIds.has(relation.targetNodeId)
    )
      throw new ContextBuilderInputError(
        'Knowledge relation has a missing endpoint.',
        'KNOWLEDGE_RELATION_INVALID',
      );
}

function resolveTarget(input: BuildContextPackageInput): ResolvedContextTarget {
  const t = input.target;
  if (t.kind === 'file') {
    assertOne([t.fileId, t.relativePath]);
    const path = t.relativePath && normalizePath(t.relativePath);
    const matches = input.knowledge.files.filter((x) =>
      t.fileId ? x.fileId === t.fileId : x.relativePath === path,
    );
    return resolved(matches, t.kind, (x) => ({
      nodeId: x.id,
      name: x.name,
      qualifiedName: x.qualifiedName,
      relativePath: x.relativePath,
      projectId: x.projectId,
      fileId: x.fileId,
      symbolId: null,
    }));
  }
  if (t.kind === 'symbol') {
    const strategies =
      Number(Boolean(t.symbolId)) + Number(Boolean(t.qualifiedName));
    if (
      strategies !== 1 ||
      (t.fileId && t.fileRelativePath) ||
      ((t.fileId || t.fileRelativePath) && !t.qualifiedName)
    )
      invalidTarget();
    const filePath = t.fileRelativePath && normalizePath(t.fileRelativePath);
    const matches = input.knowledge.symbols.filter(
      (x) =>
        (t.symbolId
          ? x.symbolId === t.symbolId
          : x.qualifiedName === t.qualifiedName ||
            x.name === t.qualifiedName) &&
        (!t.fileId || x.fileId === t.fileId) &&
        (!filePath ||
          input.knowledge.files.find((f) => f.fileId === x.fileId)
            ?.relativePath === filePath),
    );
    return resolved(matches, t.kind, (x) => ({
      nodeId: x.id,
      name: x.name,
      qualifiedName: x.qualifiedName,
      relativePath:
        input.knowledge.files.find((f) => f.fileId === x.fileId)
          ?.relativePath ?? null,
      projectId: x.projectId,
      fileId: x.fileId,
      symbolId: x.symbolId,
    }));
  }
  if (t.kind === 'folder') {
    assertOne([t.folderId, t.relativePath]);
    const path = t.relativePath && normalizePath(t.relativePath);
    return resolved(
      input.knowledge.folders.filter((x) =>
        t.folderId ? x.id === t.folderId : x.relativePath === path,
      ),
      t.kind,
      (x) => ({
        nodeId: x.id,
        name: x.name,
        qualifiedName: x.qualifiedName,
        relativePath: x.relativePath,
        projectId: x.projectId,
        fileId: null,
        symbolId: null,
      }),
    );
  }
  assertOne([t.projectId, t.name, t.rootRelativePath]);
  const root = t.rootRelativePath && normalizePath(t.rootRelativePath);
  return resolved(
    input.knowledge.projects.filter((x) =>
      t.projectId
        ? x.id === t.projectId
        : t.name
          ? x.name === t.name
          : x.rootRelativePath === root,
    ),
    t.kind,
    (x) => ({
      nodeId: x.id,
      name: x.name,
      qualifiedName: x.qualifiedName,
      relativePath: x.rootRelativePath,
      projectId: x.id,
      fileId: null,
      symbolId: null,
    }),
  );
}
function resolved<T>(
  matches: readonly T[],
  kind: ResolvedContextTarget['kind'],
  map: (value: T) => Omit<ResolvedContextTarget, 'kind'>,
): ResolvedContextTarget {
  if (matches.length === 0)
    throw new ContextTargetNotFoundError(
      `Context ${kind} target was not found.`,
    );
  if (matches.length > 1)
    throw new ContextTargetAmbiguousError(
      `Context ${kind} target is ambiguous.`,
    );
  return { kind, ...map(matches[0] as T) };
}
function assertOne(values: readonly (string | undefined)[]): void {
  if (values.filter(Boolean).length !== 1) invalidTarget();
}
function invalidTarget(): never {
  throw new ContextBuilderInputError(
    'Target must use exactly one valid lookup strategy.',
    'TARGET_LOOKUP_INVALID',
  );
}

function selectFileCandidates(
  input: BuildContextPackageInput,
  target: ResolvedContextTarget,
  files: Map<string, FileKnowledgeNode>,
  symbols: Map<string, SymbolKnowledgeNode>,
): Candidate<FileKnowledgeNode>[] {
  const map = new Map<string, Candidate<FileKnowledgeNode>>();
  const add = (
    file: FileKnowledgeNode | undefined,
    priority: number,
    depth: number,
    reason: ContextSelectionReason,
  ): void => {
    if (!file) return;
    const old = map.get(file.fileId);
    map.set(file.fileId, {
      value: file,
      priority: Math.min(priority, old?.priority ?? priority),
      depth: Math.min(depth, old?.depth ?? depth),
      reasons: [...(old?.reasons ?? []), reason],
    });
  };
  const baseFile = target.fileId ? files.get(target.fileId) : undefined;
  if (baseFile)
    add(
      baseFile,
      0,
      0,
      target.kind === 'symbol' ? 'contains-target' : 'target',
    );
  if (target.kind === 'folder') {
    const folder = input.knowledge.folders.find((x) => x.id === target.nodeId);
    for (const file of input.knowledge.files) {
      const distance = folderDistance(
        file.relativePath,
        folder?.relativePath ?? '',
      );
      if (distance < 0) continue;
      const sourceClass =
        file.status === 'parsed' && !isConfigurationOrDocumentation(file)
          ? file.publicSymbolIds.length > 0
            ? 10
            : 20
          : 30;
      add(file, sourceClass, distance, 'folder-member');
    }
  } else if (target.kind === 'project') {
    const project = input.knowledge.projects.find(
      (x) => x.id === target.nodeId,
    );
    const publicFiles = new Set(
      (project?.publicSymbolIds ?? []).map((id) => symbols.get(id)?.fileId),
    );
    const crossDependencyIds = new Set(
      input.knowledge.projectDependencies.flatMap((d) =>
        d.sourceProjectId === target.nodeId ||
        d.targetProjectId === target.nodeId
          ? d.fileDependencyIds
          : [],
      ),
    );
    const cross = new Set(
      input.resolution.dependencies
        .filter((dependency) => crossDependencyIds.has(dependency.id))
        .flatMap((dependency) => [
          dependency.sourceFileId,
          dependency.targetFileId,
        ]),
    );
    for (const file of input.knowledge.files.filter(
      (x) => x.projectId === target.nodeId,
    )) {
      const priority = projectFilePriority(
        file,
        publicFiles.has(file.fileId),
        cross.has(file.fileId),
      );
      add(
        file,
        priority,
        0,
        publicFiles.has(file.fileId)
          ? 'project-public-symbol'
          : 'project-member',
      );
      if (publicFiles.has(file.fileId))
        add(file, priority, 0, 'project-member');
      if (cross.has(file.fileId)) {
        const outgoing = input.resolution.dependencies.some(
          (dependency) =>
            crossDependencyIds.has(dependency.id) &&
            dependency.sourceFileId === file.fileId,
        );
        add(
          file,
          priority,
          0,
          outgoing ? 'direct-dependency' : 'direct-dependent',
        );
      }
    }
    for (const dependency of input.resolution.dependencies.filter((item) =>
      crossDependencyIds.has(item.id),
    )) {
      const targetFile = files.get(dependency.targetFileId);
      const sourceFile = files.get(dependency.sourceFileId);
      if (sourceFile?.projectId === target.nodeId)
        add(targetFile, 25, 1, 'direct-dependency');
      if (targetFile?.projectId === target.nodeId)
        add(sourceFile, 25, 1, 'direct-dependent');
    }
  }
  if (baseFile) {
    expandDependencies(
      input.resolution.dependencies,
      baseFile.fileId,
      input.options?.dependencyDepth ?? DEFAULTS.dependencyDepth,
      true,
      (id, depth) =>
        add(
          files.get(id),
          depth === 1 ? 10 : 20,
          depth,
          depth === 1 ? 'direct-dependency' : 'transitive-dependency',
        ),
    );
    expandDependencies(
      input.resolution.dependencies,
      baseFile.fileId,
      input.options?.dependentDepth ?? DEFAULTS.dependentDepth,
      false,
      (id, depth) =>
        add(
          files.get(id),
          depth === 1 ? 11 : 21,
          depth,
          depth === 1 ? 'direct-dependent' : 'transitive-dependent',
        ),
    );
    for (const binding of input.resolution.symbolBindings) {
      if (target.symbolId && binding.targetSymbolId === target.symbolId)
        add(files.get(binding.sourceFileId), 12, 1, 'binding-source');
      if (binding.sourceFileId === baseFile.fileId && binding.targetFileId)
        add(files.get(binding.targetFileId), 12, 1, 'bound-symbol');
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.depth - b.depth ||
      b.value.incomingFileDependencyIds.length -
        a.value.incomingFileDependencyIds.length ||
      b.value.outgoingFileDependencyIds.length -
        a.value.outgoingFileDependencyIds.length ||
      compare(a.value.relativePath, b.value.relativePath) ||
      compare(a.value.fileId, b.value.fileId),
  );
}
function projectFilePriority(
  file: FileKnowledgeNode,
  containsProjectPublicSymbol: boolean,
  crossProjectParticipant: boolean,
): number {
  if (containsProjectPublicSymbol) return 10;
  if (crossProjectParticipant) return 20;
  if (isConfigurationOrDocumentation(file)) return 60;
  if (file.status === 'parsed') return isTestFile(file.relativePath) ? 40 : 30;
  return 60;
}
function isConfigurationOrDocumentation(file: FileKnowledgeNode): boolean {
  const segments = file.relativePath.split('/');
  const name = segments.at(-1) ?? '';
  return (
    file.language === 'JSON' ||
    file.language === 'YAML' ||
    file.language === 'Markdown' ||
    name === '.gitkeep' ||
    name.includes('.config.') ||
    name.startsWith('tsconfig.') ||
    segments.includes('config')
  );
}
function isTestFile(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const name = segments.at(-1) ?? '';
  return (
    segments.includes('__tests__') ||
    name.includes('.spec.') ||
    name.includes('.test.')
  );
}
function expandDependencies(
  deps: readonly ModuleDependency[],
  start: string,
  max: number,
  outgoing: boolean,
  visit: (id: string, depth: number) => void,
): void {
  let frontier = [start];
  const seen = new Set([start]);
  for (let depth = 1; depth <= max; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of deps
        .filter((d) =>
          outgoing ? d.sourceFileId === id : d.targetFileId === id,
        )
        .sort((a, b) => compare(a.id, b.id))) {
        const found = outgoing ? dep.targetFileId : dep.sourceFileId;
        if (!seen.has(found)) {
          seen.add(found);
          next.push(found);
          visit(found, depth);
        }
      }
    }
    frontier = next;
  }
}
function selectSymbolCandidates(
  input: BuildContextPackageInput,
  target: ResolvedContextTarget,
  files: readonly SelectedFile[],
  symbols: Map<string, SymbolKnowledgeNode>,
): Candidate<SymbolKnowledgeNode>[] {
  const map = new Map<string, Candidate<SymbolKnowledgeNode>>();
  const add = (
    symbol: SymbolKnowledgeNode | undefined,
    priority: number,
    reason: ContextSelectionReason,
  ): void => {
    if (!symbol || !files.some((x) => x.node.fileId === symbol.fileId)) return;
    const old = map.get(symbol.symbolId);
    map.set(symbol.symbolId, {
      value: symbol,
      priority: Math.min(priority, old?.priority ?? priority),
      depth: 0,
      reasons: [...(old?.reasons ?? []), reason],
    });
  };
  const targetSymbol = target.symbolId
    ? symbols.get(target.symbolId)
    : undefined;
  if (targetSymbol) {
    add(targetSymbol, 0, 'target');
    const relatedIds = new Set<string>([targetSymbol.symbolId]);
    add(
      targetSymbol.parentSymbolId
        ? symbols.get(targetSymbol.parentSymbolId)
        : undefined,
      1,
      'parent-symbol',
    );
    if (targetSymbol.parentSymbolId)
      relatedIds.add(targetSymbol.parentSymbolId);
    for (const id of targetSymbol.childSymbolIds) {
      relatedIds.add(id);
      add(symbols.get(id), 2, 'child-symbol');
    }
    for (const symbol of input.knowledge.symbols.filter(
      (x) => x.fileId === target.fileId && !relatedIds.has(x.symbolId),
    ))
      add(symbol, 6, 'same-file-symbol');
  } else if (target.kind === 'file') {
    const targetFile = files.find((file) => file.node.fileId === target.fileId);
    for (const id of targetFile?.node.symbolIds ?? []) {
      const symbol = symbols.get(id);
      add(
        symbol,
        targetFile?.node.publicSymbolIds.includes(id) ? 1 : 2,
        targetFile?.node.publicSymbolIds.includes(id)
          ? 'target-export'
          : 'same-file-symbol',
      );
    }
    const boundSymbolIds = new Set<string>();
    for (const binding of input.resolution.symbolBindings.filter(
      (item) => item.sourceFileId === target.fileId,
    )) {
      if (binding.targetSymbolId) {
        boundSymbolIds.add(binding.targetSymbolId);
        add(symbols.get(binding.targetSymbolId), 3, 'bound-symbol');
      }
    }
    for (const file of files.filter(
      (item) => item.node.fileId !== target.fileId,
    )) {
      for (const id of file.node.publicSymbolIds)
        if (!boundSymbolIds.has(symbols.get(id)?.symbolId ?? ''))
          add(symbols.get(id), 4, 'target-export');
      for (const id of file.node.symbolIds)
        if (!boundSymbolIds.has(symbols.get(id)?.symbolId ?? ''))
          add(symbols.get(id), 5, 'same-file-symbol');
    }
  } else {
    for (const file of files) {
      for (const id of file.node.publicSymbolIds)
        add(
          symbols.get(id),
          file.priority,
          file.reasons.includes('project-public-symbol')
            ? 'project-public-symbol'
            : 'target-export',
        );
      for (const id of file.node.symbolIds)
        add(
          symbols.get(id),
          file.priority + 1,
          file.reasons.includes('folder-member')
            ? 'folder-member'
            : 'project-member',
        );
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      compare(
        input.knowledge.files.find((x) => x.fileId === a.value.fileId)
          ?.relativePath ?? '',
        input.knowledge.files.find((x) => x.fileId === b.value.fileId)
          ?.relativePath ?? '',
      ) ||
      a.value.location.startLine - b.value.location.startLine ||
      a.value.location.startColumn - b.value.location.startColumn ||
      compare(a.value.qualifiedName, b.value.qualifiedName) ||
      compare(a.value.symbolId, b.value.symbolId),
  );
}

function buildRelationships(
  input: BuildContextPackageInput,
  files: readonly SelectedFile[],
  symbols: readonly SelectedSymbol[],
  fileIds: Set<string>,
  symbolIds: Set<string>,
  projectIds: Set<string>,
  target: ResolvedContextTarget,
) {
  const depth = new Map(files.map((x) => [x.node.fileId, x.depth]));
  const fileDependencies = input.resolution.dependencies
    .filter((x) => fileIds.has(x.sourceFileId) && fileIds.has(x.targetFileId))
    .sort(
      (a, b) =>
        (depth.get(a.targetFileId) ?? 0) - (depth.get(b.targetFileId) ?? 0) ||
        compare(
          pathFor(input, a.sourceFileId),
          pathFor(input, b.sourceFileId),
        ) ||
        compare(
          pathFor(input, a.targetFileId),
          pathFor(input, b.targetFileId),
        ) ||
        compare(a.kind, b.kind) ||
        compare(a.id, b.id),
    )
    .map((x) => ({
      ...x,
      depthFromTarget: Math.max(
        depth.get(x.sourceFileId) ?? 0,
        depth.get(x.targetFileId) ?? 0,
      ),
    }));
  const symbolBindings = input.resolution.symbolBindings
    .filter(
      (x) =>
        fileIds.has(x.sourceFileId) &&
        x.targetSymbolId !== null &&
        symbolIds.has(x.targetSymbolId),
    )
    .sort(
      (a, b) =>
        compare(
          pathFor(input, a.sourceFileId),
          pathFor(input, b.sourceFileId),
        ) ||
        compare(a.targetSymbolId ?? '', b.targetSymbolId ?? '') ||
        compare(a.id, b.id),
    )
    .map((x) => ({
      id: x.id,
      sourceFileId: x.sourceFileId,
      targetSymbolId: x.targetSymbolId as string,
      bindingKind: x.kind,
      importedName: x.importedName,
      localName: x.localName,
      typeOnly: bindingTypeOnly(input, x.sourceEntityId),
    }));
  const exports = input.resolution.modules
    .flatMap((module) => module.exports)
    .filter(
      (x) =>
        fileIds.has(x.sourceFileId) &&
        (!x.targetSymbolId || symbolIds.has(x.targetSymbolId)) &&
        (!x.targetFileId || fileIds.has(x.targetFileId)),
    )
    .sort(
      (a, b) =>
        compare(
          pathFor(input, a.sourceFileId),
          pathFor(input, b.sourceFileId),
        ) ||
        compare(a.exportedName, b.exportedName) ||
        compare(
          a.targetSymbolId ?? a.targetFileId ?? '',
          b.targetSymbolId ?? b.targetFileId ?? '',
        ),
    )
    .map((x) => ({
      id: x.exportId,
      fileId: x.sourceFileId,
      exportedName: x.exportedName,
      targetSymbolId: x.targetSymbolId ?? x.localSymbolId,
      targetFileId: x.targetFileId,
      typeOnly: x.typeOnly,
      defaultExport: x.exportedName === 'default',
      status: x.status,
    }));
  const containment = input.knowledge.relations
    .filter(
      (x) =>
        (x.kind === 'contains' ||
          x.kind === 'declares' ||
          x.kind === 'parent-symbol') &&
        endpointSelected(
          x.sourceNodeId,
          input,
          fileIds,
          symbolIds,
          projectIds,
        ) &&
        endpointSelected(x.targetNodeId, input, fileIds, symbolIds, projectIds),
    )
    .sort(
      (a, b) =>
        compare(a.kind, b.kind) ||
        compare(a.sourceNodeId, b.sourceNodeId) ||
        compare(a.targetNodeId, b.targetNodeId) ||
        compare(a.id, b.id),
    )
    .map((x) => ({
      id: x.id,
      parentNodeId: x.sourceNodeId,
      childNodeId: x.targetNodeId,
      kind: x.kind as 'contains' | 'declares' | 'parent-symbol',
    }));
  const projectDependencies = input.knowledge.projectDependencies
    .filter(
      (x) =>
        projectIds.has(x.sourceProjectId) &&
        projectIds.has(x.targetProjectId) &&
        (target.kind !== 'project' ||
          x.sourceProjectId === target.nodeId ||
          x.targetProjectId === target.nodeId),
    )
    .sort(
      (a, b) =>
        compare(a.sourceProjectId, b.sourceProjectId) ||
        compare(a.targetProjectId, b.targetProjectId) ||
        compare(a.id, b.id),
    )
    .map((x) => ({
      id: x.id,
      sourceProjectId: x.sourceProjectId,
      targetProjectId: x.targetProjectId,
      dependencyCount: x.dependencyCount,
      typeOnlyDependencyCount: x.typeOnlyDependencyCount,
    }));
  return {
    fileDependencies,
    symbolBindings,
    exports,
    containment,
    projectDependencies,
  };
}
function endpointSelected(
  nodeId: string,
  input: BuildContextPackageInput,
  fileIds: Set<string>,
  symbolIds: Set<string>,
  projectIds: Set<string>,
): boolean {
  return (
    nodeId === input.knowledge.repository.id ||
    input.knowledge.projects.some(
      (x) => x.id === nodeId && projectIds.has(x.id),
    ) ||
    input.knowledge.folders.some((x) => x.id === nodeId) ||
    input.knowledge.files.some(
      (x) => x.id === nodeId && fileIds.has(x.fileId),
    ) ||
    input.knowledge.symbols.some(
      (x) => x.id === nodeId && symbolIds.has(x.symbolId),
    )
  );
}
function bindingTypeOnly(
  input: BuildContextPackageInput,
  sourceEntityId: string,
): boolean {
  return (
    input.analysis.files
      .flatMap((x) => [...x.imports, ...x.exports])
      .find((x) => x.id === sourceEntityId)?.typeOnly ?? false
  );
}

async function buildExcerpts(
  input: BuildContextPackageInput,
  target: ResolvedContextTarget,
  options: NormalizedContextSelectionOptions,
  files: readonly SelectedFile[],
  symbols: readonly SelectedSymbol[],
  scanById: Map<
    string,
    {
      readonly id: string;
      readonly relativePath: string;
      readonly contentHash: string;
    }
  >,
  omissions: ContextOmission[],
): Promise<ContextSourceExcerpt[]> {
  if (!options.includeSource) return [];
  const sourceProvider = input.sourceProvider;
  if (!sourceProvider)
    throw new ContextBuilderInputError(
      'A source provider is required when source excerpts are enabled.',
      'SOURCE_PROVIDER_REQUIRED',
    );
  const requests: {
    file: SelectedFile;
    start: number;
    end: number;
    reason: ContextExcerptReason;
    symbolId: string | null;
    mandatory: boolean;
    priority: number;
  }[] = [];
  if (target.kind === 'symbol') {
    const symbol = symbols.find((x) => x.node.symbolId === target.symbolId);
    const file = files.find((x) => x.node.fileId === target.fileId);
    if (symbol && file)
      requests.push({
        file,
        start: Math.max(1, symbol.node.location.startLine - 2),
        end: symbol.node.location.endLine + 2,
        reason: 'target-symbol',
        symbolId: symbol.node.symbolId,
        mandatory: true,
        priority: 0,
      });
  } else if (target.kind === 'file') {
    const targetFile = files.find((file) => file.node.fileId === target.fileId);
    if (targetFile)
      requests.push({
        file: targetFile,
        start: 1,
        end: 80,
        reason: 'target-file-header',
        symbolId: null,
        mandatory: true,
        priority: 0,
      });
    for (const symbol of symbols) {
      const file = files.find(
        (item) => item.node.fileId === symbol.node.fileId,
      );
      if (!file) continue;
      const inTargetFile = symbol.node.fileId === target.fileId;
      const bound = symbol.reasons.includes('bound-symbol');
      const priority = inTargetFile
        ? symbol.node.exported
          ? 1
          : 2
        : bound
          ? 3
          : symbol.node.exported
            ? 4
            : 5;
      requests.push({
        file,
        start: Math.max(1, symbol.node.location.startLine - 2),
        end: symbol.node.location.endLine + 2,
        reason: bound ? 'bound-symbol' : 'exported-symbol',
        symbolId: symbol.node.symbolId,
        mandatory: false,
        priority,
      });
    }
    for (const file of files.filter(
      (item) => item.node.fileId !== target.fileId,
    ))
      requests.push({
        file,
        start: 1,
        end: 80,
        reason: 'dependency-entry-point',
        symbolId: null,
        mandatory: false,
        priority: 6,
      });
  } else {
    for (const symbol of symbols) {
      const file = files.find(
        (item) => item.node.fileId === symbol.node.fileId,
      );
      if (!file) continue;
      requests.push({
        file,
        start: Math.max(1, symbol.node.location.startLine - 2),
        end: symbol.node.location.endLine + 2,
        reason: 'exported-symbol',
        symbolId: symbol.node.symbolId,
        mandatory: false,
        priority: symbol.node.exported ? 1 : 2,
      });
    }
    for (const file of files.filter((item) =>
      target.kind === 'project'
        ? item.reasons.includes('project-public-symbol') ||
          item.reasons.includes('direct-dependency') ||
          item.reasons.includes('direct-dependent')
        : item.node.publicSymbolIds.length > 0,
    ))
      requests.push({
        file,
        start: 1,
        end: 80,
        reason:
          target.kind === 'project' &&
          file.reasons.includes('project-public-symbol')
            ? 'project-entry-point'
            : 'dependency-entry-point',
        symbolId: null,
        mandatory: false,
        priority: 5,
      });
  }
  const grouped = new Map<string, typeof requests>();
  for (const request of requests) {
    const list = grouped.get(request.file.node.fileId) ?? [];
    list.push(request);
    grouped.set(request.file.node.fileId, list);
  }
  const rankedRequests = [...grouped.entries()]
    .flatMap(([fileId, fileRequests]) =>
      mergeRequests(fileRequests, Number.MAX_SAFE_INTEGER).map((request) => ({
        ...request,
        file: fileRequests[0]?.file,
        fileId,
      })),
    )
    .filter(
      (request): request is typeof request & { file: SelectedFile } =>
        request.file !== undefined,
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        compare(a.file.node.relativePath, b.file.node.relativePath) ||
        a.start - b.start ||
        a.end - b.end,
    );
  const excerpts: ContextSourceExcerpt[] = [];
  const sourceCache = new Map<string, { lines: string[] }>();
  const unavailable = new Set<string>();
  let total = 0;
  for (const request of rankedRequests) {
    if (excerpts.length >= options.maxExcerpts) {
      addOmission(
        omissions,
        'EXCERPT_LIMIT',
        'excerpt',
        rankedRequests.length - rankedRequests.indexOf(request),
      );
      break;
    }
    const file = request.file;
    const scanned = scanById.get(file.node.fileId);
    if (!scanned) continue;
    if (unavailable.has(file.node.fileId)) continue;
    let cached = sourceCache.get(file.node.fileId);
    if (!cached) {
      let source;
      try {
        source = await sourceProvider.readSource({
          fileId: scanned.id,
          relativePath: scanned.relativePath,
          expectedContentHash: scanned.contentHash,
        });
      } catch (error: unknown) {
        if (request.mandatory)
          throw new ContextBuilderInputError(
            `Mandatory target source is unavailable: ${scanned.relativePath}.`,
            'SOURCE_FILE_MISMATCH',
            { cause: error },
          );
        unavailable.add(file.node.fileId);
        addOmission(
          omissions,
          'SOURCE_UNAVAILABLE',
          'source',
          1,
          file.node.fileId,
        );
        continue;
      }
      validateSource(source, scanned);
      if (source.content.includes('\0')) {
        if (request.mandatory)
          throw new ContextSourceIntegrityError(
            `Mandatory target source is binary: ${scanned.relativePath}.`,
            'SOURCE_FILE_MISMATCH',
          );
        unavailable.add(file.node.fileId);
        addOmission(omissions, 'BINARY_FILE', 'source', 1, file.node.fileId);
        continue;
      }
      cached = {
        lines: source.content.split(/\r\n|\n|\r/),
      };
      sourceCache.set(file.node.fileId, cached);
    }
    const start = Math.min(request.start, Math.max(1, cached.lines.length));
    const end = Math.min(request.end, Math.max(1, cached.lines.length));
    let text = cached.lines.slice(start - 1, end).join('\n');
    let truncated = false;
    if (text.length > options.maxExcerptCharacters) {
      text = truncate(text, options.maxExcerptCharacters);
      truncated = true;
      addOmission(omissions, 'EXCERPT_CHARACTER_LIMIT', 'excerpt', 1);
    }
    const remaining = options.maxTotalSourceCharacters - total;
    if (text.length > remaining) {
      if (remaining >= 128) {
        text = truncate(text, remaining);
        truncated = true;
        addOmission(omissions, 'TOTAL_SOURCE_CHARACTER_LIMIT', 'excerpt', 1);
      } else {
        addOmission(omissions, 'TOTAL_SOURCE_CHARACTER_LIMIT', 'excerpt', 1);
        continue;
      }
    }
    const excerpt = {
      id: sha(
        stableStringify([
          file.node.fileId,
          start,
          end,
          request.reasons,
          request.symbolIds,
          text,
        ]),
      ),
      fileId: file.node.fileId,
      relativePath: file.node.relativePath,
      contentHash: file.node.contentHash,
      startLine: start,
      endLine: end,
      startCharacter: 0,
      endCharacter: (cached.lines[end - 1] ?? '').length,
      text,
      reasons: request.reasons,
      symbolIds: request.symbolIds,
      truncated,
    };
    excerpts.push(excerpt);
    total += text.length;
  }
  return excerpts.sort(
    (a, b) =>
      compare(a.relativePath, b.relativePath) ||
      a.startLine - b.startLine ||
      a.endLine - b.endLine ||
      compare(a.id, b.id),
  );
}
function mergeRequests(
  requests: readonly {
    start: number;
    end: number;
    reason: ContextExcerptReason;
    symbolId: string | null;
    priority: number;
    mandatory: boolean;
  }[],
  lineCount: number,
) {
  const sorted = requests
    .map((x) => ({
      ...x,
      start: Math.min(x.start, Math.max(1, lineCount)),
      end: Math.min(x.end, Math.max(1, lineCount)),
    }))
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        EXCERPT_REASON_ORDER.indexOf(a.reason) -
          EXCERPT_REASON_ORDER.indexOf(b.reason),
    );
  const merged: {
    start: number;
    end: number;
    reasons: ContextExcerptReason[];
    symbolIds: string[];
    priority: number;
    mandatory: boolean;
  }[] = [];
  for (const item of sorted) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end + 3) {
      previous.end = Math.max(previous.end, item.end);
      previous.reasons = sortByOrder(
        [...previous.reasons, item.reason],
        EXCERPT_REASON_ORDER,
      );
      previous.symbolIds = [
        ...new Set([
          ...previous.symbolIds,
          ...(item.symbolId ? [item.symbolId] : []),
        ]),
      ].sort(compare);
      previous.priority = Math.min(previous.priority, item.priority);
      previous.mandatory ||= item.mandatory;
    } else
      merged.push({
        start: item.start,
        end: item.end,
        reasons: [item.reason],
        symbolIds: item.symbolId ? [item.symbolId] : [],
        priority: item.priority,
        mandatory: item.mandatory,
      });
  }
  return merged;
}
function validateSource(
  source: {
    fileId: string;
    relativePath: string;
    contentHash: string;
    content: string;
  },
  expected: { id: string; relativePath: string; contentHash: string },
): void {
  if (
    source.fileId !== expected.id ||
    normalizePath(source.relativePath) !== expected.relativePath
  )
    throw new ContextSourceIntegrityError(
      'Source provider returned a mismatched file identity.',
      'SOURCE_FILE_MISMATCH',
    );
  if (source.content.length > SOURCE_SAFETY_CEILING)
    throw new ContextSourceIntegrityError(
      'Source provider returned a file above the safety ceiling.',
      'SOURCE_TOO_LARGE',
    );
  if (
    source.contentHash !== expected.contentHash ||
    sha(source.content) !== expected.contentHash
  )
    throw new ContextSourceIntegrityError(
      'Source provider returned content with a mismatched hash.',
      'SOURCE_HASH_MISMATCH',
    );
}
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= TRUNCATION_MARKER.length) return safeSlice(text, 0, max);
  const available = max - TRUNCATION_MARKER.length;
  const beginning = Math.floor(available * 0.65);
  return (
    safeSlice(text, 0, beginning) +
    TRUNCATION_MARKER +
    safeSlice(text, text.length - (available - beginning), text.length)
  );
}
function safeSlice(text: string, start: number, end?: number): string {
  let safeStart = start;
  let safeEnd = end ?? text.length;
  if (safeStart > 0 && isLow(text.charCodeAt(safeStart))) safeStart++;
  if (safeEnd < text.length && isHigh(text.charCodeAt(safeEnd - 1))) safeEnd--;
  return text.slice(safeStart, safeEnd);
}
const isLow = (n: number): boolean => n >= 0xdc00 && n <= 0xdfff;
const isHigh = (n: number): boolean => n >= 0xd800 && n <= 0xdbff;

function collectProjectIds(
  input: BuildContextPackageInput,
  target: ResolvedContextTarget,
  files: readonly SelectedFile[],
): Set<string> {
  const ids = new Set(
    [target.projectId, ...files.map((x) => x.node.projectId)].filter(
      (x): x is string => x !== null,
    ),
  );
  if (target.kind === 'project')
    for (const dependency of input.knowledge.projectDependencies) {
      if (dependency.sourceProjectId === target.nodeId)
        ids.add(dependency.targetProjectId);
      if (dependency.targetProjectId === target.nodeId)
        ids.add(dependency.sourceProjectId);
    }
  return ids;
}
function collectFolderIds(
  input: BuildContextPackageInput,
  target: ResolvedContextTarget,
  files: readonly SelectedFile[],
): Set<string> {
  const ids = new Set<string>();
  const byId = new Map(input.knowledge.folders.map((x) => [x.id, x]));
  const add = (id: string | null): void => {
    let current = id;
    while (current) {
      if (ids.has(current)) break;
      ids.add(current);
      current = byId.get(current)?.parentFolderId ?? null;
    }
  };
  if (target.kind === 'folder') add(target.nodeId);
  for (const file of files) add(file.node.folderId);
  if (target.kind === 'folder') {
    const targetFolder = byId.get(target.nodeId);
    for (const folder of input.knowledge.folders)
      if (
        folder.relativePath.startsWith(`${targetFolder?.relativePath}/`) &&
        descendantFolderDistance(
          folder.relativePath,
          targetFolder?.relativePath ?? '',
        ) <= (input.options?.folderDepth ?? DEFAULTS.folderDepth)
      )
        ids.add(folder.id);
  }
  return ids;
}
function buildExternalModules(
  input: BuildContextPackageInput,
  fileIds: Set<string>,
) {
  const grouped = new Map<
    string,
    {
      sourceSpecifier: string;
      sourceFileIds: Set<string>;
      typeOnly: boolean;
      contributingEntityIds: Set<string>;
    }
  >();
  for (const item of input.resolution.externalDependencies.filter((x) =>
    fileIds.has(x.sourceFileId),
  )) {
    const key = `${item.sourceSpecifier}\0${item.typeOnly}`;
    const value = grouped.get(key) ?? {
      sourceSpecifier: item.sourceSpecifier,
      sourceFileIds: new Set(),
      typeOnly: item.typeOnly,
      contributingEntityIds: new Set(),
    };
    value.sourceFileIds.add(item.sourceFileId);
    for (const id of [...item.importIds, ...item.exportIds])
      value.contributingEntityIds.add(id);
    grouped.set(key, value);
  }
  return [...grouped.values()]
    .map((x) => ({
      ...x,
      sourceFileIds: [...x.sourceFileIds].sort(compare),
      contributingEntityIds: [...x.contributingEntityIds].sort(compare),
    }))
    .sort(
      (a, b) =>
        compare(a.sourceSpecifier, b.sourceSpecifier) ||
        Number(a.typeOnly) - Number(b.typeOnly),
    );
}
function pickProject(x: ProjectKnowledgeNode) {
  return {
    nodeId: x.id,
    name: x.name,
    projectKind: x.projectKind,
    rootRelativePath: x.rootRelativePath,
    sourceRootRelativePath: x.sourceRootRelativePath,
    publicSymbolIds: [...x.publicSymbolIds].sort(compare),
    incomingProjectDependencyCount: x.incomingProjectDependencyIds.length,
    outgoingProjectDependencyCount: x.outgoingProjectDependencyIds.length,
  };
}
function pickFolder(x: FolderKnowledgeNode) {
  return {
    nodeId: x.id,
    relativePath: x.relativePath,
    projectId: x.projectId,
    parentFolderId: x.parentFolderId,
    descendantFileCount: x.descendantFileCount,
    descendantSymbolCount: x.descendantSymbolCount,
  };
}
function pickFile(x: FileKnowledgeNode) {
  return {
    nodeId: x.id,
    fileId: x.fileId,
    relativePath: x.relativePath,
    projectId: x.projectId,
    folderId: x.folderId,
    language: x.language,
    status: x.status,
    contentHash: x.contentHash,
    symbolIds: [...x.symbolIds].sort(compare),
    publicSymbolIds: [...x.publicSymbolIds].sort(compare),
    importCount: x.importCount,
    exportCount: x.exportCount,
    incomingInternalDependencyCount: x.incomingFileDependencyIds.length,
    outgoingInternalDependencyCount: x.outgoingFileDependencyIds.length,
    externalDependencyCount: x.externalDependencyCount,
    diagnosticCount: x.diagnosticCount,
    hasSyntaxErrors: x.hasSyntaxErrors,
  };
}
function pickSymbol(x: SymbolKnowledgeNode) {
  return {
    nodeId: x.id,
    symbolId: x.symbolId,
    fileId: x.fileId,
    name: x.name,
    qualifiedName: x.qualifiedName,
    symbolKind: x.symbolKind,
    exported: x.exported,
    defaultExport: x.defaultExport,
    typeOnly: x.typeOnly,
    async: x.async,
    parentSymbolId: x.parentSymbolId,
    childSymbolIds: [...x.childSymbolIds].sort(compare),
    incomingBindingCount: x.incomingBindingIds.length,
    location: x.location,
  };
}
function addOmission(
  list: ContextOmission[],
  reason: ContextOmission['reason'],
  kind: ContextOmission['entityKind'],
  count: number,
  entityId: string | null = null,
): void {
  if (count > 0)
    list.push({ reason, entityKind: kind, entityId, count, details: null });
}
function sortOmissions(items: readonly ContextOmission[]): ContextOmission[] {
  const grouped = new Map<string, ContextOmission>();
  for (const x of items) {
    const key = `${x.reason}\0${x.entityKind}\0${x.entityId ?? ''}`;
    const old = grouped.get(key);
    grouped.set(key, { ...x, count: x.count + (old?.count ?? 0) });
  }
  return [...grouped.values()].sort(
    (a, b) =>
      compare(a.reason, b.reason) ||
      compare(a.entityKind, b.entityKind) ||
      compare(a.entityId ?? '', b.entityId ?? ''),
  );
}
function sortReasons(
  reasons: readonly ContextSelectionReason[],
): ContextSelectionReason[] {
  return sortByOrder(reasons, REASON_ORDER);
}
function compareRelationEntries(a: RelationEntry, b: RelationEntry): number {
  return (
    a.priority - b.priority ||
    compare(a.kind, b.kind) ||
    compare(relationEntryId(a), relationEntryId(b))
  );
}
function relationEntryId(entry: RelationEntry): string {
  return entry.value.id;
}
function sortByOrder<T extends string>(
  values: readonly T[],
  order: readonly T[],
): T[] {
  return [...new Set(values)].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
}
function folderDistance(path: string, folder: string): number {
  if (path === folder) return 0;
  if (folder && !path.startsWith(`${folder}/`)) return -1;
  const rest = folder ? path.slice(folder.length + 1) : path;
  return Math.max(0, rest.split('/').length - 1);
}
function descendantFolderDistance(path: string, folder: string): number {
  if (path === folder) return 0;
  if (folder && !path.startsWith(`${folder}/`)) return -1;
  const rest = folder ? path.slice(folder.length + 1) : path;
  return rest.split('/').length;
}
function pathFor(input: BuildContextPackageInput, id: string): string {
  return input.knowledge.files.find((x) => x.fileId === id)?.relativePath ?? id;
}
function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
