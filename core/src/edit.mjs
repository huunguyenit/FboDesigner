// edit.mjs — biến một thao tác trên form thành MỘT splice lên văn bản nguồn.
//
// BARREL: file này (Phase 3 audit) không còn chứa logic — 3040 dòng gốc đã được chia theo cụm
// thành các file dưới đây, và file này chỉ re-export lại đúng bộ tên cũ để `core/src/index.mjs`
// và các test hiện có (`core/test/test-edit.mjs`, `test-columns.mjs`, `test-move-free.mjs`,
// `test-swap-split.mjs`) không phải đổi một dòng import nào:
//
//   edit-shared.mjs   helper THẬT SỰ dùng chung (reindentPattern, textPatch, sourceRow, …) —
//                     không export ra ngoài core, chỉ 4 file dưới đây tự import với nhau.
//   edit-row.mjs      MỘT HÀNG: resize/insert/remove/move/swap cùng hàng, thêm/bớt hàng/field.
//   edit-column.mjs   CỘT: cột lưới (thứ tự) + biên cột dùng chung của vùng form (tách/gộp).
//   edit-attr.mjs     Thuộc tính SỐ trên thẻ mở: chiều cao vùng/tab, anchor/split.
//   edit-move.mjs     DỜI/ĐỔI CHỖ TỰ DO xuyên hàng/vùng/tab — cụm lớn và liên kết chặt nhất.
//   edit-entity.mjs   Phân giải một `&Name;` vào file thiết kế.
//
// Luật an toàn của TOÀN BỘ tầng edit (áp dụng cho mọi file trên):
//
//   1. Sửa là splice `[start,end)` lên văn bản gốc, không phải "dựng lại file từ model".
//      Phần không đụng tới giữ nguyên từng byte: encoding, CRLF, thụt lề, comment, entity.
//      Đây là lý do `spans.mjs` cố công giữ vị trí ngay từ đầu.
//   2. Không chắc thì TỪ CHỐI. Một designer từ chối sửa làm người dùng khó chịu mười giây;
//      một designer sửa nhầm file dùng chung làm hỏng màn hình của khách khác.
//   3. Mọi hàm ở đây THUẦN. Đọc file, hỏi người dùng, áp WorkspaceEdit là việc của tầng vỏ.
//
// Hàm ở đây nhận `model` do `buildViewModel` dựng (đã có `rows[].range` trỏ về file nguồn) và
// trả `{ok, splice, file, warning}` — tầng vỏ chỉ việc áp.

export {
  canEditRow,
  rowEditTargetFile,
  planRowEdit,
  blankAnchorName,
  blankAnchorToken,
  blankAnchorField,
  blankAnchorIn,
  planAddRow,
  planAddField,
  planRemoveField,
} from './edit-row.mjs';

export {
  planColumnWidth,
  planRemoveColumn,
  planInsertColumn,
  planMoveColumn,
  regionColumnFiles,
  planRegionColumnWidth,
  planRegionColumns,
} from './edit-column.mjs';

export {
  planViewHeight,
  planRegionMetadata,
  planFieldRows,
} from './edit-attr.mjs';

export {
  planMoveControl,
  planMoveRowBlock,
  planSwapControl,
  planSwapBlock,
  moveControlFiles,
  planRemoveControl,
} from './edit-move.mjs';

export { planInlineEntity } from './edit-entity.mjs';
