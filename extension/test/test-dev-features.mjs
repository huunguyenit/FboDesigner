// test-dev-features.mjs — Phase #1/#2 chỉ bật ở F5 hoặc ở bản `.vsix` đóng bằng `--dev`.
//
// Bốn ca, và ca THỨ TƯ là lý do cả module này tồn tại: một `.vsix` đóng BÌNH THƯỜNG (không
// `--dev`) phải là "hiện" — không mang bốn provider của Phase #1/#2. Sai một chữ ở đây là lộ
// tính năng chưa sẵn sàng ra cho mọi khách, không phải chỉ riêng bản dev.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, ...rest);
};

const { devFeaturesEnabled } = require_('../src/dev-features.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-devflag-'));
const flagFile = path.join(tmp, 'dev-features.flag');

section('dev-features — F5 (Development) và Extension Test Host (Test) luôn bật');
// Không có file đánh dấu nào ở đây — vẫn phải bật, vì đây là máy của người đang phát triển.
eq('Development → bật', devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Development }, { flagFile }), true);
eq('Test → bật', devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Test }, { flagFile }), true);

section('dev-features — Production (bản .vsix cài cho khách) theo đúng cờ file đánh dấu');
ok('chưa tạo file đánh dấu', !fs.existsSync(flagFile));
eq('Production, KHÔNG có cờ → ẩn (đây là ca mặc định của một bản .vsix bình thường)',
  devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Production }, { flagFile }), false);

fs.writeFileSync(flagFile, '', 'utf8');
eq('Production, CÓ cờ (đóng bằng --dev) → bật',
  devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Production }, { flagFile }), true);

section('dev-features — nội dung file đánh dấu không quan trọng, chỉ SỰ CÓ MẶT');
fs.writeFileSync(flagFile, 'bất cứ gì cũng được, kể cả rác', 'utf8');
eq('vẫn bật dù nội dung khác rỗng',
  devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Production }, { flagFile }), true);

section('dev-features — context thiếu/hỏng thì mặc định là ẨN, không phải bật đại');
/*
 * `extensionMode` không phải Development/Test thì phải rơi về kiểm tra file — kể cả khi
 * `context` là `undefined` hoặc thiếu thuộc tính. Một `context` méo mó không được vô tình mở
 * khoá tính năng ẩn; mặc định luôn nghiêng về phía ẨN.
 */
eq('context undefined → vẫn xét theo file (ở đây có cờ nên bật)', devFeaturesEnabled(undefined, { flagFile }), true);
fs.rmSync(flagFile, { force: true });
eq('context undefined, không có file → ẩn', devFeaturesEnabled(undefined, { flagFile }), false);
eq('context rỗng {} → ẩn (không có file)', devFeaturesEnabled({}, { flagFile }), false);

section('dev-features — dùng file đánh dấu THẬT (đường dẫn mặc định) khi không truyền opts');
// Không truyền `flagFile` → dùng `FLAG_FILE` thật (`extension/dev-features.flag`, cạnh
// `package.json`). Trong repo — chưa từng đóng gói --dev — file ấy không tồn tại, nên Production
// không có opts phải ra `false`. Đây là phép kiểm duy nhất chạm đường dẫn MẶC ĐỊNH thật sự.
eq('Production, mặc định (không truyền flagFile) → ẩn trong chính repo này',
  devFeaturesEnabled({ extensionMode: fakeVscode.ExtensionMode.Production }), false);

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = originalLoad;
