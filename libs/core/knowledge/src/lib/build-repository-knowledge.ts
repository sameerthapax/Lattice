import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  ModuleDependency,
  ResolvedRepositoryAnalysis,
} from '@lattice/core-analyzer';
import type { RepositoryScan } from '@lattice/core-indexer';
import type { RepositoryAnalysis, SourceSymbol } from '@lattice/core-parser';

import { KnowledgeBuilderInputError } from './errors';
import type {
  FileKnowledgeNode,
  FolderKnowledgeNode,
  KnowledgeRelation,
  KnowledgeRelationKind,
  KnowledgeRelationMetadata,
  ProjectDependency,
  ProjectKnowledgeNode,
  RepositoryKnowledge,
  SymbolKnowledgeNode,
  WorkspaceProjectDefinition,
} from './models';

const NAMESPACE = 'knowledge:v1';

export interface BuildRepositoryKnowledgeOptions {
  readonly scan: RepositoryScan;
  readonly analysis: RepositoryAnalysis;
  readonly resolution: ResolvedRepositoryAnalysis;
  readonly projects?: readonly WorkspaceProjectDefinition[];
}

interface NormalizedProject extends WorkspaceProjectDefinition {
  readonly rootRelativePath: string;
  readonly sourceRootRelativePath?: string;
  readonly entryPoints: readonly {
    readonly exportName?: string;
    readonly relativePath: string;
  }[];
  readonly id: string;
}

export function buildRepositoryKnowledge(
  options: BuildRepositoryKnowledgeOptions,
): RepositoryKnowledge {
  const rootPath = normalizeRoot(options.scan.rootPath);
  const repositoryId = stableId('repository', rootPath);
  const scannedById = new Map(
    options.scan.files.map((file) => [file.id, file]),
  );
  validatePriorStages(options, scannedById);
  const projects = normalizeProjects(
    options.projects ?? [],
    repositoryId,
    scannedById,
  );
  const membershipProjects = [...projects].sort(
    (a, b) =>
      b.rootRelativePath.length - a.rootRelativePath.length ||
      compareText(a.rootRelativePath, b.rootRelativePath),
  );
  const projectForPath = (
    relativePath: string,
  ): NormalizedProject | undefined =>
    membershipProjects.find((project) =>
      isWithin(relativePath, project.rootRelativePath),
    );

  const fileNodeIdByFileId = new Map<string, string>();
  for (const file of options.scan.files)
    fileNodeIdByFileId.set(file.id, stableId('file', file.id));
  const analysisById = new Map(
    options.analysis.files.map((file) => [file.fileId, file]),
  );
  const failureIds = new Set(
    options.analysis.failures.map((failure) => failure.fileId),
  );
  const symbolById = new Map<string, SourceSymbol>();
  for (const file of options.analysis.files)
    for (const symbol of file.symbols) symbolById.set(symbol.id, symbol);
  const symbolNodeIdBySymbolId = new Map(
    [...symbolById.keys()].map((id) => [id, stableId('symbol', id)]),
  );

  const folderPaths = collectFolderPaths(
    options.scan.files.map((file) => normalizeRelative(file.relativePath)),
  );
  const folderIdByPath = new Map(
    folderPaths.map((folder) => [
      folder,
      stableId('folder', repositoryId, folder),
    ]),
  );
  const dependenciesBySource = groupBy(
    options.resolution.dependencies,
    (item) => item.sourceFileId,
  );
  const dependenciesByTarget = groupBy(
    options.resolution.dependencies,
    (item) => item.targetFileId,
  );
  const externalBySource = groupBy(
    options.resolution.externalDependencies,
    (item) => item.sourceFileId,
  );
  const bindingsByTarget = groupBy(
    options.resolution.symbolBindings,
    (item) => item.targetSymbolId ?? '',
  );
  const entryPointPaths = new Set(
    projects.flatMap((project) =>
      project.entryPoints.map((entry) => entry.relativePath),
    ),
  );

  const publicExportsByFile = new Map<
    string,
    {
      exportId: string;
      exportedName: string;
      symbolId: string;
      typeOnly: boolean;
    }[]
  >();
  for (const module of options.resolution.modules) {
    const exports = module.exports
      .filter(
        (item): item is typeof item & { targetSymbolId: string } =>
          item.targetSymbolId !== null &&
          item.status !== 'unresolved' &&
          item.status !== 'external',
      )
      .map((item) => ({
        exportId: item.exportId,
        exportedName: item.exportedName,
        symbolId: item.targetSymbolId,
        typeOnly: item.typeOnly,
      }))
      .filter((item) => symbolNodeIdBySymbolId.has(item.symbolId));
    publicExportsByFile.set(
      module.fileId,
      deduplicate(
        exports,
        (item) => `${item.exportedName}\0${item.symbolId}`,
      ).sort(comparePublicExport),
    );
  }

  const files: FileKnowledgeNode[] = [...options.scan.files]
    .sort((a, b) =>
      compareText(
        normalizeRelative(a.relativePath),
        normalizeRelative(b.relativePath),
      ),
    )
    .map((file) => {
      const relativePath = normalizeRelative(file.relativePath);
      const parsed = analysisById.get(file.id);
      const project = projectForPath(relativePath);
      const folderPath = dirname(relativePath);
      const outgoing = dependenciesBySource.get(file.id) ?? [];
      const incoming = dependenciesByTarget.get(file.id) ?? [];
      const publicExports = publicExportsByFile.get(file.id) ?? [];
      return {
        id: required(fileNodeIdByFileId, file.id),
        kind: 'file',
        name: basename(relativePath),
        qualifiedName: relativePath,
        fileId: file.id,
        relativePath,
        folderId:
          folderPath === null ? null : required(folderIdByPath, folderPath),
        projectId: project?.id ?? null,
        language: parsed?.language ?? file.language ?? null,
        contentHash: file.contentHash,
        status: parsed
          ? 'parsed'
          : failureIds.has(file.id)
            ? 'failed'
            : 'skipped',
        symbolIds: sortSymbolNodeIds(
          parsed?.symbols ?? [],
          symbolNodeIdBySymbolId,
        ),
        publicSymbolIds: deduplicate(
          publicExports,
          (item) => item.symbolId,
        ).map((item) => required(symbolNodeIdBySymbolId, item.symbolId)),
        importCount: parsed?.imports.length ?? 0,
        exportCount: parsed?.exports.length ?? 0,
        internalDependencyCount: outgoing.length,
        externalDependencyCount: (externalBySource.get(file.id) ?? []).length,
        incomingFileDependencyIds: sortFileNodeIds(
          incoming.map((item) => item.sourceFileId),
          fileNodeIdByFileId,
          scannedById,
        ),
        outgoingFileDependencyIds: sortFileNodeIds(
          outgoing.map((item) => item.targetFileId),
          fileNodeIdByFileId,
          scannedById,
        ),
        diagnosticCount: parsed?.diagnostics.length ?? 0,
        hasSyntaxErrors:
          parsed?.diagnostics.some(
            (item) => item.code === 'TREE_SITTER_SYNTAX_ERROR',
          ) ?? false,
        orphan:
          parsed !== undefined &&
          incoming.length === 0 &&
          outgoing.length === 0 &&
          !entryPointPaths.has(relativePath),
      };
    });
  const fileById = new Map(files.map((file) => [file.fileId, file]));

  const symbols: SymbolKnowledgeNode[] = options.analysis.files
    .flatMap((file) => file.symbols)
    .sort(compareSymbols(fileById))
    .map((symbol) => {
      const file = required(fileById, symbol.fileId);
      const publicExports = [
        ...(publicExportsByFile.get(symbol.fileId) ?? []),
      ].filter((item) => item.symbolId === symbol.id);
      const childSymbols = [...symbolById.values()].filter(
        (item) => item.parentSymbolId === symbol.id,
      );
      return {
        id: required(symbolNodeIdBySymbolId, symbol.id),
        kind: 'symbol',
        name: symbol.name,
        qualifiedName: `${file.relativePath}#${symbol.qualifiedName}`,
        symbolId: symbol.id,
        symbolKind: symbol.kind,
        fileId: symbol.fileId,
        fileNodeId: file.id,
        folderId: file.folderId,
        projectId: file.projectId,
        exported: publicExports.length > 0,
        defaultExport: publicExports.some(
          (item) => item.exportedName === 'default',
        ),
        typeOnly:
          publicExports.length > 0 &&
          publicExports.every((item) => item.typeOnly),
        async: symbol.async,
        parentSymbolId:
          symbol.parentSymbolId === null
            ? null
            : (symbolNodeIdBySymbolId.get(symbol.parentSymbolId) ?? null),
        childSymbolIds: sortSymbolNodeIds(childSymbols, symbolNodeIdBySymbolId),
        incomingBindingIds: (bindingsByTarget.get(symbol.id) ?? [])
          .map((item) => item.id)
          .sort(compareText),
        location: { ...symbol.location },
      };
    });

  const folders: FolderKnowledgeNode[] = folderPaths.map((relativePath) => {
    const parentPath = dirname(relativePath);
    const descendantFiles = files.filter((file) =>
      isWithin(file.relativePath, relativePath),
    );
    const project = projectForPath(relativePath);
    return {
      id: required(folderIdByPath, relativePath),
      kind: 'folder',
      name: basename(relativePath),
      qualifiedName: relativePath,
      relativePath,
      parentFolderId:
        parentPath === null ? null : required(folderIdByPath, parentPath),
      projectId: project?.id ?? null,
      childFolderIds: folderPaths
        .filter((candidate) => dirname(candidate) === relativePath)
        .map((item) => required(folderIdByPath, item)),
      fileIds: files
        .filter((file) => dirname(file.relativePath) === relativePath)
        .map((file) => file.id),
      descendantFileCount: descendantFiles.length,
      descendantSymbolCount: descendantFiles.reduce(
        (count, file) => count + file.symbolIds.length,
        0,
      ),
    };
  });

  const projectDependencies = buildProjectDependencies(
    options.resolution.dependencies,
    fileById,
    projects,
  );
  const projectNodes: ProjectKnowledgeNode[] = projects.map((project) => {
    const projectFiles = files.filter((file) => file.projectId === project.id);
    const projectSymbols = symbols.filter(
      (symbol) => symbol.projectId === project.id,
    );
    const projectPublicExports = project.entryPoints
      .flatMap(
        (entry) =>
          publicExportsByFile.get(
            required(
              [...scannedById.values()].find(
                (file) =>
                  normalizeRelative(file.relativePath) === entry.relativePath,
              ),
              entry.relativePath,
            ).id,
          ) ?? [],
      )
      .sort(comparePublicExport);
    const publicSymbolIds = deduplicate(
      projectPublicExports,
      (item) => item.symbolId,
    ).map((item) => required(symbolNodeIdBySymbolId, item.symbolId));
    return {
      id: project.id,
      kind: 'project',
      name: project.name,
      qualifiedName: project.name,
      projectKind: project.kind,
      rootRelativePath: project.rootRelativePath,
      sourceRootRelativePath: project.sourceRootRelativePath ?? null,
      folderIds: folders
        .filter((folder) => folder.projectId === project.id)
        .map((folder) => folder.id),
      fileIds: projectFiles.map((file) => file.id),
      symbolIds: projectSymbols.map((symbol) => symbol.id),
      incomingProjectDependencyIds: projectDependencies
        .filter((item) => item.targetProjectId === project.id)
        .map((item) => item.id)
        .sort(compareText),
      outgoingProjectDependencyIds: projectDependencies
        .filter((item) => item.sourceProjectId === project.id)
        .map((item) => item.id)
        .sort(compareText),
      publicSymbolIds,
    };
  });

  const relations = buildRelations(
    repositoryId,
    projectNodes,
    folders,
    files,
    symbols,
    options.resolution,
    projectDependencies,
    fileNodeIdByFileId,
    symbolNodeIdBySymbolId,
    publicExportsByFile,
  );
  validateGraph(repositoryId, projectNodes, folders, files, symbols, relations);
  return {
    repository: {
      id: repositoryId,
      kind: 'repository',
      name: basename(rootPath),
      qualifiedName: rootPath,
      rootPath,
      projectIds: projectNodes.map((item) => item.id),
      topLevelFolderIds: folders
        .filter((item) => item.parentFolderId === null)
        .map((item) => item.id),
      fileIds: files.map((item) => item.id),
    },
    projects: projectNodes,
    folders,
    files,
    symbols,
    relations,
    projectDependencies,
    summaries: {
      projectCount: projectNodes.length,
      folderCount: folders.length,
      fileCount: files.length,
      parsedFileCount: files.filter((item) => item.status === 'parsed').length,
      symbolCount: symbols.length,
      publicFileSymbolCount: files.reduce(
        (count, file) => count + file.publicSymbolIds.length,
        0,
      ),
      publicProjectSymbolCount: projectNodes.reduce(
        (count, project) => count + project.publicSymbolIds.length,
        0,
      ),
      internalFileDependencyCount: options.resolution.dependencies.length,
      crossProjectDependencyCount: projectDependencies.length,
      orphanFileCount: files.filter((item) => item.orphan).length,
      rootFileCount: files.filter((item) => item.folderId === null).length,
    },
  };
}

function validatePriorStages(
  options: BuildRepositoryKnowledgeOptions,
  scanned: ReadonlyMap<string, unknown>,
): void {
  for (const file of options.analysis.files)
    if (!scanned.has(file.fileId))
      throw new KnowledgeBuilderInputError(
        'ANALYSIS_FILE_NOT_SCANNED',
        `Analysis file is absent from scan: ${file.fileId}`,
      );
  for (const failure of options.analysis.failures)
    if (!scanned.has(failure.fileId))
      throw new KnowledgeBuilderInputError(
        'ANALYSIS_FILE_NOT_SCANNED',
        `Analysis failure file is absent from scan: ${failure.fileId}`,
      );
  for (const module of options.resolution.modules)
    if (!scanned.has(module.fileId))
      throw new KnowledgeBuilderInputError(
        'RESOLUTION_FILE_NOT_SCANNED',
        `Resolution file is absent from scan: ${module.fileId}`,
      );
  for (const dependency of options.resolution.dependencies)
    if (
      !scanned.has(dependency.sourceFileId) ||
      !scanned.has(dependency.targetFileId)
    )
      throw new KnowledgeBuilderInputError(
        'RESOLUTION_FILE_NOT_SCANNED',
        `Resolution dependency references a file absent from scan: ${dependency.id}`,
      );
}

function normalizeProjects(
  input: readonly WorkspaceProjectDefinition[],
  repositoryId: string,
  scanned: ReadonlyMap<string, { readonly relativePath: string }>,
): NormalizedProject[] {
  const result = input.map((project): NormalizedProject => {
    const root = normalizeProjectPath(
      project.rootRelativePath,
      'PROJECT_PATH_ESCAPES_REPOSITORY',
    );
    const sourceRoot =
      project.sourceRootRelativePath === undefined
        ? undefined
        : normalizeProjectPath(
            project.sourceRootRelativePath,
            'SOURCE_ROOT_OUTSIDE_PROJECT',
          );
    if (sourceRoot !== undefined && !isWithin(sourceRoot, root))
      throw new KnowledgeBuilderInputError(
        'SOURCE_ROOT_OUTSIDE_PROJECT',
        `Project source root is outside project root: ${project.name}`,
      );
    const entryPoints = (project.entryPoints ?? [])
      .map((entry) => {
        const relativePath = normalizeProjectPath(
          entry.relativePath,
          'ENTRY_POINT_OUTSIDE_PROJECT',
        );
        if (!isWithin(relativePath, root))
          throw new KnowledgeBuilderInputError(
            'ENTRY_POINT_OUTSIDE_PROJECT',
            `Project entry point is outside project root: ${project.name}`,
          );
        if (
          ![...scanned.values()].some(
            (file) => normalizeRelative(file.relativePath) === relativePath,
          )
        )
          throw new KnowledgeBuilderInputError(
            'ENTRY_POINT_NOT_SCANNED',
            `Project entry point is absent from scan: ${relativePath}`,
          );
        return {
          ...(entry.exportName === undefined
            ? {}
            : { exportName: entry.exportName }),
          relativePath,
        };
      })
      .sort(
        (a, b) =>
          compareText(a.relativePath, b.relativePath) ||
          compareText(a.exportName ?? '', b.exportName ?? ''),
      );
    return {
      ...project,
      rootRelativePath: root,
      ...(sourceRoot === undefined
        ? {}
        : { sourceRootRelativePath: sourceRoot }),
      entryPoints,
      id: stableId('project', repositoryId, project.name, root, project.kind),
    };
  });
  for (let index = 0; index < result.length; index += 1)
    for (let other = index + 1; other < result.length; other += 1) {
      const left = result[index];
      const right = result[other];
      if (!left || !right) continue;
      if (left.rootRelativePath === right.rootRelativePath)
        throw new KnowledgeBuilderInputError(
          'DUPLICATE_PROJECT_ROOT',
          `Duplicate project root: ${left.rootRelativePath}`,
        );
      if (
        left.name === right.name &&
        left.rootRelativePath !== right.rootRelativePath
      )
        throw new KnowledgeBuilderInputError(
          'DUPLICATE_PROJECT_NAME',
          `Duplicate project name has conflicting roots: ${left.name}`,
        );
    }
  return result.sort(
    (a, b) =>
      compareText(a.rootRelativePath, b.rootRelativePath) ||
      compareText(a.name, b.name),
  );
}

function buildProjectDependencies(
  dependencies: readonly ModuleDependency[],
  files: ReadonlyMap<string, FileKnowledgeNode>,
  projects: readonly NormalizedProject[],
): ProjectDependency[] {
  const groups = new Map<string, ModuleDependency[]>();
  for (const dependency of dependencies) {
    const source = files.get(dependency.sourceFileId)?.projectId;
    const target = files.get(dependency.targetFileId)?.projectId;
    if (
      source === null ||
      source === undefined ||
      target === null ||
      target === undefined ||
      source === target
    )
      continue;
    const key = `${source}\0${target}`;
    groups.set(key, [...(groups.get(key) ?? []), dependency]);
  }
  const projectOrder = new Map(
    projects.map((project, index) => [project.id, index]),
  );
  return [...groups.entries()]
    .map(([key, edges]) => {
      const [sourceProjectId = '', targetProjectId = ''] = key.split('\0');
      const ids = [...new Set(edges.map((edge) => edge.id))].sort(compareText);
      return {
        id: stableId(
          'project-dependency',
          sourceProjectId,
          targetProjectId,
          ...ids,
        ),
        sourceProjectId,
        targetProjectId,
        fileDependencyIds: ids,
        dependencyCount: ids.length,
        typeOnlyDependencyCount: edges.filter((edge) => edge.typeOnly).length,
      };
    })
    .sort(
      (a, b) =>
        (projectOrder.get(a.sourceProjectId) ?? 0) -
          (projectOrder.get(b.sourceProjectId) ?? 0) ||
        (projectOrder.get(a.targetProjectId) ?? 0) -
          (projectOrder.get(b.targetProjectId) ?? 0),
    );
}

function buildRelations(
  repositoryId: string,
  projects: readonly ProjectKnowledgeNode[],
  folders: readonly FolderKnowledgeNode[],
  files: readonly FileKnowledgeNode[],
  symbols: readonly SymbolKnowledgeNode[],
  resolution: ResolvedRepositoryAnalysis,
  projectDependencies: readonly ProjectDependency[],
  fileNodes: ReadonlyMap<string, string>,
  symbolNodes: ReadonlyMap<string, string>,
  publicExports: ReadonlyMap<
    string,
    readonly {
      exportId: string;
      exportedName: string;
      symbolId: string;
      typeOnly: boolean;
    }[]
  >,
): KnowledgeRelation[] {
  const relations: KnowledgeRelation[] = [];
  const add = (
    kind: KnowledgeRelationKind,
    sourceNodeId: string,
    targetNodeId: string,
    sourceEntityId: string | null = null,
    metadata: KnowledgeRelationMetadata | null = null,
  ): void => {
    relations.push({
      id: stableId(
        'relation',
        kind,
        sourceNodeId,
        targetNodeId,
        sourceEntityId ?? '',
        metadataIdentity(metadata),
      ),
      kind,
      sourceNodeId,
      targetNodeId,
      sourceEntityId,
      metadata,
    });
  };
  for (const project of projects) add('contains', repositoryId, project.id);
  for (const project of projects) {
    for (const folder of folders)
      if (folder.projectId === project.id)
        add('contains', project.id, folder.id);
    for (const file of files)
      if (file.projectId === project.id) add('contains', project.id, file.id);
    for (const symbol of symbols)
      if (symbol.projectId === project.id)
        add('contains', project.id, symbol.id);
  }
  for (const folder of folders)
    add('contains', folder.parentFolderId ?? repositoryId, folder.id);
  for (const file of files) {
    add('contains', file.folderId ?? repositoryId, file.id);
    if (file.projectId !== null)
      add('belongs-to-project', file.id, file.projectId);
  }
  for (const symbol of symbols) {
    add('declares', symbol.fileNodeId, symbol.id);
    if (symbol.projectId !== null)
      add('belongs-to-project', symbol.id, symbol.projectId);
    if (symbol.parentSymbolId !== null)
      add('parent-symbol', symbol.parentSymbolId, symbol.id);
  }
  for (const dependency of resolution.dependencies)
    add(
      'depends-on',
      required(fileNodes, dependency.sourceFileId),
      required(fileNodes, dependency.targetFileId),
      dependency.id,
      {
        type: 'dependency',
        dependencyId: dependency.id,
        typeOnly: dependency.typeOnly,
      },
    );
  for (const binding of resolution.symbolBindings)
    if (
      binding.targetSymbolId !== null &&
      symbolNodes.has(binding.targetSymbolId)
    ) {
      const sourceImport = resolution.modules
        .flatMap((module) => module.imports)
        .find((item) => item.importId === binding.sourceEntityId);
      add(
        'binds-to',
        required(fileNodes, binding.sourceFileId),
        required(symbolNodes, binding.targetSymbolId),
        binding.sourceEntityId,
        {
          type: 'binding',
          bindingId: binding.id,
          bindingKind: binding.kind,
          importedName: binding.importedName,
          localName: binding.localName,
          typeOnly: sourceImport?.typeOnly ?? false,
        },
      );
    }
  for (const file of files)
    for (const item of publicExports.get(file.fileId) ?? [])
      add(
        'exports',
        file.id,
        required(symbolNodes, item.symbolId),
        item.exportId,
        {
          type: 'export',
          exportId: item.exportId,
          exportedName: item.exportedName,
          typeOnly: item.typeOnly,
        },
      );
  for (const dependency of projectDependencies)
    add(
      'project-depends-on',
      dependency.sourceProjectId,
      dependency.targetProjectId,
      dependency.id,
      {
        type: 'project-dependency',
        projectDependencyId: dependency.id,
        dependencyCount: dependency.dependencyCount,
        typeOnlyDependencyCount: dependency.typeOnlyDependencyCount,
      },
    );
  return deduplicate(relations, (item) => item.id).sort(
    (a, b) =>
      compareText(a.sourceNodeId, b.sourceNodeId) ||
      compareText(a.kind, b.kind) ||
      compareText(a.targetNodeId, b.targetNodeId) ||
      compareText(a.id, b.id),
  );
}

function validateGraph(
  repositoryId: string,
  projects: readonly ProjectKnowledgeNode[],
  folders: readonly FolderKnowledgeNode[],
  files: readonly FileKnowledgeNode[],
  symbols: readonly SymbolKnowledgeNode[],
  relations: readonly KnowledgeRelation[],
): void {
  const ids = new Set<string>([repositoryId]);
  for (const node of [...projects, ...folders, ...files, ...symbols]) {
    if (ids.has(node.id))
      throw new KnowledgeBuilderInputError(
        'DUPLICATE_NODE_ID',
        `Duplicate knowledge node ID: ${node.id}`,
      );
    ids.add(node.id);
  }
  for (const relation of relations)
    if (!ids.has(relation.sourceNodeId) || !ids.has(relation.targetNodeId))
      throw new KnowledgeBuilderInputError(
        'MISSING_RELATION_NODE',
        `Relation references a missing node: ${relation.id}`,
      );
}

function stableId(...parts: readonly string[]): string {
  return createHash('sha256')
    .update([NAMESPACE, ...parts].join('\0'), 'utf8')
    .digest('hex');
}
function normalizeRoot(value: string): string {
  return path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '');
}
function normalizeRelative(value: string): string {
  return path.posix
    .normalize(value.replaceAll('\\', '/').replace(/^\.\//, ''))
    .replace(/^\/$/, '');
}
function normalizeProjectPath(
  value: string,
  code:
    | 'PROJECT_PATH_ESCAPES_REPOSITORY'
    | 'SOURCE_ROOT_OUTSIDE_PROJECT'
    | 'ENTRY_POINT_OUTSIDE_PROJECT',
): string {
  const normalized = normalizeRelative(value);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  )
    throw new KnowledgeBuilderInputError(
      code,
      `Path escapes repository: ${value}`,
    );
  return normalized === '.' ? '' : normalized;
}
function isWithin(candidate: string, root: string): boolean {
  return root === '' || candidate === root || candidate.startsWith(`${root}/`);
}
function dirname(value: string): string | null {
  const result = path.posix.dirname(value);
  return result === '.' ? null : result;
}
function basename(value: string): string {
  return path.posix.basename(value);
}
function collectFolderPaths(files: readonly string[]): string[] {
  const result = new Set<string>();
  for (const file of files) {
    let folder = dirname(file);
    while (folder !== null) {
      result.add(folder);
      folder = dirname(folder);
    }
  }
  return [...result].sort(compareText);
}
function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}
function required<K, V>(map: ReadonlyMap<K, V>, key: K): V;
function required<T>(value: T | undefined, label: string): T;
function required<K, V>(
  value: ReadonlyMap<K, V> | V | undefined,
  key: K | string,
): V {
  const result = value instanceof Map ? value.get(key as K) : value;
  if (result === undefined)
    throw new Error(`Missing internal knowledge value: ${String(key)}`);
  return result as V;
}
function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items)
    result.set(key(item), [...(result.get(key(item)) ?? []), item]);
  return result;
}
function deduplicate<T>(items: readonly T[], key: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items)
    if (!result.has(key(item))) result.set(key(item), item);
  return [...result.values()];
}
function comparePublicExport(
  a: { exportedName: string; symbolId: string },
  b: { exportedName: string; symbolId: string },
): number {
  return (
    compareText(a.exportedName, b.exportedName) ||
    compareText(a.symbolId, b.symbolId)
  );
}
function compareSymbols(
  files: ReadonlyMap<string, FileKnowledgeNode>,
): (a: SourceSymbol, b: SourceSymbol) => number {
  return (a, b) =>
    compareText(
      required(files, a.fileId).relativePath,
      required(files, b.fileId).relativePath,
    ) ||
    a.location.startLine - b.location.startLine ||
    a.location.startColumn - b.location.startColumn ||
    compareText(a.kind, b.kind) ||
    compareText(a.qualifiedName, b.qualifiedName) ||
    compareText(a.id, b.id);
}
function sortSymbolNodeIds(
  symbols: readonly SourceSymbol[],
  ids: ReadonlyMap<string, string>,
): string[] {
  return [...symbols]
    .sort(
      (a, b) =>
        a.location.startLine - b.location.startLine ||
        a.location.startColumn - b.location.startColumn ||
        compareText(a.id, b.id),
    )
    .map((item) => required(ids, item.id));
}
function sortFileNodeIds(
  fileIds: readonly string[],
  nodes: ReadonlyMap<string, string>,
  scanned: ReadonlyMap<string, { relativePath: string }>,
): string[] {
  return [...new Set(fileIds)]
    .sort((a, b) =>
      compareText(
        required(scanned, a).relativePath,
        required(scanned, b).relativePath,
      ),
    )
    .map((id) => required(nodes, id));
}
function metadataIdentity(metadata: KnowledgeRelationMetadata | null): string {
  if (metadata === null) return '';
  switch (metadata.type) {
    case 'dependency':
      return `${metadata.dependencyId}\0${metadata.typeOnly}`;
    case 'export':
      return `${metadata.exportId}\0${metadata.exportedName}\0${metadata.typeOnly}`;
    case 'binding':
      return `${metadata.bindingId}\0${metadata.bindingKind}\0${metadata.importedName ?? ''}\0${metadata.localName ?? ''}\0${metadata.typeOnly}`;
    case 'project-dependency':
      return `${metadata.projectDependencyId}\0${metadata.dependencyCount}\0${metadata.typeOnlyDependencyCount}`;
  }
}
