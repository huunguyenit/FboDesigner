import { b64urlEncode, b64urlDecode, canonicalJson } from './codec.mjs';
import { signBytes, verifyBytes } from './crypto.mjs';
import { normalizePayload } from './payload.mjs';

/** Prefix giúp nhận diện nhanh khi copy/paste. */
export const KEY_PREFIX = 'FBO1';

/**
 * License Key = FBO1.<payload_b64url>.<sig_b64url>
 * Payload là canonical JSON đã ký bằng Ed25519.
 */
export function issueLicenseKey(rawPayload, privateKeyPem) {
  const payload = normalizePayload(rawPayload);
  const body = canonicalJson(payload);
  const sig = signBytes(privateKeyPem, body);
  return `${KEY_PREFIX}.${b64urlEncode(Buffer.from(body, 'utf8'))}.${b64urlEncode(sig)}`;
}

/**
 * Parse + verify chữ ký. Không kiểm tra hết hạn / machine — đó là việc của verifyLicense.
 * @returns {{ ok: true, payload } | { ok: false, error: string }}
 */
export function parseAndVerifySignature(licenseKey, publicKeyPem) {
  const key = String(licenseKey || '').trim().replace(/\s+/g, '');
  const parts = key.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { ok: false, error: 'định dạng key không hợp lệ (cần FBO1.<payload>.<sig>)' };
  }

  let body;
  let sig;
  try {
    body = b64urlDecode(parts[1]).toString('utf8');
    sig = b64urlDecode(parts[2]);
  } catch {
    return { ok: false, error: 'không decode được payload/chữ ký' };
  }

  if (!verifyBytes(publicKeyPem, body, sig)) {
    return { ok: false, error: 'chữ ký không hợp lệ (key giả mạo hoặc đã bị sửa)' };
  }

  let payload;
  try {
    payload = normalizePayload(JSON.parse(body));
  } catch (err) {
    return { ok: false, error: `payload không hợp lệ: ${err.message}` };
  }

  // Đảm bảo body đúng canonical form (chống biến thể JSON cùng nội dung).
  if (canonicalJson(payload) !== body) {
    return { ok: false, error: 'payload không đúng dạng canonical' };
  }

  return { ok: true, payload, licenseKey: key };
}
