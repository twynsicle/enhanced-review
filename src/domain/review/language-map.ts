/**
 * Map a file path to a Monaco language id. Written without `node:path` so it
 * runs in the browser next to the diff viewer as well as on the server.
 */
const EXTENSION_MAP = new Map<string, string>(
  Object.entries({
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
  }),
);

const FILENAME_MAP = new Map<string, string>(
  Object.entries({
    dockerfile: 'dockerfile',
    makefile: 'shell',
  }),
);

export function detectLanguage(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath;
  const lowerBasename = basename.toLowerCase();

  const byName = FILENAME_MAP.get(lowerBasename);
  if (byName !== undefined) return byName;

  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex > 0) {
    const byExtension = EXTENSION_MAP.get(basename.slice(dotIndex + 1).toLowerCase());
    if (byExtension !== undefined) return byExtension;
  }

  return 'plaintext';
}
