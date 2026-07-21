import type Parser from 'tree-sitter';

import type {
  ParseDiagnostic,
  ParseableLanguage,
  ParsedSourceFile,
  SourceExport,
  SourceExportKind,
  SourceImport,
  SourceImportKind,
  SourceLocation,
  SourceSymbol,
  SourceSymbolKind,
} from './models';

interface ExtractSourceFileOptions {
  readonly fileId: string;
  readonly relativePath: string;
  readonly language: ParseableLanguage;
  readonly contentHash: string;
  readonly rootNode: Parser.SyntaxNode;
  readonly hashText: (content: string) => string;
}

interface SymbolDraft {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SourceSymbolKind;
  readonly fileId: string;
  readonly parentSymbolId: string | null;
  exported: boolean;
  readonly async: boolean;
  readonly location: SourceLocation;
}

interface ExtractionContext {
  readonly fileId: string;
  readonly hashText: (content: string) => string;
  readonly symbols: SymbolDraft[];
  readonly diagnostics: ParseDiagnostic[];
  readonly locallyExportedNames: ReadonlySet<string>;
}

const DECLARATION_KINDS: Readonly<Record<string, SourceSymbolKind>> = {
  class_declaration: 'class',
  enum_declaration: 'enum',
  function_declaration: 'function',
  interface_declaration: 'interface',
  type_alias_declaration: 'type-alias',
};

export function extractSourceFile(
  options: ExtractSourceFileOptions,
): ParsedSourceFile {
  const context: ExtractionContext = {
    fileId: options.fileId,
    hashText: options.hashText,
    symbols: [],
    diagnostics: collectSyntaxDiagnostics(options.rootNode),
    locallyExportedNames: collectLocallyExportedNames(options.rootNode),
  };

  for (const node of options.rootNode.namedChildren) {
    const declaration =
      node.type === 'export_statement'
        ? node.childForFieldName('declaration')
        : node;
    if (declaration !== null) {
      extractTopLevelDeclaration(
        declaration,
        node.type === 'export_statement',
        context,
      );
    }
  }

  const imports = options.rootNode.namedChildren.flatMap((node) =>
    node.type === 'import_statement' ? extractImports(node, context) : [],
  );
  const exports = options.rootNode.namedChildren.flatMap((node) =>
    node.type === 'export_statement' ? extractExports(node, context) : [],
  );

  return {
    fileId: options.fileId,
    relativePath: options.relativePath,
    language: options.language,
    contentHash: options.contentHash,
    symbols: context.symbols.map(toSourceSymbol).sort(compareSymbols),
    imports: imports.sort(compareImports),
    exports: exports.sort(compareExports),
    diagnostics: context.diagnostics.sort(compareDiagnostics),
  };
}

function extractTopLevelDeclaration(
  node: Parser.SyntaxNode,
  exported: boolean,
  context: ExtractionContext,
): void {
  const kind = DECLARATION_KINDS[node.type];
  if (kind !== undefined) {
    const symbol = createNamedSymbol(node, kind, null, null, exported, context);
    if (symbol !== null && kind === 'class') {
      extractClassMembers(node, symbol, context);
    }
    return;
  }

  if (
    node.type !== 'lexical_declaration' &&
    node.type !== 'variable_declaration'
  ) {
    return;
  }

  for (const declarator of node.namedChildren.filter(
    (child) => child.type === 'variable_declarator',
  )) {
    const nameNode = declarator.childForFieldName('name');
    const valueNode = declarator.childForFieldName('value');
    if (nameNode === null || !isSimpleName(nameNode)) {
      addMissingNameDiagnostic(declarator, context);
      continue;
    }

    const variableExported =
      exported || context.locallyExportedNames.has(nameNode.text);
    const symbolKind = getVariableSymbolKind(valueNode);
    const shouldExtractVariable = variableExported || symbolKind === 'function';
    let variableSymbol: SymbolDraft | null = null;
    if (shouldExtractVariable) {
      variableSymbol = addSymbol(
        nameNode.text,
        nameNode.text,
        symbolKind,
        declarator,
        null,
        variableExported,
        valueNode !== null && hasToken(valueNode, 'async'),
        context,
      );
    }

    if (valueNode?.type === 'object') {
      extractObjectMethods(
        valueNode,
        nameNode.text,
        variableSymbol?.id ?? null,
        variableExported,
        context,
      );
    }
  }
}

function getVariableSymbolKind(
  initializer: Parser.SyntaxNode | null,
): 'function' | 'variable' {
  return initializer?.type === 'arrow_function' ||
    initializer?.type === 'function_expression' ||
    initializer?.type === 'generator_function'
    ? 'function'
    : 'variable';
}

function extractClassMembers(
  classNode: Parser.SyntaxNode,
  classSymbol: SymbolDraft,
  context: ExtractionContext,
): void {
  const body = classNode.childForFieldName('body');
  if (body === null) {
    return;
  }
  for (const member of body.namedChildren) {
    if (member.type !== 'method_definition') {
      continue;
    }
    const nameNode = member.childForFieldName('name');
    if (nameNode === null || !isSimpleName(nameNode)) {
      addMissingNameDiagnostic(member, context);
      continue;
    }
    const isConstructor = nameNode.text === 'constructor';
    addSymbol(
      nameNode.text,
      `${classSymbol.qualifiedName}.${nameNode.text}`,
      isConstructor ? 'constructor' : 'method',
      member,
      classSymbol.id,
      classSymbol.exported,
      hasToken(member, 'async'),
      context,
    );
  }
}

function extractObjectMethods(
  objectNode: Parser.SyntaxNode,
  objectName: string,
  parentSymbolId: string | null,
  exported: boolean,
  context: ExtractionContext,
): void {
  for (const member of objectNode.namedChildren) {
    const nameNode = member.childForFieldName(
      member.type === 'pair' ? 'key' : 'name',
    );
    const valueNode = member.childForFieldName('value');
    const isFunctionPair =
      member.type === 'pair' &&
      (valueNode?.type === 'function_expression' ||
        valueNode?.type === 'arrow_function');
    if (
      (member.type !== 'method_definition' && !isFunctionPair) ||
      nameNode === null ||
      !isSimpleName(nameNode)
    ) {
      continue;
    }
    addSymbol(
      nameNode.text,
      `${objectName}.${nameNode.text}`,
      'method',
      member,
      parentSymbolId,
      exported,
      hasToken(member, 'async') ||
        (valueNode !== null && hasToken(valueNode, 'async')),
      context,
    );
  }
}

function createNamedSymbol(
  node: Parser.SyntaxNode,
  kind: SourceSymbolKind,
  qualifiedPrefix: string | null,
  parentSymbolId: string | null,
  exported: boolean,
  context: ExtractionContext,
): SymbolDraft | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode === null || !isSimpleName(nameNode)) {
    addMissingNameDiagnostic(node, context);
    return null;
  }
  const qualifiedName = qualifiedPrefix
    ? `${qualifiedPrefix}.${nameNode.text}`
    : nameNode.text;
  return addSymbol(
    nameNode.text,
    qualifiedName,
    kind,
    node,
    parentSymbolId,
    exported,
    hasToken(node, 'async'),
    context,
  );
}

function addSymbol(
  name: string,
  qualifiedName: string,
  kind: SourceSymbolKind,
  node: Parser.SyntaxNode,
  parentSymbolId: string | null,
  exported: boolean,
  async: boolean,
  context: ExtractionContext,
): SymbolDraft {
  const location = toLocation(node);
  const symbol: SymbolDraft = {
    id: context.hashText(
      [
        'symbol',
        context.fileId,
        kind,
        qualifiedName,
        location.startLine,
        location.startColumn,
      ].join(':'),
    ),
    name,
    qualifiedName,
    kind,
    fileId: context.fileId,
    parentSymbolId,
    exported,
    async,
    location,
  };
  context.symbols.push(symbol);
  return symbol;
}

function extractImports(
  node: Parser.SyntaxNode,
  context: ExtractionContext,
): SourceImport[] {
  const sourceNode = node.childForFieldName('source');
  if (sourceNode === null) {
    return [];
  }
  const source = unquote(sourceNode.text);
  const clause = node.namedChildren.find(
    (child) => child.type === 'import_clause',
  );
  const statementTypeOnly = hasToken(node, 'type');
  if (clause === undefined) {
    return [
      createImport(node, source, 'side-effect', null, null, false, context),
    ];
  }

  const imports: SourceImport[] = [];
  for (const child of clause.namedChildren) {
    if (child.type === 'identifier') {
      imports.push(
        createImport(
          child,
          source,
          'default',
          'default',
          child.text,
          statementTypeOnly,
          context,
        ),
      );
    } else if (child.type === 'namespace_import') {
      const localName = child.namedChildren.at(-1)?.text ?? null;
      imports.push(
        createImport(
          child,
          source,
          'namespace',
          '*',
          localName,
          statementTypeOnly,
          context,
        ),
      );
    } else if (child.type === 'named_imports') {
      for (const specifier of child.namedChildren.filter(
        (candidate) => candidate.type === 'import_specifier',
      )) {
        const importedName = specifier.childForFieldName('name')?.text ?? null;
        const localName =
          specifier.childForFieldName('alias')?.text ?? importedName;
        imports.push(
          createImport(
            specifier,
            source,
            'named',
            importedName,
            localName,
            statementTypeOnly || hasToken(specifier, 'type'),
            context,
          ),
        );
      }
    }
  }
  return imports;
}

function createImport(
  node: Parser.SyntaxNode,
  source: string,
  kind: SourceImportKind,
  importedName: string | null,
  localName: string | null,
  typeOnly: boolean,
  context: ExtractionContext,
): SourceImport {
  const location = toLocation(node);
  return {
    id: context.hashText(
      [
        'import',
        context.fileId,
        location.startLine,
        location.startColumn,
        source,
        kind,
        importedName ?? '',
        localName ?? '',
        typeOnly,
      ].join(':'),
    ),
    fileId: context.fileId,
    source,
    kind,
    importedName,
    localName,
    typeOnly,
    location,
  };
}

function extractExports(
  node: Parser.SyntaxNode,
  context: ExtractionContext,
): SourceExport[] {
  const sourceNode = node.childForFieldName('source');
  const source = sourceNode === null ? null : unquote(sourceNode.text);
  const declaration = node.childForFieldName('declaration');
  const isDefault = hasToken(node, 'default');
  const statementTypeOnly = hasToken(node, 'type');

  if (declaration !== null) {
    const declarationSymbols = context.symbols.filter((symbol) =>
      containsLocation(toLocation(declaration), symbol.location),
    );
    if (declarationSymbols.length === 0) {
      return [
        createExport(
          node,
          isDefault ? 'default' : 'named',
          isDefault
            ? 'default'
            : (declaration.childForFieldName('name')?.text ?? 'unknown'),
          declaration.childForFieldName('name')?.text ?? null,
          null,
          null,
          statementTypeOnly,
          context,
        ),
      ];
    }
    return declarationSymbols
      .filter((symbol) => symbol.parentSymbolId === null)
      .map((symbol) => {
        markSymbolExported(symbol, context);
        return createExport(
          declaration,
          isDefault ? 'default' : 'named',
          isDefault ? 'default' : symbol.name,
          symbol.name,
          null,
          symbol.id,
          statementTypeOnly ||
            symbol.kind === 'interface' ||
            symbol.kind === 'type-alias',
          context,
        );
      });
  }

  const clause = node.namedChildren.find(
    (child) => child.type === 'export_clause',
  );
  if (clause !== undefined) {
    return clause.namedChildren
      .filter((child) => child.type === 'export_specifier')
      .map((specifier) => {
        const localName = specifier.childForFieldName('name')?.text ?? null;
        const exportedName =
          specifier.childForFieldName('alias')?.text ?? localName ?? 'unknown';
        const symbol =
          source === null && localName !== null
            ? context.symbols.find(
                (candidate) =>
                  candidate.parentSymbolId === null &&
                  candidate.name === localName,
              )
            : undefined;
        if (symbol !== undefined) {
          markSymbolExported(symbol, context);
        }
        return createExport(
          specifier,
          source === null ? 'named' : 're-export',
          exportedName,
          localName,
          source,
          symbol?.id ?? null,
          statementTypeOnly || hasToken(specifier, 'type'),
          context,
        );
      });
  }

  if (source !== null && hasToken(node, '*')) {
    return [
      createExport(
        node,
        'export-all',
        '*',
        null,
        source,
        null,
        statementTypeOnly,
        context,
      ),
    ];
  }

  const expression = node.namedChildren.find((child) => child !== sourceNode);
  const localName = expression?.type === 'identifier' ? expression.text : null;
  const symbol =
    localName === null
      ? undefined
      : context.symbols.find(
          (candidate) =>
            candidate.parentSymbolId === null && candidate.name === localName,
        );
  if (symbol !== undefined) {
    markSymbolExported(symbol, context);
  }
  return [
    createExport(
      node,
      'default',
      'default',
      localName,
      null,
      symbol?.id ?? null,
      false,
      context,
    ),
  ];
}

function collectLocallyExportedNames(
  rootNode: Parser.SyntaxNode,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of rootNode.namedChildren) {
    if (
      statement.type !== 'export_statement' ||
      statement.childForFieldName('source') !== null
    ) {
      continue;
    }
    const clause = statement.namedChildren.find(
      (child) => child.type === 'export_clause',
    );
    if (clause === undefined) {
      continue;
    }
    for (const specifier of clause.namedChildren) {
      const name = specifier.childForFieldName('name')?.text;
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
}

function markSymbolExported(
  symbol: SymbolDraft,
  context: ExtractionContext,
): void {
  symbol.exported = true;
  for (const child of context.symbols) {
    if (child.parentSymbolId === symbol.id) {
      child.exported = true;
    }
  }
}

function createExport(
  node: Parser.SyntaxNode,
  kind: SourceExportKind,
  exportedName: string,
  localName: string | null,
  source: string | null,
  symbolId: string | null,
  typeOnly: boolean,
  context: ExtractionContext,
): SourceExport {
  const location = toLocation(node);
  return {
    id: context.hashText(
      [
        'export',
        context.fileId,
        location.startLine,
        location.startColumn,
        kind,
        exportedName,
        localName ?? '',
        source ?? '',
        typeOnly,
      ].join(':'),
    ),
    fileId: context.fileId,
    kind,
    exportedName,
    localName,
    source,
    symbolId,
    typeOnly,
    location,
  };
}

function collectSyntaxDiagnostics(
  rootNode: Parser.SyntaxNode,
): ParseDiagnostic[] {
  if (!rootNode.hasError) {
    return [];
  }
  const diagnostics: ParseDiagnostic[] = [];
  visit(rootNode, (node) => {
    if (node.isError || node.isMissing) {
      diagnostics.push({
        severity: 'error',
        code: 'TREE_SITTER_SYNTAX_ERROR',
        message: node.isMissing
          ? `Tree-sitter expected a ${node.type} node.`
          : 'Tree-sitter encountered invalid syntax.',
        location: toLocation(node),
      });
    }
  });
  return diagnostics;
}

function visit(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode) => void,
): void {
  callback(node);
  for (const child of node.namedChildren) {
    visit(child, callback);
  }
}

function addMissingNameDiagnostic(
  node: Parser.SyntaxNode,
  context: ExtractionContext,
): void {
  context.diagnostics.push({
    severity: 'warning',
    code: 'MISSING_SYMBOL_NAME',
    message: `Skipped an unnamed ${node.type}.`,
    location: toLocation(node),
  });
}

function hasToken(node: Parser.SyntaxNode, tokenType: string): boolean {
  for (let index = 0; index < node.childCount; index += 1) {
    if (node.child(index)?.type === tokenType) {
      return true;
    }
  }
  return false;
}

function isSimpleName(node: Parser.SyntaxNode): boolean {
  return (
    node.type === 'identifier' ||
    node.type === 'type_identifier' ||
    node.type === 'property_identifier' ||
    node.type === 'private_property_identifier' ||
    node.type === 'string' ||
    node.type === 'number'
  );
}

function unquote(value: string): string {
  return value.length >= 2 ? value.slice(1, -1) : value;
}

function toLocation(node: Parser.SyntaxNode): SourceLocation {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

function containsLocation(
  outer: SourceLocation,
  inner: SourceLocation,
): boolean {
  return (
    compareLocation(outer, inner) <= 0 &&
    compareLocation(inner, {
      ...outer,
      startLine: outer.endLine,
      startColumn: outer.endColumn,
    }) <= 0
  );
}

function toSourceSymbol(symbol: SymbolDraft): SourceSymbol {
  return { ...symbol };
}

function compareLocation(left: SourceLocation, right: SourceLocation): number {
  return (
    left.startLine - right.startLine || left.startColumn - right.startColumn
  );
}

function compareSymbols(left: SourceSymbol, right: SourceSymbol): number {
  return (
    compareLocation(left.location, right.location) ||
    left.kind.localeCompare(right.kind, 'en') ||
    left.name.localeCompare(right.name, 'en')
  );
}

function compareImports(left: SourceImport, right: SourceImport): number {
  return (
    compareLocation(left.location, right.location) ||
    left.source.localeCompare(right.source, 'en') ||
    left.kind.localeCompare(right.kind, 'en') ||
    (left.importedName ?? '').localeCompare(right.importedName ?? '', 'en') ||
    (left.localName ?? '').localeCompare(right.localName ?? '', 'en')
  );
}

function compareExports(left: SourceExport, right: SourceExport): number {
  return (
    compareLocation(left.location, right.location) ||
    left.kind.localeCompare(right.kind, 'en') ||
    left.exportedName.localeCompare(right.exportedName, 'en') ||
    (left.localName ?? '').localeCompare(right.localName ?? '', 'en') ||
    (left.source ?? '').localeCompare(right.source ?? '', 'en')
  );
}

function compareDiagnostics(
  left: ParseDiagnostic,
  right: ParseDiagnostic,
): number {
  if (left.location === null || right.location === null) {
    return left.location === right.location
      ? left.code.localeCompare(right.code, 'en')
      : left.location === null
        ? 1
        : -1;
  }
  return (
    compareLocation(left.location, right.location) ||
    left.code.localeCompare(right.code, 'en')
  );
}
