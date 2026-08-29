#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const executable = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce'
);
const output = execFileSync(executable, ['ls'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024
});
const files = new Set(output
  .split(/\r?\n/)
  .map((entry) => entry.trim().replaceAll('\\', '/'))
  .filter(Boolean));
const required = [
  'README.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/xal-spec.md',
  'docs/diagram-creation.md',
  'dist/extension/extension.js',
  'dist/webview/preview.js',
  'dist/webview/preview.css',
  'node_modules/@xaligo/xaligo/VERSION',
  'node_modules/@xaligo/xaligo/package.json',
  'node_modules/@xaligo/xaligo/README.md',
  'node_modules/@xaligo/xaligo/THIRD_PARTY_LICENSES',
  'node_modules/@xaligo/xaligo/etc/resources/aws/app.yaml',
  'node_modules/@xaligo/xaligo/etc/resources/aws/service-catalog.csv',
  'node_modules/@xaligo/xaligo/etc/resources/aws/service-index.csv',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-darwin-amd64',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-darwin-arm64',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-linux-amd64',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-linux-arm64',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-windows-amd64.exe',
  'node_modules/@xaligo/xaligo/bin/native/xaligo-windows-arm64.exe'
];
const missing = required.filter((entry) => !files.has(entry));
if (missing.length > 0) {
  throw new Error(`VSIX file list is missing required content:\n${missing.join('\n')}`);
}
console.log(`Verified ${required.length} required VSIX files.`);
