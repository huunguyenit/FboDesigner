import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * MachineID ổn định theo máy (không theo user).
 * Hash SHA-256 để không lộ hostname/UUID thô khi gửi cho admin.
 *
 * Nguồn:
 * - Windows: MachineGuid (HKLM)
 * - Linux: /etc/machine-id
 * - macOS: IOPlatformUUID
 * - Fallback: hostname + NIC MAC
 */
export function getMachineId() {
  const raw = collectRawId();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
}

function collectRawId() {
  const platform = process.platform;
  try {
    if (platform === 'win32') return `win:${readWindowsMachineGuid()}`;
    if (platform === 'linux') return `linux:${readLinuxMachineId()}`;
    if (platform === 'darwin') return `darwin:${readDarwinPlatformUuid()}`;
  } catch {
    // fall through
  }
  return `fallback:${os.hostname()}|${primaryMac()}`;
}

function readWindowsMachineGuid() {
  const out = execSync(
    'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
    { encoding: 'utf8', windowsHide: true, timeout: 5000 },
  );
  const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
  if (!m) throw new Error('không đọc được MachineGuid');
  return m[1].trim();
}

function readLinuxMachineId() {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    if (fs.existsSync(p)) {
      const id = fs.readFileSync(p, 'utf8').trim();
      if (id) return id;
    }
  }
  throw new Error('không tìm thấy machine-id');
}

function readDarwinPlatformUuid() {
  const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
    encoding: 'utf8',
    timeout: 5000,
  });
  const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('không đọc được IOPlatformUUID');
  return m[1].trim();
}

function primaryMac() {
  const nics = os.networkInterfaces();
  for (const list of Object.values(nics)) {
    for (const n of list || []) {
      if (!n.internal && n.mac && n.mac !== '00:00:00:00:00:00') return n.mac;
    }
  }
  return '00:00:00:00:00:00';
}
