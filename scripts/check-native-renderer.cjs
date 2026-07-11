#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const extensionRoot = path.resolve(__dirname, '..');
const extensionPackage = require(path.join(extensionRoot, 'package.json'));
const config = extensionPackage.xaligo || {};
const packageRoot = path.resolve(
  extensionRoot,
  config.packageRoot || path.join('node_modules', '@xaligo', 'xaligo')
);
const platformNames = config.nativeBinaryPlatformNames || {};
const archNames = config.nativeBinaryArchNames || {};
const platform = platformNames[process.platform] || process.platform;
const arch = archNames[process.arch] || process.arch;
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = path.join(
  packageRoot,
  config.nativeBinaryDir || path.join('bin', 'native'),
  `xaligo-${platform}-${arch}${suffix}`
);

if (!fs.existsSync(binary)) {
  throw new Error(`bundled xaligo native binary was not found: ${binary}`);
}

const result = spawnSync(binary, ['diff', '--help'], {
  encoding: 'utf8',
  env: { ...process.env, XALIGO_HOME: packageRoot },
  timeout: 30_000
});
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (result.error) {
  throw result.error;
}
if (result.status !== 0 || !output.includes('xaligo diff <before.xal> <after.xal>')) {
  throw new Error(`bundled xaligo does not provide structural diff:\n${output.trim()}`);
}

console.log(`Verified structural diff support: ${binary}`);
