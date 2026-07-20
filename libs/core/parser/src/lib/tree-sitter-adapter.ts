import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScriptLanguages from 'tree-sitter-typescript';

import { ParserInitializationError } from './errors';
import type { ParseableLanguage } from './models';

export interface ParsedSyntaxTree {
  readonly rootNode: Parser.SyntaxNode;
}

export interface SyntaxParserRegistry {
  parse(language: ParseableLanguage, content: string): ParsedSyntaxTree;
}

export class TreeSitterParserRegistry implements SyntaxParserRegistry {
  private readonly parsers: ReadonlyMap<ParseableLanguage, Parser>;

  public constructor() {
    try {
      const javaScriptParser = createParser(JavaScript);
      const typeScriptParser = createParser(TypeScriptLanguages.typescript);
      const tsxParser = createParser(TypeScriptLanguages.tsx);
      this.parsers = new Map([
        ['JavaScript', javaScriptParser],
        ['JSX', javaScriptParser],
        ['TypeScript', typeScriptParser],
        ['TSX', tsxParser],
      ]);
    } catch (error: unknown) {
      throw new ParserInitializationError(
        'Could not initialize the JavaScript and TypeScript parsers.',
        { cause: error },
      );
    }
  }

  public parse(language: ParseableLanguage, content: string): ParsedSyntaxTree {
    const parser = this.parsers.get(language);
    if (parser === undefined) {
      throw new ParserInitializationError(
        `No parser was initialized for ${language}.`,
      );
    }
    return parser.parse(content);
  }
}

function createParser(language: unknown): Parser {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
