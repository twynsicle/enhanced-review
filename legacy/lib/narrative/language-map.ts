/**
 * Map a file path to a Monaco language id. Ported from the diffy POC's
 * `main/language-map.ts`, but written without a `node:path` dependency
 * so it can run in client components alongside the diff viewer.
 */
const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  vue: 'html',
  bat: 'bat',
  ps1: 'powershell',
};

const FILENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
};

export function detectLanguage(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath;
  const lowerBasename = basename.toLowerCase();

  if (lowerBasename in FILENAME_MAP) {
    return FILENAME_MAP[lowerBasename];
  }

  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = basename.slice(dotIndex + 1).toLowerCase();
    if (ext in EXTENSION_MAP) {
      return EXTENSION_MAP[ext];
    }
  }

  return 'plaintext';
}
