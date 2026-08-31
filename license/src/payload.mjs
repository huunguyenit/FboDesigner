/**
 * License payload v1 — phần được ký trong License Key.
 *
 * {
 *   v: 1,
 *   id: "LIC-2026-00142",
 *   exp: "2027-12-31",          // hết hạn hết ngày UTC
 *   max: 3,                     // số máy tối đa
 *   mid: ["a1b2...", "c3d4..."], // optional: danh sách MachineID được phép
 *   co: "Cong ty ABC",
 *   note: "SP2422 team A",
 *   feat: ["designer", "sql"]
 * }
 *
 * Quy ước mid:
 * - Có `mid` (mảng không rỗng): hard-bind — chỉ các máy trong list được kích hoạt.
 *   Độ dài mid phải ≤ max. Đây là cách enforce offline đáng tin.
 * - Không có mid / mid rỗng: key “mở” — máy đầu tiên kích hoạt sẽ bind local;
 *   maxDevices lúc đó chỉ mang tính hợp đồng (copy key sang máy khác vẫn verify
 *   chữ ký được). Nội bộ công ty nên luôn điền mid khi phát hành.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePayload(input) {
  if (!input || typeof input !== 'object') throw new Error('payload phải là object');

  const v = input.v ?? 1;
  if (v !== 1) throw new Error(`schema version không hỗ trợ: ${v}`);

  const id = String(input.id || '').trim();
  if (!id) throw new Error('thiếu id');

  const exp = String(input.exp || '').trim();
  if (!DATE_RE.test(exp)) throw new Error('exp phải dạng YYYY-MM-DD');

  const max = Number(input.max);
  if (!Number.isInteger(max) || max < 1 || max > 999) {
    throw new Error('max phải là số nguyên 1..999');
  }

  const payload = { v: 1, id, exp, max };

  if (input.mid != null) {
    if (!Array.isArray(input.mid)) throw new Error('mid phải là mảng string');
    const mid = [...new Set(input.mid.map((x) => String(x).trim()).filter(Boolean))];
    if (mid.length > max) throw new Error(`mid có ${mid.length} máy nhưng max=${max}`);
    if (mid.length) payload.mid = mid;
  }

  if (input.co) payload.co = String(input.co).trim().slice(0, 120);
  if (input.note) payload.note = String(input.note).trim().slice(0, 200);
  if (input.feat != null) {
    if (!Array.isArray(input.feat)) throw new Error('feat phải là mảng string');
    payload.feat = input.feat.map((x) => String(x).trim()).filter(Boolean).slice(0, 32);
  }

  return payload;
}

/** Hết hạn = hết ngày UTC của exp (23:59:59.999Z). */
export function expireAtMs(exp) {
  return Date.parse(`${exp}T23:59:59.999Z`);
}

export function isExpired(exp, now = Date.now()) {
  return now > expireAtMs(exp);
}

export function daysLeft(exp, now = Date.now()) {
  const ms = expireAtMs(exp) - now;
  return Math.ceil(ms / 86_400_000);
}
