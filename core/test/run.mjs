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
import './test-move-free.mjs';
import './test-swap-split.mjs';
import './test-columns.mjs';
import './test-xml-comment.mjs';
import './test-css-scope.mjs';
import './test-filter-declare.mjs';
import './test-add-column.mjs';
import './test-sql-config.mjs';
import './test-lint.mjs';
import './test-format.mjs';
import './test-grid-sample.mjs';
import './test-grid-body.mjs';
import './test-outline.mjs';
import './test-definition.mjs';
import './test-insight.mjs';
import './test-mail-template.mjs';
import { summary } from './harness.mjs';

summary();
