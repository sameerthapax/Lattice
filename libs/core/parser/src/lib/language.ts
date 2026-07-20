import { SupportedLanguage } from '@lattice/core-indexer';

import type { ParseableLanguage } from './models';

export function toParseableLanguage(
  language: SupportedLanguage,
): ParseableLanguage | null {
  switch (language) {
    case SupportedLanguage.TypeScript:
      return 'TypeScript';
    case SupportedLanguage.TSX:
      return 'TSX';
    case SupportedLanguage.JavaScript:
      return 'JavaScript';
    case SupportedLanguage.JSX:
      return 'JSX';
    default:
      return null;
  }
}
