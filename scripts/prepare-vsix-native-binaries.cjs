#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

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
const allowedDownloadHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com'
]);
const downloadTimeoutMilliseconds = 60_000;
const maximumBinaryBytes = 64 * 1024 * 1024;
const maximumChecksumBytes = 4_096;

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

function validateDownloadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedDownloadHosts.has(url.hostname)) {
    throw new Error(`refusing untrusted native binary URL: ${url.origin}`);
  }
  return url;
}

function openDownload(value, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = validateDownloadUrl(value);
    } catch (error) {
      reject(error);
      return;
    }
    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        const redirect = new URL(response.headers.location, url).toString();
        try {
          validateDownloadUrl(redirect);
        } catch (error) {
          reject(error);
          return;
        }
        resolve(openDownload(redirect, redirects + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`download failed with HTTP ${status}: ${url}`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(downloadTimeoutMilliseconds, () => {
      request.destroy(new Error(`download timed out: ${url}`));
    });
    request.on('error', reject);
  });
}

async function download(value, destination, maximumBytes) {
  const response = await openDownload(value);
  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    response.resume();
    throw new Error(`download exceeds ${maximumBytes} bytes: ${value}`);
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maximumBytes) {
        callback(new Error(`download exceeds ${maximumBytes} bytes: ${value}`));
        return;
      }
      callback(null, chunk);
    }
  });
  const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  try {
    await pipeline(response, limiter, output);
  } catch (error) {
    safeUnlink(destination);
    throw error;
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function parseChecksum(contents, expectedName) {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/i.exec(line);
    if (match && match[2] === expectedName) return match[1].toLowerCase();
  }
  throw new Error(`invalid checksum asset for ${expectedName}`);
}

function checksumsEqual(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function validateBinaryArchitecture(filePath, target) {
  const descriptor = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(4_096);
  let bytesRead;
  try {
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const value = header.subarray(0, bytesRead);
  const arch = target.arch === 'x64' ? 'amd64' : target.arch;
  const valid = target.platform === 'win32'
    ? isPeArchitecture(value, arch)
    : target.platform === 'linux'
      ? isElfArchitecture(value, arch)
      : target.platform === 'darwin'
        ? isMachOArchitecture(value, arch)
        : false;
  if (!valid) {
    throw new Error(`${path.basename(filePath)} is not a ${target.platform}/${target.arch} executable`);
  }
}

function isPeArchitecture(header, arch) {
  if (header.length < 64 || header.subarray(0, 2).toString('ascii') !== 'MZ') return false;
  const offset = header.readUInt32LE(0x3c);
  const expected = arch === 'amd64' ? 0x8664 : arch === 'arm64' ? 0xaa64 : -1;
  return offset + 6 <= header.length &&
    header.toString('ascii', offset, offset + 4) === 'PE\u0000\u0000' &&
    header.readUInt16LE(offset + 4) === expected;
}

function isElfArchitecture(header, arch) {
  if (
    header.length < 20 ||
    header.subarray(0, 4).toString('hex') !== '7f454c46' ||
    header[4] !== 2
  ) return false;
  const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
  return machine === (arch === 'amd64' ? 62 : arch === 'arm64' ? 183 : -1);
}

function isMachOArchitecture(header, arch) {
  if (header.length < 8) return false;
  const expected = arch === 'amd64' ? 0x01000007 : arch === 'arm64' ? 0x0100000c : -1;
  const magic = header.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe') return header.readUInt32LE(4) === expected;
  if (magic === 'feedfacf') return header.readUInt32BE(4) === expected;
  if (magic !== 'cafebabe' && magic !== 'bebafeca') return false;
  const littleEndian = magic === 'bebafeca';
  const readUInt32 = (offset) => littleEndian
    ? header.readUInt32LE(offset)
    : header.readUInt32BE(offset);
  const count = readUInt32(4);
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 20;
    if (offset + 4 > header.length) return false;
    if (readUInt32(offset) === expected) return true;
  }
  return false;
}

async function installTarget(options) {
  const { target, name, destination, releaseUrl, downloadFile = download } = options;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(
    path.join(path.dirname(destination), `.${name}.${process.pid}-`)
  );
  const checksumPath = path.join(temporaryDirectory, `${name}.sha256`);
  const binaryPath = path.join(temporaryDirectory, name);
  try {
    await downloadFile(`${releaseUrl}/${name}.sha256`, checksumPath, maximumChecksumBytes);
    const expected = parseChecksum(fs.readFileSync(checksumPath, 'utf8'), name);
    if (fs.existsSync(destination)) {
      const info = fs.lstatSync(destination);
      if (!info.isFile()) {
        throw new Error(`refusing to replace non-file native binary path: ${destination}`);
      }
      try {
        if (checksumsEqual(sha256File(destination), expected)) {
          validateBinaryArchitecture(destination, target);
          fs.chmodSync(destination, 0o755);
          return { status: 'current', checksum: expected };
        }
      } catch {
        // A stale, unreadable, or wrong-architecture artifact is replaced below.
      }
    }

    await downloadFile(`${releaseUrl}/${name}`, binaryPath, maximumBinaryBytes);
    const actual = sha256File(binaryPath);
    if (!checksumsEqual(actual, expected)) {
      throw new Error(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
    }
    validateBinaryArchitecture(binaryPath, target);
    fs.chmodSync(binaryPath, 0o755);

    const backupPath = fs.existsSync(destination)
      ? path.join(path.dirname(destination), `.${name}.backup-${crypto.randomUUID()}`)
      : '';
    if (backupPath) fs.renameSync(destination, backupPath);
    try {
      fs.renameSync(binaryPath, destination);
    } catch (installError) {
      if (backupPath) fs.renameSync(backupPath, destination);
      throw installError;
    }
    if (backupPath) safeUnlink(backupPath);
    return { status: 'installed', checksum: expected };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  if (!fs.existsSync(xaligoPackageJsonPath)) {
    throw new Error(`${packageName} is not installed. Run npm install before packaging.`);
  }
  const packageJson = require(xaligoPackageJsonPath);
  const tag = releaseTag(packageJson);
  const releaseUrl = `https://github.com/xaligo/xaligo/releases/download/${encodeURIComponent(tag)}`;
  for (const target of targets) {
    const name = binaryName(target);
    const destination = path.join(nativeDir, name);
    const result = await installTarget({ target, name, destination, releaseUrl });
    console.log(`${result.status === 'current' ? 'Verified' : 'Downloaded'} ${name} (${tag})`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  binaryName,
  installTarget,
  isElfArchitecture,
  isMachOArchitecture,
  isPeArchitecture,
  parseChecksum,
  validateDownloadUrl
};
