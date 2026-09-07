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

import './test-diagnostic-host.mjs';
import './test-sample-store.mjs';
import './test-sample-render.mjs';
import './test-symbol-host.mjs';
import './test-definition-host.mjs';
import './test-language-host.mjs';
import { summary } from '../../core/test/harness.mjs';

summary();
