export enum SupportedLanguage {
  TypeScript = 'TypeScript',
  JavaScript = 'JavaScript',
  TSX = 'TSX',
  JSX = 'JSX',
  Python = 'Python',
  Go = 'Go',
  Java = 'Java',
  Rust = 'Rust',
  CSharp = 'C#',
  CPlusPlus = 'C++',
  C = 'C',
  JSON = 'JSON',
  YAML = 'YAML',
  Markdown = 'Markdown',
  Unknown = 'Unknown',
}

const LANGUAGES_BY_EXTENSION: Readonly<Record<string, SupportedLanguage>> = {
  '.c': SupportedLanguage.C,
  '.cpp': SupportedLanguage.CPlusPlus,
  '.cs': SupportedLanguage.CSharp,
  '.go': SupportedLanguage.Go,
  '.java': SupportedLanguage.Java,
  '.js': SupportedLanguage.JavaScript,
  '.json': SupportedLanguage.JSON,
  '.jsx': SupportedLanguage.JSX,
  '.md': SupportedLanguage.Markdown,
  '.py': SupportedLanguage.Python,
  '.rs': SupportedLanguage.Rust,
  '.ts': SupportedLanguage.TypeScript,
  '.tsx': SupportedLanguage.TSX,
  '.yaml': SupportedLanguage.YAML,
  '.yml': SupportedLanguage.YAML,
};

export function detectLanguage(extension: string | null): SupportedLanguage {
  if (extension === null) {
    return SupportedLanguage.Unknown;
  }

  return (
    LANGUAGES_BY_EXTENSION[extension.toLowerCase()] ?? SupportedLanguage.Unknown
  );
}
