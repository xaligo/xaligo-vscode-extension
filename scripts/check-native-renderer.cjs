#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
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

const requiredResources = [
  'VERSION',
  'package.json',
  path.join('etc', 'resources', 'aws', 'app.yaml'),
  path.join('etc', 'resources', 'aws', 'service-catalog.csv'),
  path.join('etc', 'resources', 'aws', 'service-index.csv'),
  path.join('etc', 'resources', 'aws', 'svg', 'Architecture-Group-Icons', 'AWS-Account_32.svg'),
  path.join('etc', 'resources', 'aws', 'svg', 'Tabler-Icons', 'LICENSE')
];

for (const relativePath of requiredResources) {
  const target = path.join(packageRoot, relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size === 0) {
    throw new Error(`bundled xaligo runtime resource was not found: ${target}`);
  }
}

function run(args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    env: { ...process.env, XALIGO_HOME: packageRoot },
    timeout: 120_000
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`bundled xaligo command failed (${args.join(' ')}):\n${output.trim()}`);
  }
  return output;
}

const diffHelp = run(['diff', '--help']);
if (!diffHelp.includes('xaligo diff <before.xal> <after.xal>')) {
  throw new Error(`bundled xaligo does not provide structural diff:\n${diffHelp.trim()}`);
}
const lspHelp = run(['lsp', '--help']);
if (!lspHelp.includes('Language Server Protocol 3.18')) {
  throw new Error(`bundled xaligo does not provide its LSP 3.18 server:\n${lspHelp.trim()}`);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xaligo-renderer-check-'));
try {
  const inputPath = path.join(temporaryDirectory, 'smoke.xal');
  fs.writeFileSync(
    inputPath,
    '<xaligo version="1"><frames><frame id="smoke" width="320" height="200"><rectangle id="box" title="Smoke" height="96" /></frame></frames></xaligo>\n'
  );
  run(['validate', inputPath]);
  const formats = [
    ['svg', 'svg', 'svg'],
    ['pptx', 'pptx', 'zip']
  ];
  for (const [format, extension, signature] of formats) {
    const outputPath = path.join(temporaryDirectory, `smoke.${extension}`);
    run(['render', inputPath, '--format', format, '-o', outputPath]);
    const output = fs.readFileSync(outputPath);
    const valid = signature === 'svg'
      ? output.subarray(0, 512).toString('utf8').includes('<svg')
      : output.subarray(0, 2).toString('ascii') === 'PK';
    if (!valid) {
      throw new Error(`bundled xaligo failed its ${format} output signature check`);
    }
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Verified bundled xaligo SVG, PPTX, diff, and LSP support: ${binary}`);
