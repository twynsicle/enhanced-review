// Starts the PocketBase server. Auto-installs the binary if missing.
//
// Usage:
//   npm run pb            -- serves at http://127.0.0.1:8090
//   npm run pb -- serve --http=0.0.0.0:8090   -- pass extra flags after `--`
//
// pb_data/ is created next to the binary on first run and persists state
// (database, uploaded files, settings). Migrations in pb_migrations/ are
// auto-applied on startup.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const binaryName = os.platform() === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const binaryPath = path.join(repoRoot, 'tools', 'pocketbase', binaryName);

if (!existsSync(binaryPath)) {
  console.log('PocketBase binary not found; running pb:install first.');
  const install = spawnSync(process.execPath, [path.join(__dirname, 'pb-install.mjs')], { stdio: 'inherit' });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

// PocketBase resolves relative paths against its binary's directory, not CWD,
// so we always pass absolute paths for pb_data and pb_migrations to keep them
// at the repo root (matching what's gitignored / committed).
const passthrough = process.argv.slice(2);
const args = passthrough.length > 0
  ? passthrough
  : [
      'serve',
      `--dir=${path.join(repoRoot, 'pb_data')}`,
      `--migrationsDir=${path.join(repoRoot, 'pb_migrations')}`,
    ];

const result = spawnSync(binaryPath, args, {
  stdio: 'inherit',
  cwd: repoRoot,
});
process.exit(result.status ?? 0);
