#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const extensionPackageJsonPath = path.join(packageRoot, 'package.json');
const extensionPackageJson = require(extensionPackageJsonPath);
const config = extensionPackageJson.xaligo || {};
const packageName = config.packageName || '@xaligo/xaligo';
const packageRelativeRoot = config.packageRoot || path.join('node_modules', '@xaligo', 'xaligo');
const nativeBinaryRelativeDir = config.nativeBinaryDir || path.join('bin', 'native');
const xaligoRoot = path.resolve(packageRoot, packageRelativeRoot);
const xaligoPackageJsonPath = path.join(xaligoRoot, 'package.json');
const nativeDir = path.resolve(xaligoRoot, nativeBinaryRelativeDir);
const targets = config.vsixNativeBinaryTargets || [];
const platformNames = config.nativeBinaryPlatformNames || {};
const archNames = config.nativeBinaryArchNames || {};

function releaseTag(packageJson) {
  if (process.env.XALIGO_NPM_RELEASE_TAG) return process.env.XALIGO_NPM_RELEASE_TAG;
  if (packageJson.xaligo && packageJson.xaligo.releaseTag) return packageJson.xaligo.releaseTag;
  return `v${String(packageJson.version).split('+')[0]}`;
}

function binaryPlatform(platform) {
  return platformNames[platform] || platform;
}

function binaryArch(arch) {
  return archNames[arch] || arch;
}

function binaryName(target) {
  const platform = binaryPlatform(target.platform);
  const arch = binaryArch(target.arch);
  const suffix = target.platform === 'win32' ? '.exe' : '';
  return `xaligo-${platform}-${arch}${suffix}`;
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
    throw new Error(`${packageName} is not installed. Run npm install before packaging.`);
  }

  const packageJson = require(xaligoPackageJsonPath);
  const tag = releaseTag(packageJson);
  fs.mkdirSync(nativeDir, { recursive: true });

  for (const target of targets) {
    const name = binaryName(target);
    const destination = path.join(nativeDir, name);
    if (fs.existsSync(destination)) continue;

    const url = `https://github.com/xaligo/xaligo/releases/download/${tag}/${name}`;
    console.log(`Downloading ${name} from ${tag}`);
    await download(url, destination);
    fs.chmodSync(destination, 0o755);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
