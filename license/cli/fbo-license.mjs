#!/usr/bin/env node
/**
 * CLI nội bộ phát hành / kiểm tra license.
 *
 *   node license/cli/fbo-license.mjs keypair [--out license/keys]
 *   node license/cli/fbo-license.mjs machine-id
 *   node license/cli/fbo-license.mjs issue --id LIC-001 --exp 2027-12-31 --max 3 \
 *        --mid <id1>,<id2> --co "Cong ty ABC" [--priv license/keys/private.pem]
 *   node license/cli/fbo-license.mjs verify --key FBO1.... [--pub license/keys/public.pem]
 *   node license/cli/fbo-license.mjs issue --from payload.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateKeyPair,
  getMachineId,
  issueLicenseKey,
  verifyLicense,
} from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_KEYS = path.join(ROOT, 'keys');

function usage() {
  console.log(`Usage:
  fbo-license keypair [--out DIR]
  fbo-license machine-id
  fbo-license issue --id ID --exp YYYY-MM-DD --max N [--mid id1,id2] [--co NAME] [--note TEXT] [--priv PEM]
  fbo-license issue --from payload.json [--priv PEM]
  fbo-license verify --key KEY [--pub PEM] [--mid MACHINE_ID]
`);
}

function arg(name, argv, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  return argv[i + 1];
}

function has(name, argv) {
  return argv.includes(name);
}

function readPem(file, label) {
  if (!fs.existsSync(file)) throw new Error(`không tìm thấy ${label}: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function cmdKeypair(argv) {
  const outDir = path.resolve(arg('--out', argv, DEFAULT_KEYS));
  fs.mkdirSync(outDir, { recursive: true });
  const privPath = path.join(outDir, 'private.pem');
  const pubPath = path.join(outDir, 'public.pem');
  if (fs.existsSync(privPath) && !has('--force', argv)) {
    throw new Error(`đã có ${privPath} — thêm --force nếu muốn tạo lại`);
  }
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  fs.writeFileSync(privPath, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(pubPath, publicKeyPem);
  console.log(`OK\n  private: ${privPath}\n  public:  ${pubPath}`);
  console.log('Nhúng public.pem vào extension; giữ private.pem chỉ trên máy admin.');
}

function cmdMachineId() {
  console.log(getMachineId());
}

function cmdIssue(argv) {
  const priv = readPem(path.resolve(arg('--priv', argv, path.join(DEFAULT_KEYS, 'private.pem'))), 'private key');
  let payload;
  const from = arg('--from', argv);
  if (from) {
    payload = JSON.parse(fs.readFileSync(path.resolve(from), 'utf8'));
  } else {
    const midRaw = arg('--mid', argv, '');
    payload = {
      id: arg('--id', argv),
      exp: arg('--exp', argv),
      max: Number(arg('--max', argv, '1')),
      co: arg('--co', argv),
      note: arg('--note', argv),
    };
    if (midRaw) payload.mid = midRaw.split(/[,;\s]+/).filter(Boolean);
  }
  if (!payload.id || !payload.exp) throw new Error('cần --id và --exp (hoặc --from)');
  const key = issueLicenseKey(payload, priv);
  console.log(key);
}

function cmdVerify(argv) {
  const pub = readPem(path.resolve(arg('--pub', argv, path.join(DEFAULT_KEYS, 'public.pem'))), 'public key');
  const key = arg('--key', argv);
  if (!key) throw new Error('cần --key');
  const mid = arg('--mid', argv, getMachineId());
  const result = verifyLicense(key, pub, { machineId: mid });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

try {
  if (cmd === 'keypair') cmdKeypair(argv);
  else if (cmd === 'machine-id') cmdMachineId();
  else if (cmd === 'issue') cmdIssue(argv);
  else if (cmd === 'verify') cmdVerify(argv);
  else {
    usage();
    process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
