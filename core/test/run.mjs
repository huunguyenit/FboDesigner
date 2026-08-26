#!/usr/bin/env node
// run.mjs — chạy toàn bộ test của core. Không cần npm install, không cần VS Code.
//
//   node core/test/run.mjs
//
// Exit 0 = sạch. Đây là bài kiểm tra duy nhất của core; giữ nó chạy được bằng node trần là
// một phần của luật "core không phụ thuộc gì" (ADR-0002).

import './test-encoding.mjs';
import './test-spans.mjs';
import './test-item-value.mjs';
import './test-program.mjs';
import './test-control.mjs';
import './test-entities.mjs';
import './test-render.mjs';
import './test-grid.mjs';
import './test-edit.mjs';
import { summary } from './harness.mjs';

summary();
