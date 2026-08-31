/**
 * Smoke test license issue → verify → activation MAC.
 * Chạy: node license/test/smoke.mjs
 * Cần đã có license/keys/private.pem + public.pem (fbo-license keypair).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMachineId,
  issueLicenseKey,
  verifyLicense,
  createActivationRecord,
  verifyActivationRecord,
  isExpired,
} from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const priv = fs.readFileSync(path.join(root, 'keys', 'private.pem'), 'utf8');
const pub = fs.readFileSync(path.join(root, 'keys', 'public.pem'), 'utf8');
const mid = getMachineId();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const key = issueLicenseKey(
  { id: 'LIC-SMOKE', exp: '2099-01-01', max: 1, mid: [mid], co: 'Smoke' },
  priv,
);
assert(key.startsWith('FBO1.'), 'prefix');

const ok = verifyLicense(key, pub, { machineId: mid });
assert(ok.valid, `verify: ${ok.message}`);

const badMid = verifyLicense(key, pub, { machineId: '0'.repeat(32) });
assert(!badMid.valid && badMid.reason === 'machine_mismatch', 'machine check');

const expiredKey = issueLicenseKey(
  { id: 'LIC-OLD', exp: '2020-01-01', max: 1, mid: [mid] },
  priv,
);
const exp = verifyLicense(expiredKey, pub, { machineId: mid });
assert(!exp.valid && exp.reason === 'expired', 'expiry check');
assert(isExpired('2020-01-01'), 'isExpired helper');

const created = createActivationRecord(key, pub, mid);
assert(created.ok, 'activate');
const live = verifyActivationRecord(created.record, pub, mid);
assert(live.valid, 'activation verify');

const tampered = { ...created.record, exp: '2099-12-31' };
const t = verifyActivationRecord(tampered, pub, mid);
assert(!t.valid && t.reason === 'tampered', 'tamper detect');

console.log('smoke OK', { machineId: mid, daysLeft: ok.daysLeft });
