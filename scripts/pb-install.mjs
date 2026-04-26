// Downloads the PocketBase binary into tools/pocketbase/ for the current
// host platform. Idempotent: if the binary already exists at the pinned
// version, exits without doing anything.
//
// Used by `npm run pb:install`, and auto-run by `npm run pb` when the
// binary is missing.
//
// Cross-platform via Node + bsdtar (built into Windows 10 1803+, macOS,
// and standard on Linux). No PowerShell or unzip dependency.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  createWriteStream,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const PB_VERSION = '0.37.3';

const PLATFORMS = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'darwin',
};
const ARCHES = {
  x64: 'amd64',
  arm64: 'arm64',
};

const platform = PLATFORMS[os.platform()];
const arch = ARCHES[os.arch()];
if (!platform || !arch) {
  console.error(`Unsupported host platform: ${os.platform()}/${os.arch()}`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pbDir = path.join(repoRoot, 'tools', 'pocketbase');
const binaryName = os.platform() === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const binaryPath = path.join(pbDir, binaryName);
const versionMarker = path.join(pbDir, '.version');

const installedVersion = existsSync(versionMarker)
  ? readFileSync(versionMarker, 'utf8').trim()
  : null;
if (existsSync(binaryPath) && installedVersion === PB_VERSION) {
  console.log(`PocketBase v${PB_VERSION} already installed at ${binaryPath}`);
  process.exit(0);
}

const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
console.log(`Downloading PocketBase v${PB_VERSION} from ${url}`);

mkdirSync(pbDir, { recursive: true });
const zipPath = path.join(pbDir, `pocketbase-${PB_VERSION}.zip`);

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

console.log(`Extracting to ${pbDir}`);
try {
  if (os.platform() === 'win32') {
    // PowerShell Expand-Archive: built into Windows 10+, no PATH issues with
    // Git for Windows' GNU tar (which can't read zip).
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${pbDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    // unzip is preinstalled on macOS and almost all Linux distros.
    execFileSync('unzip', ['-o', zipPath, '-d', pbDir], { stdio: 'inherit' });
  }
} catch (err) {
  console.error(
    'Extraction failed. On Windows this uses PowerShell Expand-Archive; on macOS/Linux, `unzip`.',
  );
  console.error(err.message);
  process.exit(1);
}

unlinkSync(zipPath);
writeFileSync(versionMarker, PB_VERSION);

console.log(`Installed PocketBase v${PB_VERSION} → ${binaryPath}`);
