#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const xaligoRoot = path.join(packageRoot, 'node_modules', '@xaligo', 'xaligo');
const xaligoPackageJsonPath = path.join(xaligoRoot, 'package.json');
const nativeDir = path.join(xaligoRoot, 'bin', 'native');
const targets = [
  'xaligo-windows-amd64.exe',
  'xaligo-windows-arm64.exe',
];

function releaseTag(packageJson) {
  if (process.env.XALIGO_NPM_RELEASE_TAG) return process.env.XALIGO_NPM_RELEASE_TAG;
  if (packageJson.xaligo && packageJson.xaligo.releaseTag) return packageJson.xaligo.releaseTag;
  return `v${String(packageJson.version).split('+')[0]}`;
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`download failed with HTTP ${status}: ${url}`));
        return;
      }

      const file = fs.createWriteStream(destination, { mode: 0o755 });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(xaligoPackageJsonPath)) {
    throw new Error('@xaligo/xaligo is not installed. Run npm install before packaging.');
  }

  const packageJson = require(xaligoPackageJsonPath);
  const tag = releaseTag(packageJson);
  fs.mkdirSync(nativeDir, { recursive: true });

  for (const target of targets) {
    const destination = path.join(nativeDir, target);
    if (fs.existsSync(destination)) continue;

    const url = `https://github.com/xaligo/xaligo/releases/download/${tag}/${target}`;
    console.log(`Downloading ${target} from ${tag}`);
    await download(url, destination);
    fs.chmodSync(destination, 0o755);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
