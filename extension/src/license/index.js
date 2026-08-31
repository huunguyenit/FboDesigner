const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const { PUBLIC_KEY_PEM, PUBLIC_KEY_READY } = require('./public-key');

const SECRET_KEY = 'fboDesigner.license.activation';
const CFG_LICENSE_KEY = 'licenseKey';
const CFG_MACHINE_ID = 'machineId';

let licenseModPromise;
/** Tránh vòng lặp: update setting → onDidChange → activate lại. */
let settingsMuteDepth = 0;

function loadLicenseMod() {
  if (!licenseModPromise) {
    const candidates = [
      // F5 từ repo: extension/src/license → ../../../license/src
      path.join(__dirname, '..', '..', '..', 'license', 'src', 'index.mjs'),
      // .vsix: extension/src/license → ../../license (đã chép bởi package-vsix)
      path.join(__dirname, '..', '..', 'license', 'index.mjs'),
    ];
    const entry = candidates.find((p) => fs.existsSync(p));
    if (!entry) {
      return Promise.reject(new Error(`không tìm thấy fbo-license, đã thử:\n${candidates.join('\n')}`));
    }
    licenseModPromise = import(pathToFileURL(entry).href);
  }
  return licenseModPromise;
}

function assertPublicKey() {
  if (!PUBLIC_KEY_READY || PUBLIC_KEY_PEM.includes('REPLACE_AFTER')) {
    throw new Error('Chưa nhúng public key — chạy keypair rồi cập nhật extension/src/license/public-key.js');
  }
  return PUBLIC_KEY_PEM;
}

function cfg() {
  return vscode.workspace.getConfiguration('fboDesigner');
}

async function writeSetting(key, value) {
  const cur = cfg().get(key);
  if (cur === value) return;
  // application-scope → ConfigurationTarget.Global (User settings)
  await cfg().update(key, value, vscode.ConfigurationTarget.Global);
}

async function withSettingsMute(fn) {
  settingsMuteDepth += 1;
  try {
    return await fn();
  } finally {
    // onDidChangeConfiguration đôi khi tới sau khi update() resolve — chờ một nhịp.
    await new Promise((r) => setTimeout(r, 50));
    settingsMuteDepth = Math.max(0, settingsMuteDepth - 1);
  }
}

/**
 * Ghi Machine ID lên Settings trước (độc lập license) để luôn thấy được trong UI.
 */
async function syncMachineIdToSettings() {
  return withSettingsMute(async () => {
    const mod = await loadLicenseMod();
    const machineId = mod.getMachineId();
    await writeSetting(CFG_MACHINE_ID, machineId);
    return machineId;
  });
}

/**
 * Đồng bộ Machine ID + License Key lên Settings UI (Global / User).
 */
async function syncLicenseToSettings(context) {
  return withSettingsMute(async () => {
    const mod = await loadLicenseMod();
    const machineId = mod.getMachineId();
    await writeSetting(CFG_MACHINE_ID, machineId);

    const raw = await context.secrets.get(SECRET_KEY);
    let licenseKey = '';
    if (raw) {
      try {
        const record = JSON.parse(raw);
        if (record && typeof record.licenseKey === 'string') licenseKey = record.licenseKey;
      } catch {
        // ignore
      }
    }
    await writeSetting(CFG_LICENSE_KEY, licenseKey);
    return { machineId, licenseKey };
  });
}

/**
 * Trạng thái license hiện tại (đọc SecretStorage + verify offline).
 */
async function getLicenseStatus(context) {
  const mod = await loadLicenseMod();
  const pub = assertPublicKey();
  const machineId = mod.getMachineId();
  const raw = await context.secrets.get(SECRET_KEY);
  if (!raw) {
    return { active: false, reason: 'not_activated', message: 'chưa kích hoạt license', machineId };
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { active: false, reason: 'bad_record', message: 'bản ghi kích hoạt hỏng', machineId };
  }

  const result = mod.verifyActivationRecord(record, pub, machineId);
  if (!result.valid) {
    return {
      active: false,
      reason: result.reason,
      message: result.message,
      payload: result.payload,
      daysLeft: result.daysLeft,
      machineId,
      licenseKey: record.licenseKey,
    };
  }
  return {
    active: true,
    payload: result.payload,
    daysLeft: result.daysLeft,
    machineId,
    licenseKey: record.licenseKey,
  };
}

/**
 * Kích hoạt bằng License Key (offline). Bind MachineID máy hiện tại.
 */
async function activateLicense(context, licenseKey) {
  const mod = await loadLicenseMod();
  const pub = assertPublicKey();
  const machineId = mod.getMachineId();
  const created = mod.createActivationRecord(licenseKey, pub, machineId);
  if (!created.ok) {
    return { ok: false, reason: created.reason, message: created.message, payload: created.payload, machineId };
  }
  await context.secrets.store(SECRET_KEY, JSON.stringify(created.record));
  await syncLicenseToSettings(context);
  return {
    ok: true,
    payload: created.payload,
    machineId,
    daysLeft: mod.daysLeft(created.payload.exp),
    licenseKey: created.record.licenseKey,
  };
}

async function deactivateLicense(context) {
  await context.secrets.delete(SECRET_KEY);
  await syncLicenseToSettings(context);
}

async function getMachineId() {
  const mod = await loadLicenseMod();
  return mod.getMachineId();
}

async function requireActiveLicense(context) {
  return getLicenseStatus(context);
}

function licenseDeniedText(status) {
  const { t } = require('../locale');
  if (!status) return t('extension.license_required');
  if (status.reason === 'expired') {
    return t('extension.license_expired', { exp: status.payload?.exp || '?' });
  }
  if (status.reason === 'machine_mismatch') return t('extension.license_machine');
  return status.message || t('extension.license_required');
}

async function setLicensedContext(active) {
  await vscode.commands.executeCommand('setContext', 'fboDesigner.licensed', !!active);
}

/**
 * Chặn tính năng khi chưa có license hợp lệ.
 * @returns {Promise<object|null>} status nếu OK, null nếu bị chặn.
 */
async function ensureLicense(context, opts = {}) {
  const { t } = require('../locale');
  let status;
  try {
    status = await getLicenseStatus(context);
  } catch (err) {
    await setLicensedContext(false);
    if (!opts.silent) {
      vscode.window.showErrorMessage(
        `${t('extension.prefix')}${t('extension.license_required')} (${err.message})`,
      );
    }
    return null;
  }

  await setLicensedContext(!!status.active);
  if (status.active) return status;

  if (!opts.silent) {
    const pick = await vscode.window.showErrorMessage(
      `${t('extension.prefix')}${licenseDeniedText(status)}`,
      t('extension.license_open_settings'),
    );
    if (pick === t('extension.license_open_settings')) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'fboDesigner.licenseKey');
    }
  }
  return null;
}

/** HTML khoá khi mở custom editor / panel mà chưa có license. */
function lockedWebviewHtml(message) {
  const esc = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html><html><body style="font:13px/1.5 system-ui,sans-serif;padding:24px;color:#ccc;background:#1e1e1e">
  <h2 style="margin:0 0 8px;color:#fff">FBO Designer</h2>
  <p>${esc}</p>
  <p style="opacity:.75">Settings → FBO Designer → License Key</p>
  </body></html>`;
}

/**
 * Bọc handler lệnh: chỉ chạy khi license hợp lệ.
 */
function withLicense(context, fn) {
  return async (...args) => {
    const status = await ensureLicense(context);
    if (!status) return undefined;
    return fn(...args);
  };
}


/**
 * Áp dụng giá trị đang có trong Settings (user dán key / xoá key).
 * @returns {Promise<{ applied: boolean, ok?: boolean, message?: string }>}
 */
async function applyLicenseFromSettings(context) {
  return withSettingsMute(async () => {
    const wanted = String(cfg().get(CFG_LICENSE_KEY) || '').trim();
    const status = await getLicenseStatus(context);
    const current = String(status.licenseKey || '').trim();

    if (!wanted) {
      if (current) {
        await context.secrets.delete(SECRET_KEY);
        await writeSetting(CFG_LICENSE_KEY, '');
        await writeSetting(CFG_MACHINE_ID, status.machineId);
        return { applied: true, ok: true, message: 'đã huỷ kích hoạt license' };
      }
      await writeSetting(CFG_MACHINE_ID, status.machineId);
      return { applied: false };
    }

    if (wanted === current && status.active) {
      await writeSetting(CFG_MACHINE_ID, status.machineId);
      return { applied: false };
    }

    const mod = await loadLicenseMod();
    const pub = assertPublicKey();
    const machineId = status.machineId;
    const created = mod.createActivationRecord(wanted, pub, machineId);
    if (!created.ok) {
      await writeSetting(CFG_LICENSE_KEY, current);
      await writeSetting(CFG_MACHINE_ID, machineId);
      return { applied: true, ok: false, message: created.message || created.reason };
    }
    await context.secrets.store(SECRET_KEY, JSON.stringify(created.record));
    await writeSetting(CFG_LICENSE_KEY, created.record.licenseKey);
    await writeSetting(CFG_MACHINE_ID, machineId);
    return {
      applied: true,
      ok: true,
      message: `đã kích hoạt tới ${created.payload.exp} (còn ${mod.daysLeft(created.payload.exp)} ngày)`,
    };
  });
}

/**
 * Gọi một lần trong activate(): đồng bộ Settings + lắng nghe khi user sửa licenseKey.
 */
function initLicenseSettings(context) {
  const boot = (async () => {
    try {
      // Machine ID ghi trước — nếu phần license lỗi, setting vẫn có giá trị để copy.
      await syncMachineIdToSettings();
      await syncLicenseToSettings(context);
      const fromUi = await applyLicenseFromSettings(context);
      const status = await getLicenseStatus(context);
      await setLicensedContext(!!status.active);
      if (fromUi.applied && fromUi.ok === false) {
        vscode.window.showErrorMessage(`FBO Designer: ${fromUi.message}`);
      } else if (fromUi.applied && fromUi.ok) {
        vscode.window.showInformationMessage(`FBO Designer: ${fromUi.message}`);
      }
    } catch (err) {
      await setLicensedContext(false);
      vscode.window.showWarningMessage(`FBO Designer license: ${err.message}`);
    }
  })();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (settingsMuteDepth > 0) return;
      if (!e.affectsConfiguration('fboDesigner.licenseKey') && !e.affectsConfiguration('fboDesigner.machineId')) {
        return;
      }
      // machineId luôn ghi đè về giá trị thật của máy.
      if (e.affectsConfiguration('fboDesigner.machineId') && !e.affectsConfiguration('fboDesigner.licenseKey')) {
        try {
          await syncMachineIdToSettings();
        } catch {
          // ignore
        }
        return;
      }
      try {
        const result = await applyLicenseFromSettings(context);
        const status = await getLicenseStatus(context);
        await setLicensedContext(!!status.active);
        if (result.applied && result.ok === false) {
          vscode.window.showErrorMessage(`FBO Designer: ${result.message}`);
        } else if (result.applied && result.ok) {
          vscode.window.showInformationMessage(`FBO Designer: ${result.message}`);
        }
      } catch (err) {
        await setLicensedContext(false);
        vscode.window.showErrorMessage(`FBO Designer license: ${err.message}`);
      }
    }),
  );

  return boot;
}

module.exports = {
  SECRET_KEY,
  getLicenseStatus,
  activateLicense,
  deactivateLicense,
  getMachineId,
  requireActiveLicense,
  ensureLicense,
  withLicense,
  lockedWebviewHtml,
  licenseDeniedText,
  loadLicenseMod,
  syncLicenseToSettings,
  syncMachineIdToSettings,
  applyLicenseFromSettings,
  initLicenseSettings,
};
