import crypto from 'node:crypto';
import { b64urlEncode, b64urlDecode, canonicalJson } from './codec.mjs';

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

export function signBytes(privateKeyPem, data) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(data), key);
}

export function verifyBytes(publicKeyPem, data, signature) {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, Buffer.from(data), key, Buffer.from(signature));
}

export function signCanonical(privateKeyPem, obj) {
  const body = canonicalJson(obj);
  return { body, signature: signBytes(privateKeyPem, body) };
}

export function verifyCanonical(publicKeyPem, obj, signature) {
  const body = canonicalJson(obj);
  return verifyBytes(publicKeyPem, body, signature);
}

/** Fingerprint ngắn của public key — dùng làm salt cho HMAC local. */
export function publicKeyFingerprint(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/**
 * HMAC chống sửa file kích hoạt local.
 * Binding secret = SHA256(fp | licenseKey | machineId) — không cần private key,
 * nhưng copy record sang máy khác sẽ fail vì machineId khác.
 */
export function activationMac(publicKeyPem, licenseKey, machineId, recordWithoutMac) {
  const fp = publicKeyFingerprint(publicKeyPem);
  const secret = crypto
    .createHash('sha256')
    .update(`${fp}|${licenseKey}|${machineId}`, 'utf8')
    .digest();
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalJson(recordWithoutMac), 'utf8')
    .digest('hex');
}

export { b64urlEncode, b64urlDecode, canonicalJson };
