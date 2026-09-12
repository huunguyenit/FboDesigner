#!/usr/bin/env node
// run.mjs — test của TẦNG VỎ (extension), chạy bằng node trần.
//
//   node extension/test/run.mjs
//
// Đứng riêng khỏi `core/test/run.mjs` có chủ ý. Bộ test của core là bằng chứng sống cho luật
// "core không phụ thuộc gì" (ADR-0002): nó nạp được bằng node trần vì không có gì để giả lập.
// Tầng vỏ thì ngược lại — nó SỐNG bằng `vscode`, nên test của nó phải thay `vscode` bằng bản
// giả. Trộn hai thứ vào một file chạy là làm mờ đúng cái ranh giới mà ADR-0002 dựng lên.
//
// Dùng chung `core/test/harness.mjs` để output đọc giống hệt nhau.

/*
 * `import` TĨNH ở đây từng gây interleave thật: nhiều file (`test-sample-host.mjs`,
 * `test-mail-preview-host.mjs`…) tự `await import('../../core/src/index.mjs')` ở đầu file để nạp
 * core — một import ĐỘNG, nằm NGOÀI mọi quan hệ phụ thuộc tĩnh giữa các file test với nhau. Khi
 * hai file như vậy đứng cạnh nhau trong danh sách `import` tĩnh dưới đây, đặc tả ES module chỉ
 * đảm bảo thứ tự SUY RA TỪ ĐỒ THỊ PHỤ THUỘC — hai file không phụ thuộc nhau thì phần thân SAU
 * `await import` của chúng được phép chạy XEN KẼ. Cả hai cùng đọc/ghi một bàn điều khiển
 * `fake-vscode.mjs` DÙNG CHUNG (`window.answers.quickPick`, `window.panels`…), nên xen kẽ nghĩa
 * là file này `reset()` đúng lúc file kia đang giữa chừng — mỗi lần nổ ra một kiểu FAIL khác
 * nhau, trông như flaky nhưng không phải, và tái hiện ổn định nếu tách đúng hai file ra chạy
 * chung một tiến trình.
 *
 * Sửa bằng `await import(...)` TUẦN TỰ ở CHÍNH FILE NÀY: một import động được `await` thì lệnh
 * sau nó chỉ chạy khi toàn bộ file trước — kể cả `await` lồng bên trong nó — đã ổn định. Không
 * còn khoảng hở nào cho hai file xen vào nhau nữa.
 */
await import('./test-sql-host.mjs');
await import('./test-sql-host-exec.mjs');
await import('./test-date-mask.mjs');
await import('./test-diagnostic-host.mjs');
await import('./test-sample-store.mjs');
await import('./test-sample-render.mjs');
await import('./test-sample-host.mjs');
await import('./test-mail-sample-host.mjs');
await import('./test-language-host.mjs');
await import('./test-insight-host.mjs');
await import('./test-mail-preview-host.mjs');
await import('./test-mail-designer-editor.mjs');
const { summary } = await import('../../core/test/harness.mjs');

summary();
