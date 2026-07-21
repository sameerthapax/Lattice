import { createHash } from 'node:crypto';
import path from 'node:path';

import type { ParsedSourceFile, SourceExport } from '@lattice/core-parser';

import { ResolverInputError } from './errors';
import type {
  ExternalModuleDependency,
  ModuleCycle,
  ModuleDependency,
  ModuleDependencyKind,
  ModuleSourceKind,
  ResolveRepositoryAnalysisOptions,
  ResolvedExport,
  ResolvedImport,
  ResolvedModule,
  ResolvedRepositoryAnalysis,
  SymbolBinding,
  SymbolBindingKind,
  UnresolvedDependency,
  UnresolvedDependencyReason,
  WorkspaceModuleAlias,
} from './models';

interface ModuleTarget {
  readonly kind: ModuleSourceKind;
  readonly file: ParsedSourceFile | null;
  readonly reason: UnresolvedDependencyReason | null;
}

interface EffectiveExport {
  readonly immediateExport: SourceExport;
  readonly originFileId: string;
  readonly originExportId: string;
  readonly symbolId: string | null;
}

interface EffectiveExportResult {
  readonly exports: ReadonlyMap<string, EffectiveExport>;
  readonly ambiguousNames: ReadonlySet<string>;
}

interface MutableModule {
  readonly file: ParsedSourceFile;
  readonly imports: ResolvedImport[];
  readonly exports: ResolvedExport[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export function resolveRepositoryAnalysis(
  options: ResolveRepositoryAnalysisOptions,
): ResolvedRepositoryAnalysis {
  const aliases = validateInputs(options);
  const scannedPaths = new Set(
    options.scan.files.map((file) => file.relativePath),
  );
  const parsedByPath = new Map(
    options.analysis.files.map((file) => [file.relativePath, file]),
  );
  const parsedById = new Map(
    options.analysis.files.map((file) => [file.fileId, file]),
  );
  const modules = new Map<string, MutableModule>(
    options.analysis.files.map((file) => [
      file.fileId,
      { file, imports: [], exports: [] },
    ]),
  );
  const dependencies = new Map<string, ModuleDependency>();
  const bindings = new Map<string, SymbolBinding>();
  const unresolved = new Map<string, UnresolvedDependency>();
  const external = new Map<
    string,
    {
      importIds: Set<string>;
      exportIds: Set<string>;
      sourceFileId: string;
      sourceSpecifier: string;
      typeOnly: boolean;
    }
  >();
  const targetCache = new Map<string, ModuleTarget>();

  const resolveTarget = (
    sourceFile: ParsedSourceFile,
    specifier: string,
  ): ModuleTarget => {
    const key = `${sourceFile.fileId}\0${specifier}`;
    const cached = targetCache.get(key);
    if (cached !== undefined) return cached;
    const result = resolveModuleTarget(
      sourceFile,
      specifier,
      aliases,
      scannedPaths,
      parsedByPath,
    );
    targetCache.set(key, result);
    return result;
  };

  const effectiveCache = new Map<string, EffectiveExportResult>();
  const effectiveStack = new Set<string>();
  const getEffectiveExports = (fileId: string): EffectiveExportResult => {
    const cached = effectiveCache.get(fileId);
    if (cached !== undefined) return cached;
    if (effectiveStack.has(fileId))
      return { exports: new Map(), ambiguousNames: new Set() };
    const file = parsedById.get(fileId);
    if (file === undefined)
      return { exports: new Map(), ambiguousNames: new Set() };
    effectiveStack.add(fileId);
    const result = buildEffectiveExports(
      file,
      resolveTarget,
      getEffectiveExports,
    );
    effectiveStack.delete(fileId);
    effectiveCache.set(fileId, result);
    return result;
  };

  for (const file of [...options.analysis.files].sort(compareFilePath)) {
    const module = modules.get(file.fileId);
    if (module === undefined)
      throw new ResolverInputError(
        'UNKNOWN_ANALYSIS_FILE',
        `Missing module for ${file.fileId}.`,
      );
    for (const sourceImport of file.imports) {
      const target = resolveTarget(file, sourceImport.source);
      if (target.kind === 'external') {
        addExternal(
          external,
          file.fileId,
          sourceImport.source,
          sourceImport.typeOnly,
          sourceImport.id,
          null,
        );
        module.imports.push(
          toResolvedImport(sourceImport, target, 'external', null),
        );
        continue;
      }
      if (target.file === null) {
        addUnresolved(
          unresolved,
          file,
          sourceImport.id,
          sourceImport.source,
          sourceImport.importedName,
          target.reason ?? 'MODULE_NOT_FOUND',
        );
        module.imports.push(
          toResolvedImport(sourceImport, target, 'unresolved', null),
        );
        continue;
      }
      addDependency(
        dependencies,
        file.fileId,
        target.file.fileId,
        sourceImport.source,
        sourceImport.kind === 'side-effect' ? 'side-effect-import' : 'import',
        sourceImport.typeOnly,
      );
      if (
        sourceImport.kind === 'namespace' ||
        sourceImport.kind === 'side-effect'
      ) {
        module.imports.push(
          toResolvedImport(sourceImport, target, 'resolved-module', null),
        );
        continue;
      }
      const name =
        sourceImport.kind === 'default' ? 'default' : sourceImport.importedName;
      const effective = getEffectiveExports(target.file.fileId);
      if (name === null || effective.ambiguousNames.has(name)) {
        addUnresolved(
          unresolved,
          file,
          sourceImport.id,
          sourceImport.source,
          name,
          name === null ? 'EXPORT_NOT_FOUND' : 'AMBIGUOUS_EXPORT',
        );
        module.imports.push(
          toResolvedImport(sourceImport, target, 'unresolved', null),
        );
        continue;
      }
      const matched = effective.exports.get(name);
      if (matched === undefined) {
        addUnresolved(
          unresolved,
          file,
          sourceImport.id,
          sourceImport.source,
          name,
          'EXPORT_NOT_FOUND',
        );
        module.imports.push(
          toResolvedImport(sourceImport, target, 'unresolved', null),
        );
        continue;
      }
      module.imports.push(
        toResolvedImport(sourceImport, target, 'resolved-symbol', matched),
      );
      addBinding(
        bindings,
        sourceImport.kind === 'default' ? 'default-import' : 'named-import',
        file.fileId,
        sourceImport.id,
        matched,
        name,
        sourceImport.localName,
      );
    }

    for (const sourceExport of file.exports) {
      if (sourceExport.source === null) {
        module.exports.push({
          exportId: sourceExport.id,
          sourceFileId: file.fileId,
          exportedName: sourceExport.exportedName,
          typeOnly: sourceExport.typeOnly,
          localSymbolId: sourceExport.symbolId,
          targetFileId: null,
          targetExportId: null,
          targetSymbolId: sourceExport.symbolId,
          status: 'local-symbol',
        });
        continue;
      }
      const target = resolveTarget(file, sourceExport.source);
      if (target.kind === 'external') {
        addExternal(
          external,
          file.fileId,
          sourceExport.source,
          sourceExport.typeOnly,
          null,
          sourceExport.id,
        );
        module.exports.push(
          toResolvedExport(sourceExport, target, 'external', null),
        );
        continue;
      }
      if (target.file === null) {
        addUnresolved(
          unresolved,
          file,
          sourceExport.id,
          sourceExport.source,
          sourceExport.kind === 'export-all'
            ? null
            : (sourceExport.localName ?? sourceExport.exportedName),
          target.reason ?? 'MODULE_NOT_FOUND',
        );
        module.exports.push(
          toResolvedExport(sourceExport, target, 'unresolved', null),
        );
        continue;
      }
      const dependencyKind =
        sourceExport.kind === 'export-all' ? 'export-all' : 're-export';
      addDependency(
        dependencies,
        file.fileId,
        target.file.fileId,
        sourceExport.source,
        dependencyKind,
        sourceExport.typeOnly,
      );
      if (sourceExport.kind === 'export-all') {
        module.exports.push(
          toResolvedExport(sourceExport, target, 'resolved-export-all', null),
        );
        const effective = getEffectiveExports(target.file.fileId);
        for (const [name, matched] of [...effective.exports].sort(
          ([left], [right]) => left.localeCompare(right, 'en'),
        )) {
          if (name !== 'default' && !effective.ambiguousNames.has(name))
            addBinding(
              bindings,
              'export-all',
              file.fileId,
              sourceExport.id,
              matched,
              name,
              name,
            );
        }
        continue;
      }
      const originalName = sourceExport.localName ?? sourceExport.exportedName;
      const effective = getEffectiveExports(target.file.fileId);
      const reason = effective.ambiguousNames.has(originalName)
        ? 'AMBIGUOUS_EXPORT'
        : 'EXPORT_NOT_FOUND';
      const matched = effective.exports.get(originalName);
      if (matched === undefined || effective.ambiguousNames.has(originalName)) {
        addUnresolved(
          unresolved,
          file,
          sourceExport.id,
          sourceExport.source,
          originalName,
          reason,
        );
        module.exports.push(
          toResolvedExport(sourceExport, target, 'unresolved', null),
        );
      } else {
        module.exports.push(
          toResolvedExport(sourceExport, target, 'resolved-re-export', matched),
        );
        addBinding(
          bindings,
          're-export',
          file.fileId,
          sourceExport.id,
          matched,
          originalName,
          sourceExport.exportedName,
        );
      }
    }
  }

  const dependencyList = [...dependencies.values()].sort((left, right) =>
    compareDependencies(left, right, parsedById),
  );
  const publicModules: ResolvedModule[] = [...modules.values()]
    .sort((left, right) => compareFilePath(left.file, right.file))
    .map((module) => ({
      fileId: module.file.fileId,
      relativePath: module.file.relativePath,
      language: module.file.language,
      imports: module.imports,
      exports: module.exports,
      incomingDependencyIds: dependencyList
        .filter((edge) => edge.targetFileId === module.file.fileId)
        .map((edge) => edge.id)
        .sort(),
      outgoingDependencyIds: dependencyList
        .filter((edge) => edge.sourceFileId === module.file.fileId)
        .map((edge) => edge.id)
        .sort(),
    }));

  return {
    rootPath: options.analysis.rootPath,
    scannedFileCount: options.analysis.scannedFileCount,
    parsedFileCount: options.analysis.parsedFileCount,
    modules: publicModules,
    dependencies: dependencyList,
    externalDependencies: [...external.values()]
      .map((item) => ({
        ...item,
        importIds: [...item.importIds].sort(),
        exportIds: [...item.exportIds].sort(),
      }))
      .sort(compareExternal),
    symbolBindings: [...bindings.values()].sort(compareBindings),
    unresolvedDependencies: [...unresolved.values()].sort(compareUnresolved),
    cycles: detectCycles(publicModules, dependencyList),
  };
}

function validateInputs(
  options: ResolveRepositoryAnalysisOptions,
): readonly WorkspaceModuleAlias[] {
  const fileIds = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const file of options.scan.files) {
    const previousPath = fileIds.get(file.id);
    if (previousPath !== undefined && previousPath !== file.relativePath)
      throw new ResolverInputError(
        'DUPLICATE_FILE_ID',
        `File ID ${file.id} has conflicting paths.`,
      );
    const previousId = paths.get(file.relativePath);
    if (previousId !== undefined && previousId !== file.id)
      throw new ResolverInputError(
        'DUPLICATE_FILE_PATH',
        `Path ${file.relativePath} has conflicting file IDs.`,
      );
    fileIds.set(file.id, file.relativePath);
    paths.set(file.relativePath, file.id);
  }
  const entityIds = new Set<string>();
  for (const file of options.analysis.files) {
    if (fileIds.get(file.fileId) !== file.relativePath)
      throw new ResolverInputError(
        'UNKNOWN_ANALYSIS_FILE',
        `Analysis file ${file.fileId} is absent from the scan.`,
      );
    for (const entity of [...file.symbols, ...file.imports, ...file.exports]) {
      if (entityIds.has(entity.id))
        throw new ResolverInputError(
          'DUPLICATE_ENTITY_ID',
          `Duplicate parser entity ID: ${entity.id}.`,
        );
      entityIds.add(entity.id);
    }
  }
  const aliases = [...(options.workspaceAliases ?? [])].sort((left, right) =>
    left.alias.localeCompare(right.alias, 'en'),
  );
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (
      !/^@?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(alias.alias) ||
      alias.targetRelativePaths.length === 0 ||
      seen.has(alias.alias) ||
      alias.targetRelativePaths.some(
        (target) => target.startsWith('/') || target.split('/').includes('..'),
      )
    ) {
      throw new ResolverInputError(
        'MALFORMED_WORKSPACE_ALIAS',
        `Malformed workspace alias: ${alias.alias}.`,
      );
    }
    seen.add(alias.alias);
  }
  return aliases;
}

function resolveModuleTarget(
  sourceFile: ParsedSourceFile,
  specifier: string,
  aliases: readonly WorkspaceModuleAlias[],
  scannedPaths: ReadonlySet<string>,
  parsedByPath: ReadonlyMap<string, ParsedSourceFile>,
): ModuleTarget {
  if (
    specifier.length === 0 ||
    specifier.includes('\\') ||
    specifier.startsWith('/') ||
    specifier.includes('\0')
  )
    return { kind: 'unsupported', file: null, reason: 'UNSUPPORTED_SPECIFIER' };
  const explicitExtension = path.posix.extname(specifier);
  if (explicitExtension === '.mjs' || explicitExtension === '.cjs')
    return {
      kind: specifier.startsWith('.') ? 'relative' : 'unsupported',
      file: null,
      reason: 'UNSUPPORTED_SPECIFIER',
    };
  let bases: string[];
  let kind: ModuleSourceKind;
  if (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
    kind = 'relative';
    const sourceDirectory = path.posix.dirname(sourceFile.relativePath);
    const normalized = path.posix.normalize(
      path.posix.join(sourceDirectory, specifier),
    );
    if (normalized === '..' || normalized.startsWith('../'))
      return { kind, file: null, reason: 'PATH_ESCAPES_REPOSITORY' };
    bases = [normalized];
  } else {
    const alias = aliases
      .filter(
        (candidate) =>
          specifier === candidate.alias ||
          specifier.startsWith(`${candidate.alias}/`),
      )
      .sort((left, right) => right.alias.length - left.alias.length)[0];
    if (alias === undefined) {
      const workspaceNamespaces = new Set(
        aliases
          .filter((item) => item.alias.startsWith('@'))
          .map((item) => item.alias.split('/')[0]),
      );
      const namespace = specifier.split('/')[0];
      return workspaceNamespaces.has(namespace)
        ? { kind: 'workspace', file: null, reason: 'WORKSPACE_ALIAS_NOT_FOUND' }
        : { kind: 'external', file: null, reason: null };
    }
    kind = 'workspace';
    const subpath =
      specifier === alias.alias ? '' : specifier.slice(alias.alias.length + 1);
    bases = alias.targetRelativePaths.map((target) =>
      subpath.length === 0
        ? target
        : path.posix.join(path.posix.dirname(target), subpath),
    );
  }
  let scannedCandidate = false;
  for (const base of bases) {
    for (const candidate of moduleCandidates(base)) {
      if (scannedPaths.has(candidate)) scannedCandidate = true;
      const parsed = parsedByPath.get(candidate);
      if (parsed !== undefined) return { kind, file: parsed, reason: null };
    }
  }
  return {
    kind,
    file: null,
    reason: scannedCandidate ? 'TARGET_NOT_PARSED' : 'MODULE_NOT_FOUND',
  };
}

function moduleCandidates(base: string): readonly string[] {
  const extension = path.posix.extname(base);
  if (extension === '.mjs' || extension === '.cjs') return [base];
  if (extension === '.js')
    return replaceExtension(base, ['.js', '.jsx', '.ts', '.tsx']);
  if (extension === '.jsx') return replaceExtension(base, ['.jsx', '.tsx']);
  if (
    SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])
  )
    return [base];
  if (extension !== '') return [base];
  return [
    base,
    ...SOURCE_EXTENSIONS.map((item) => `${base}${item}`),
    ...SOURCE_EXTENSIONS.map((item) => `${base}/index${item}`),
  ];
}

function replaceExtension(
  base: string,
  extensions: readonly string[],
): readonly string[] {
  const stem = base.slice(0, -path.posix.extname(base).length);
  return extensions.map((extension) => `${stem}${extension}`);
}

function buildEffectiveExports(
  file: ParsedSourceFile,
  resolveTarget: (file: ParsedSourceFile, source: string) => ModuleTarget,
  getEffective: (fileId: string) => EffectiveExportResult,
): EffectiveExportResult {
  const result = new Map<string, EffectiveExport>();
  const ambiguous = new Set<string>();
  const explicitNames = new Set(
    file.exports
      .filter((item) => item.kind !== 'export-all')
      .map((item) => item.exportedName),
  );
  for (const item of file.exports.filter(
    (candidate) => candidate.kind !== 'export-all',
  )) {
    if (item.source === null) {
      result.set(item.exportedName, {
        immediateExport: item,
        originFileId: file.fileId,
        originExportId: item.id,
        symbolId: item.symbolId,
      });
      continue;
    }
    const target = resolveTarget(file, item.source);
    if (target.file === null) continue;
    const targetResult = getEffective(target.file.fileId);
    const originalName = item.localName ?? item.exportedName;
    if (targetResult.ambiguousNames.has(originalName)) {
      ambiguous.add(item.exportedName);
      continue;
    }
    const matched = targetResult.exports.get(originalName);
    if (matched !== undefined)
      result.set(item.exportedName, {
        immediateExport: item,
        originFileId: matched.originFileId,
        originExportId: matched.originExportId,
        symbolId: matched.symbolId,
      });
  }
  for (const item of file.exports.filter(
    (candidate) => candidate.kind === 'export-all' && candidate.source !== null,
  )) {
    const target = resolveTarget(file, item.source ?? '');
    if (target.file === null) continue;
    const targetResult = getEffective(target.file.fileId);
    for (const name of targetResult.ambiguousNames)
      if (name !== 'default' && !explicitNames.has(name)) ambiguous.add(name);
    for (const [name, matched] of targetResult.exports) {
      if (name === 'default' || explicitNames.has(name)) continue;
      if (result.has(name)) {
        result.delete(name);
        ambiguous.add(name);
      } else if (!ambiguous.has(name))
        result.set(name, {
          immediateExport: item,
          originFileId: matched.originFileId,
          originExportId: matched.originExportId,
          symbolId: matched.symbolId,
        });
    }
  }
  return { exports: result, ambiguousNames: ambiguous };
}

function toResolvedImport(
  sourceImport: ParsedSourceFile['imports'][number],
  target: ModuleTarget,
  status: ResolvedImport['status'],
  matched: EffectiveExport | null,
): ResolvedImport {
  return {
    importId: sourceImport.id,
    sourceFileId: sourceImport.fileId,
    sourceSpecifier: sourceImport.source,
    sourceKind: target.kind,
    importKind: sourceImport.kind,
    typeOnly: sourceImport.typeOnly,
    status,
    targetFileId: target.file?.fileId ?? null,
    targetExportId: matched?.immediateExport.id ?? null,
    targetSymbolId: matched?.symbolId ?? null,
  };
}

function toResolvedExport(
  sourceExport: SourceExport,
  target: ModuleTarget,
  status: ResolvedExport['status'],
  matched: EffectiveExport | null,
): ResolvedExport {
  return {
    exportId: sourceExport.id,
    sourceFileId: sourceExport.fileId,
    exportedName: sourceExport.exportedName,
    typeOnly: sourceExport.typeOnly,
    localSymbolId: sourceExport.symbolId,
    targetFileId: target.file?.fileId ?? null,
    targetExportId: matched?.originExportId ?? null,
    targetSymbolId: matched?.symbolId ?? null,
    status,
  };
}

function addDependency(
  target: Map<string, ModuleDependency>,
  sourceFileId: string,
  targetFileId: string,
  sourceSpecifier: string,
  kind: ModuleDependencyKind,
  typeOnly: boolean,
): void {
  const id = hash([
    'dependency',
    sourceFileId,
    targetFileId,
    kind,
    sourceSpecifier,
    String(typeOnly),
  ]);
  target.set(id, {
    id,
    sourceFileId,
    targetFileId,
    sourceSpecifier,
    kind,
    typeOnly,
  });
}

function addBinding(
  target: Map<string, SymbolBinding>,
  kind: SymbolBindingKind,
  sourceFileId: string,
  sourceEntityId: string,
  matched: EffectiveExport,
  importedName: string | null,
  localName: string | null,
): void {
  const id = hash([
    'binding',
    sourceFileId,
    sourceEntityId,
    matched.originFileId,
    matched.originExportId,
    matched.symbolId ?? '',
    kind,
    importedName ?? '',
    localName ?? '',
  ]);
  target.set(id, {
    id,
    kind,
    sourceFileId,
    sourceEntityId,
    targetFileId: matched.originFileId,
    targetExportId: matched.originExportId,
    targetSymbolId: matched.symbolId,
    importedName,
    localName,
  });
}

function addUnresolved(
  target: Map<string, UnresolvedDependency>,
  file: ParsedSourceFile,
  entityId: string,
  specifier: string,
  importedName: string | null,
  reason: UnresolvedDependencyReason,
): void {
  const id = hash([
    'unresolved',
    file.fileId,
    entityId,
    specifier,
    importedName ?? '',
    reason,
  ]);
  target.set(id, {
    id,
    sourceFileId: file.fileId,
    sourceRelativePath: file.relativePath,
    sourceEntityId: entityId,
    sourceSpecifier: specifier,
    importedName,
    reason,
  });
}

function addExternal(
  target: Map<
    string,
    {
      importIds: Set<string>;
      exportIds: Set<string>;
      sourceFileId: string;
      sourceSpecifier: string;
      typeOnly: boolean;
    }
  >,
  sourceFileId: string,
  specifier: string,
  typeOnly: boolean,
  importId: string | null,
  exportId: string | null,
): void {
  const key = `${sourceFileId}\0${specifier}\0${String(typeOnly)}`;
  const item = target.get(key) ?? {
    sourceFileId,
    sourceSpecifier: specifier,
    typeOnly,
    importIds: new Set<string>(),
    exportIds: new Set<string>(),
  };
  if (importId !== null) item.importIds.add(importId);
  if (exportId !== null) item.exportIds.add(exportId);
  target.set(key, item);
}

function detectCycles(
  modules: readonly ResolvedModule[],
  dependencies: readonly ModuleDependency[],
): readonly ModuleCycle[] {
  const pathById = new Map(
    modules.map((module) => [module.fileId, module.relativePath]),
  );
  const adjacency = new Map(
    modules.map((module) => [module.fileId, new Set<string>()]),
  );
  for (const edge of dependencies)
    adjacency.get(edge.sourceFileId)?.add(edge.targetFileId);
  const canonical = new Map<string, readonly string[]>();
  const visit = (
    start: string,
    current: string,
    route: readonly string[],
    seen: ReadonlySet<string>,
  ): void => {
    for (const next of [...(adjacency.get(current) ?? [])].sort((left, right) =>
      (pathById.get(left) ?? left).localeCompare(
        pathById.get(right) ?? right,
        'en',
      ),
    )) {
      if (next === start) {
        const cycle = canonicalizeCycle(route, pathById);
        canonical.set(cycle.join('\0'), cycle);
      } else if (!seen.has(next))
        visit(start, next, [...route, next], new Set([...seen, next]));
    }
  };
  for (const module of modules)
    visit(
      module.fileId,
      module.fileId,
      [module.fileId],
      new Set([module.fileId]),
    );
  return [...canonical.values()]
    .map((fileIds) => {
      const relativePaths = fileIds.map((id) => pathById.get(id) ?? id);
      return { id: hash(['cycle', ...fileIds]), fileIds, relativePaths };
    })
    .sort((left, right) =>
      left.relativePaths
        .join('\0')
        .localeCompare(right.relativePaths.join('\0'), 'en'),
    );
}

function canonicalizeCycle(
  fileIds: readonly string[],
  pathById: ReadonlyMap<string, string>,
): readonly string[] {
  const variants: string[][] = [];
  for (const direction of [fileIds, [...fileIds].reverse()])
    for (let index = 0; index < direction.length; index += 1)
      variants.push([...direction.slice(index), ...direction.slice(0, index)]);
  return (
    variants.sort((left, right) =>
      left
        .map((id) => pathById.get(id) ?? id)
        .join('\0')
        .localeCompare(
          right.map((id) => pathById.get(id) ?? id).join('\0'),
          'en',
        ),
    )[0] ?? []
  );
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
}
function compareFilePath(
  left: ParsedSourceFile,
  right: ParsedSourceFile,
): number {
  return left.relativePath.localeCompare(right.relativePath, 'en');
}
function compareDependencies(
  left: ModuleDependency,
  right: ModuleDependency,
  files: ReadonlyMap<string, ParsedSourceFile>,
): number {
  return [
    files.get(left.sourceFileId)?.relativePath ?? left.sourceFileId,
    files.get(left.targetFileId)?.relativePath ?? left.targetFileId,
    left.kind,
    left.sourceSpecifier,
    String(left.typeOnly),
    left.id,
  ]
    .join('\0')
    .localeCompare(
      [
        files.get(right.sourceFileId)?.relativePath ?? right.sourceFileId,
        files.get(right.targetFileId)?.relativePath ?? right.targetFileId,
        right.kind,
        right.sourceSpecifier,
        String(right.typeOnly),
        right.id,
      ].join('\0'),
      'en',
    );
}
function compareBindings(left: SymbolBinding, right: SymbolBinding): number {
  return [
    left.sourceFileId,
    left.sourceEntityId,
    left.targetFileId,
    left.targetExportId ?? '',
    left.id,
  ]
    .join('\0')
    .localeCompare(
      [
        right.sourceFileId,
        right.sourceEntityId,
        right.targetFileId,
        right.targetExportId ?? '',
        right.id,
      ].join('\0'),
      'en',
    );
}
function compareUnresolved(
  left: UnresolvedDependency,
  right: UnresolvedDependency,
): number {
  return [left.sourceRelativePath, left.sourceEntityId, left.reason, left.id]
    .join('\0')
    .localeCompare(
      [
        right.sourceRelativePath,
        right.sourceEntityId,
        right.reason,
        right.id,
      ].join('\0'),
      'en',
    );
}
function compareExternal(
  left: ExternalModuleDependency,
  right: ExternalModuleDependency,
): number {
  return [left.sourceFileId, left.sourceSpecifier, String(left.typeOnly)]
    .join('\0')
    .localeCompare(
      [right.sourceFileId, right.sourceSpecifier, String(right.typeOnly)].join(
        '\0',
      ),
      'en',
    );
}
