// form-edit-contract.mjs — cổng NHẸ cho message `{type:'edit', op, …}` gửi lên `handleEdit` của
// FBO Form/Grid designer (`extension/src/edit-host.js`) — KHÁC Email Designer, xem
// `mail-design-contract.mjs`.
//
// Vì sao "nhẹ": khác Email Designer (webview cầm DOM của mẫu mail do khách viết, nên hợp đồng
// phải khoá chặt từng thuộc tính CSS/HTML), webview của FBO designer chỉ gửi lại đúng
// `item`/`cell`/`region`/`column`/… mà CHÍNH NÓ vừa đọc từ `data-fbo-*` do host vẽ ra
// (`editTarget`/`gridColTarget` trong `media/designer.js` luôn `Number(...)` + `Number.isFinite`
// trước khi gọi `postEdit` — xem ghi chú ở đó). Nội dung splice luôn được `canEditRow`/
// `verifyPatches` so NGUYÊN VĂN với file thật trước khi ghi, nên sai kiểu ở đây không dẫn tới ghi
// sai chỗ — audit kiến trúc xác nhận đây KHÔNG phải lỗ hổng ghi nhầm.
//
// Khoảng trống THẬT mà cổng này đóng: trước đây `op` lạ rơi qua HOÀN TOÀN im lặng (nhánh
// `else { return false; }` cuối `handleEdit`, không log, không báo) — khác hẳn cách
// `mail-design-contract.mjs` luôn trả lý do rõ ràng cho mọi `op` không nhận diện được. Cổng này
// chỉ làm ĐÚNG việc đó — allow-list `op` + kiểm KIỂU của field định danh (item/cell/region/
// column/…) — KHÔNG lặp lại luật NỘI DUNG mà core (`edit*.mjs`) đã tự kiểm (biên độ width, cột/
// vùng có tồn tại, …); trùng luật ở hai nơi là chỗ chúng trôi khỏi nhau.

/** 18 `op` mà `handleEdit`/`handleColumnEdit`/`handleRegionColumnWidth`/`handleRegionColumns` nhận. */
export const FORM_EDIT_OPS = Object.freeze([
  // Cột LƯỚI — xem `handleColumnEdit`.
  'colWidth', 'colRemove', 'colInsert', 'colMove',
  // Biên cột dùng chung của một VÙNG FORM — xem `handleRegionColumns` / `handleRegionColumnWidth`.
  'colSplit', 'colMerge', 'colWidthRegion',
  // Thuộc tính số trên thẻ mở — xem `edit-attr.mjs`.
  'viewHeight', 'fieldRows', 'regionMeta',
  // Một hàng / dời / đổi chỗ — xem `edit-row.mjs` / `edit-move.mjs`.
  'remove', 'move', 'swap', 'swapBlock', 'moveBlock', 'resize', 'insert', 'addRow',
]);

const FORM_EDIT_OP_SET = new Set(FORM_EDIT_OPS);

export function isSupportedFormEditOp(op) {
  return FORM_EDIT_OP_SET.has(op);
}

const ok = () => ({ ok: true });
const bad = (reason) => ({ ok: false, reason });

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/**
 * Cổng cho MỘT `msg` đã biết chắc `type === 'edit'` (designer-session.js/mail-designer-editor.js
 * tự rẽ theo `type` trước khi gọi tới đây — xem `docs/EMAIL-DESIGNER.md` cho lý do "webview
 * không bao giờ gửi toạ độ", cùng nguyên lý áp cho cả hai designer).
 *
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function validateFormEditMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return bad('thông điệp sửa không phải object');
  }
  if (!isSupportedFormEditOp(msg.op)) {
    return bad(`op không hỗ trợ: ${String(msg.op).slice(0, 40)}`);
  }

  switch (msg.op) {
    // ── Cột lưới: định danh bằng (grid?, column). `grid` vắng nghĩa là "file lưới đang mở",
    // xem `gridModelFor` — nên không bắt buộc, chỉ bắt buộc khi CÓ mặt phải là chuỗi.
    case 'colWidth':
      if (!isNonEmptyString(msg.column)) return bad('colWidth: thiếu column');
      if (!isFiniteNumber(msg.width)) return bad('colWidth: width phải là số');
      return ok();
    case 'colRemove':
      if (!isNonEmptyString(msg.column)) return bad('colRemove: thiếu column');
      return ok();
    case 'colInsert':
      if (!isNonEmptyString(msg.column)) return bad('colInsert: thiếu column (cột neo)');
      return ok();
    case 'colMove': {
      if (!isNonEmptyString(msg.column)) return bad('colMove: thiếu column');
      const anchor = msg.anchor || msg.before || msg.after;
      if (!isNonEmptyString(anchor)) return bad('colMove: thiếu cột neo (anchor/before/after)');
      return ok();
    }

    // ── Biên cột của một vùng form: định danh bằng (region, col).
    case 'colSplit':
    case 'colMerge':
      if (!isNonEmptyString(msg.region)) return bad(`${msg.op}: thiếu region`);
      if (!isFiniteNumber(Number(msg.col))) return bad(`${msg.op}: col phải là số`);
      return ok();
    case 'colWidthRegion':
      if (!isNonEmptyString(msg.region)) return bad('colWidthRegion: thiếu region');
      if (!isFiniteNumber(Number(msg.col))) return bad('colWidthRegion: col phải là số');
      if (!isFiniteNumber(Number(msg.width))) return bad('colWidthRegion: width phải là số');
      return ok();

    // ── Thuộc tính số trên thẻ mở.
    case 'viewHeight':
      if (!isFiniteNumber(Number(msg.height))) return bad('viewHeight: height phải là số');
      return ok();
    case 'fieldRows':
      if (!isNonEmptyString(msg.field)) return bad('fieldRows: thiếu field');
      if (!isFiniteNumber(Number(msg.height))) return bad('fieldRows: height phải là số');
      return ok();
    case 'regionMeta':
      if (!isNonEmptyString(msg.region)) return bad('regionMeta: thiếu region');
      if (msg.attr !== 'anchor' && msg.attr !== 'split') return bad('regionMeta: attr phải là anchor | split');
      if (!isFiniteNumber(Number(msg.value))) return bad('regionMeta: value phải là số');
      return ok();

    // ── Một hàng / dời / đổi chỗ: định danh bằng (item, cell) — luôn là số nguyên thật, vì
    // webview tự đọc `data-fbo-item`/`data-fbo-cell` qua `Number()` + `Number.isFinite` trước
    // khi gọi `postEdit` (xem `editTarget` ở `media/designer.js`) — không phải luật MỚI, chỉ
    // đặt tên cho điều webview đã luôn đúng.
    case 'remove':
    case 'resize':
    case 'insert':
      if (!isFiniteNumber(msg.item)) return bad(`${msg.op}: item phải là số`);
      if (!isFiniteNumber(msg.cell)) return bad(`${msg.op}: cell phải là số`);
      return ok();
    case 'addRow':
      if (!isFiniteNumber(msg.item)) return bad('addRow: item phải là số');
      return ok();
    case 'move':
      if (!isFiniteNumber(msg.item)) return bad('move: item phải là số');
      if (!isFiniteNumber(msg.cell)) return bad('move: cell phải là số');
      if (msg.targets !== undefined && !Array.isArray(msg.targets)) return bad('move: targets phải là mảng');
      return ok();
    case 'swap':
      if (!isFiniteNumber(msg.item)) return bad('swap: item phải là số');
      if (!isFiniteNumber(msg.cell)) return bad('swap: cell phải là số');
      if (!isFiniteNumber(Number(msg.other))) return bad('swap: other phải là số');
      return ok();
    case 'swapBlock':
      if (!isFiniteNumber(Number(msg.a?.item)) || !isFiniteNumber(Number(msg.a?.col)) || !isFiniteNumber(Number(msg.a?.span))) {
        return bad('swapBlock: a.{item,col,span} phải là số');
      }
      if (!isFiniteNumber(Number(msg.b?.item)) || !isFiniteNumber(Number(msg.b?.col)) || !isFiniteNumber(Number(msg.b?.span))) {
        return bad('swapBlock: b.{item,col,span} phải là số');
      }
      return ok();
    case 'moveBlock':
      if (!Array.isArray(msg.items) || msg.items.length === 0) return bad('moveBlock: items phải là mảng không rỗng');
      if (!isFiniteNumber(Number(msg.toItem))) return bad('moveBlock: toItem phải là số');
      return ok();

    default:
      // Không tới được — mọi tên trong FORM_EDIT_OPS đều có case ở trên; giữ lại để tránh
      // "rơi qua im lặng" nếu có ai thêm tên vào danh sách mà quên thêm case.
      return bad(`op chưa có luật kiểm: ${msg.op}`);
  }
}
