import { parseAndVerifySignature } from './key.mjs';
import { isExpired, daysLeft } from './payload.mjs';

/**
 * Verify offline đầy đủ: chữ ký + hết hạn + (optional) MachineID.
 *
 * @param {string} licenseKey
 * @param {string} publicKeyPem
 * @param {{ machineId?: string, now?: number, requireMachineBind?: boolean }} [opts]
 */
export function verifyLicense(licenseKey, publicKeyPem, opts = {}) {
  const parsed = parseAndVerifySignature(licenseKey, publicKeyPem);
  if (!parsed.ok) return { valid: false, reason: 'bad_signature', message: parsed.error };

  const { payload } = parsed;
  const now = opts.now ?? Date.now();

  if (isExpired(payload.exp, now)) {
    return {
      valid: false,
      reason: 'expired',
      message: `license hết hạn từ ${payload.exp}`,
      payload,
      daysLeft: daysLeft(payload.exp, now),
    };
  }

  const machineId = opts.machineId;
  if (machineId && payload.mid?.length) {
    if (!payload.mid.includes(machineId)) {
      return {
        valid: false,
        reason: 'machine_mismatch',
        message: 'MachineID không nằm trong danh sách được phép của key',
        payload,
      };
    }
  } else if (opts.requireMachineBind && (!payload.mid || !payload.mid.length)) {
    return {
      valid: false,
      reason: 'unbound_key',
      message: 'key chưa gắn MachineID — yêu cầu admin phát hành lại với mid',
      payload,
    };
  }

  return {
    valid: true,
    payload,
    daysLeft: daysLeft(payload.exp, now),
    licenseKey: parsed.licenseKey,
  };
}
