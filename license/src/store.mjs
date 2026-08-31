import { activationMac } from './crypto.mjs';
import { verifyLicense } from './verify.mjs';

/**
 * Bản ghi kích hoạt local.
 * Prefer lưu qua VS Code SecretStorage; file fallback dùng kèm MAC.
 *
 * {
 *   v: 1,
 *   licenseKey: "FBO1....",
 *   machineId: "...",
 *   activatedAt: "2026-08-31T04:00:00.000Z",
 *   licenseId: "LIC-...",
 *   exp: "2027-12-31",
 *   mac: "hex..."
 * }
 */

export function createActivationRecord(licenseKey, publicKeyPem, machineId, now = new Date()) {
  const checked = verifyLicense(licenseKey, publicKeyPem, { machineId });
  if (!checked.valid) {
    return { ok: false, reason: checked.reason, message: checked.message, payload: checked.payload };
  }

  // Key có mid: đã check membership. Key không mid: bind máy hiện tại vào record local.
  if (checked.payload.mid?.length && !checked.payload.mid.includes(machineId)) {
    return { ok: false, reason: 'machine_mismatch', message: 'MachineID không được phép' };
  }

  const base = {
    v: 1,
    licenseKey: checked.licenseKey,
    machineId,
    activatedAt: now.toISOString(),
    licenseId: checked.payload.id,
    exp: checked.payload.exp,
    max: checked.payload.max,
    co: checked.payload.co,
  };

  const mac = activationMac(publicKeyPem, base.licenseKey, machineId, base);
  return { ok: true, record: { ...base, mac }, payload: checked.payload };
}

/**
 * Kiểm tra bản ghi local: MAC + MachineID hiện tại + verify lại key + hết hạn.
 */
export function verifyActivationRecord(record, publicKeyPem, currentMachineId, now = Date.now()) {
  if (!record || record.v !== 1) {
    return { valid: false, reason: 'bad_record', message: 'bản ghi kích hoạt không hợp lệ' };
  }

  const { mac, ...base } = record;
  if (!mac) return { valid: false, reason: 'bad_record', message: 'thiếu MAC toàn vẹn' };

  const expected = activationMac(publicKeyPem, base.licenseKey, base.machineId, base);
  if (expected !== mac) {
    return { valid: false, reason: 'tampered', message: 'file/bản ghi kích hoạt đã bị sửa' };
  }

  if (base.machineId !== currentMachineId) {
    return {
      valid: false,
      reason: 'machine_mismatch',
      message: 'MachineID không khớp bản ghi kích hoạt',
    };
  }

  return verifyLicense(base.licenseKey, publicKeyPem, {
    machineId: currentMachineId,
    now,
  });
}
