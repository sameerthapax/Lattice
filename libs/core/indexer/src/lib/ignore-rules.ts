import type { EntryType } from '@lattice/filesystem';

const HARD_CODED_IGNORED_NAMES = new Set([
  '.DS_Store',
  '.cache',
  '.env',
  '.git',
  '.lattice',
  '.next',
  '.nx',
  'DS_Store',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

interface IgnoreRule {
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly matches: (relativePath: string) => boolean;
}

export class IgnoreRules {
  private constructor(private readonly rules: readonly IgnoreRule[]) {}

  public static fromFiles(
    gitIgnoreContents: string | null,
    latticeIgnoreContents: string | null,
  ): IgnoreRules {
    return new IgnoreRules([
      ...parseIgnoreFile(gitIgnoreContents),
      ...parseIgnoreFile(latticeIgnoreContents),
    ]);
  }

  public ignores(relativePath: string, type: EntryType): boolean {
    if (
      relativePath.split('/').some((part) => HARD_CODED_IGNORED_NAMES.has(part))
    ) {
      return true;
    }

    let ignored = false;
    for (const rule of this.rules) {
      if (
        (!rule.directoryOnly || type === 'directory') &&
        rule.matches(relativePath)
      ) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

function parseIgnoreFile(contents: string | null): IgnoreRule[] {
  if (contents === null) {
    return [];
  }

  const rules: IgnoreRule[] = [];
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const escapedPrefix = line.startsWith('\\!') || line.startsWith('\\#');
    const negated = !escapedPrefix && line.startsWith('!');
    let pattern = escapedPrefix
      ? line.slice(1)
      : negated
        ? line.slice(1)
        : line;
    const directoryOnly = pattern.endsWith('/');
    const rootAnchored = pattern.startsWith('/');
    pattern = pattern.replace(/^\//u, '').replace(/\/$/u, '');

    if (pattern === '') {
      continue;
    }

    const containsSlash = pattern.includes('/');
    const expression = globToRegularExpression(pattern);
    const regularExpression =
      containsSlash || rootAnchored
        ? new RegExp(`^${expression}$`, 'u')
        : new RegExp(`(?:^|/)${expression}$`, 'u');

    rules.push({
      negated,
      directoryOnly,
      matches: (relativePath: string): boolean =>
        regularExpression.test(relativePath),
    });
  }
  return rules;
}

function globToRegularExpression(pattern: string): string {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const nextCharacter = pattern[index + 1];

    if (character === '\\' && nextCharacter !== undefined) {
      expression += escapeRegularExpressionCharacter(nextCharacter);
      index += 1;
    } else if (character === '*' && nextCharacter === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else if (character === '[') {
      const closingIndex = pattern.indexOf(']', index + 1);
      if (closingIndex === -1) {
        expression += '\\[';
      } else {
        const characterClass = pattern.slice(index + 1, closingIndex);
        const normalizedClass = characterClass.startsWith('!')
          ? `^${characterClass.slice(1)}`
          : characterClass;
        expression += `[${normalizedClass}]`;
        index = closingIndex;
      }
    } else {
      expression += escapeRegularExpressionCharacter(character);
    }
  }
  return expression;
}

function escapeRegularExpressionCharacter(
  character: string | undefined,
): string {
  if (character === undefined) {
    return '';
  }
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}
