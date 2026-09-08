// test-date-mask.mjs — hành vi của `attachDateMask` (ô ngày có mặt nạ trong hộp thoại).
//
// `attachDateMask` sống trong CHUỖI HTML mà `dialog-panel.js` gửi cho webview — không phải một
// hàm export được, vì nó CHỈ chạy trong trình duyệt của webview, không qua `require()` nào cả.
// Bản test này TRÍCH đúng thân hàm ra khỏi nguồn (đếm ngoặc để lấy trọn khối), nạp nó bằng
// `vm.Script` với một `input` giả (đủ `getAttribute`/`addEventListener`/`selectionStart`), rồi
// gọi thẳng các listener đã đăng ký như trình duyệt sẽ làm khi người dùng gõ phím.
//
// Đây là DUY NHẤT cách kiểm được đoạn JS này mà không cần mở thật một webview.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ok, eq, section } from '../../core/test/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Đếm ngoặc `{}` để lấy TRỌN thân `function attachDateMask(input) { … }` từ nguồn thật. */
function extractAttachDateMask() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dialog', 'dialog-panel.js'), 'utf8');
  const start = src.indexOf('function attachDateMask');
  if (start === -1) throw new Error('không tìm thấy attachDateMask trong dialog-panel.js');
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('không đóng được ngoặc — trích hỏng');
  return src.slice(start, end);
}

/** Ô nhập giả — đủ bề mặt mà `attachDateMask` đụng tới, không hơn. */
function fakeInput(mask, initialValue = '') {
  const listeners = {};
  return {
    _value: initialValue,
    _mask: mask,
    selectionStart: 0,
    selectionEnd: 0,
    get value() { return this._value; },
    set value(v) { this._value = v; },
    getAttribute(name) { return name === 'data-field-mask' ? this._mask : null; },
    addEventListener(type, fn) { listeners[type] = fn; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    fire(type, event = {}) { listeners[type]?.({ preventDefault() {}, ...event }); },
  };
}

function attach(input) {
  const fnText = extractAttachDateMask();
  const script = new vm.Script(`(${fnText})`);
  const fn = script.runInThisContext();
  fn(input);
}

/** Gõ một chuỗi SỐ liên tục, mỗi ký tự một sự kiện `keydown` — mô phỏng người dùng gõ nhanh. */
function type(input, digits) {
  for (const d of digits) input.fire('keydown', { key: d });
}

section('date-mask — mặc định placeholder, giữ nguyên dấu phân cách');

const empty = fakeInput('dd/MM/yyyy', '');
attach(empty);
eq('trống thì hiện placeholder, giữ / /', empty.value, '__/__/____');

section('date-mask — gõ số tự nhảy vùng');

const typing = fakeInput('dd/MM/yyyy', '');
attach(typing);
typing.fire('focus');
type(typing, '0809202');
eq('đang gõ dở, vùng năm chưa đủ 4 số', typing.value, '08/09/202_');
type(typing, '6');
eq('gõ đủ tám số liền → 08/09/2026', typing.value, '08/09/2026');

section('date-mask — vào một vùng thì CHỈ vùng đó đổi');

const editMonth = fakeInput('dd/MM/yyyy', '08/09/2026');
attach(editMonth);
editMonth.selectionStart = 3; // click vào vùng tháng
editMonth.fire('click');
type(editMonth, '01');
eq('chỉ vùng tháng đổi, ngày và năm giữ nguyên', editMonth.value, '08/01/2026');

section('date-mask — bôi đen cả ô rồi Delete: giữ lại dấu phân cách');

const wiped = fakeInput('dd/MM/yyyy', '08/09/2026');
attach(wiped);
wiped.selectionStart = 0;
wiped.selectionEnd = 10;
wiped.fire('keydown', { key: 'Delete' });
eq('về placeholder, KHÔNG xoá trắng cả chuỗi', wiped.value, '__/__/____');

section('date-mask — Delete một vùng: chỉ vùng đang đứng bị xoá');

const wipedOne = fakeInput('dd/MM/yyyy', '08/09/2026');
attach(wipedOne);
wipedOne.selectionStart = 0;
wipedOne.selectionEnd = 2; // chỉ chọn vùng ngày
wipedOne.fire('keydown', { key: 'Backspace' });
eq('chỉ vùng ngày về placeholder', wipedOne.value, '__/09/2026');

section('date-mask — 30/02/2026 kẹp về 28/02/2026 (2026 không nhuận)');

const invalid = fakeInput('dd/MM/yyyy', '');
attach(invalid);
invalid.fire('focus');
type(invalid, '30022026');
eq('gõ đủ cả ba vùng liên tục → ngày kẹp về 28 (2026 không nhuận)', invalid.value, '28/02/2026');

section('date-mask — gõ NGÀY trước: chờ đủ tháng LẪN năm mới kẹp, không đoán giữa chừng');

/*
 * Đây là ca khó: kẹp là phép MỘT CHIỀU — ghi đè "30" xuống "28" mà năm hoá ra nhuận (29/02 có
 * thật) thì mất luôn "29" đúng, không lấy lại được. Nên ngày CHỜ đủ cả tháng lẫn năm mới kẹp,
 * dù tháng đã gõ xong trước.
 */
const laterMonth = fakeInput('dd/MM/yyyy', '');
attach(laterMonth);
laterMonth.fire('focus');
type(laterMonth, '30');
eq('ngày chưa bị kẹp vì tháng chưa có', laterMonth.value, '30/__/____');
type(laterMonth, '02');
eq('tháng xong nhưng NĂM chưa có: ngày vẫn CHƯA kẹp', laterMonth.value, '30/02/____');
type(laterMonth, '2026');
eq('năm xong (2026 không nhuận): NGÀY được xét lại, kẹp về 28', laterMonth.value, '28/02/2026');

section('date-mask — năm nhuận thì 29/02 giữ nguyên, không bị kẹp');

const leap = fakeInput('dd/MM/yyyy', '');
attach(leap);
leap.fire('focus');
type(leap, '29022024'); // 2024 nhuận — 29/02 có thật
eq('năm nhuận: 29/02 hợp lệ, không đổi', leap.value, '29/02/2024');

section('date-mask — blur cũng kẹp lại (đổi năm sau khi đã có 29/02)');

const changeYear = fakeInput('dd/MM/yyyy', '29/02/2024');
attach(changeYear);
changeYear.selectionStart = 6; // vào vùng năm
changeYear.fire('click');
type(changeYear, '2026'); // 2026 không nhuận — 29/02 không còn hợp lệ
changeYear.fire('blur');
eq('đổi sang năm không nhuận: ngày kẹp về 28/02', changeYear.value, '28/02/2026');

section('date-mask — mũi tên trái/phải chuyển vùng, không đổi giá trị');

const arrows = fakeInput('dd/MM/yyyy', '08/09/2026');
attach(arrows);
arrows.selectionStart = 0;
arrows.fire('focus');
arrows.fire('keydown', { key: 'ArrowRight' });
eq('ArrowRight sang vùng tháng, giá trị không đổi', [arrows.value, arrows.selectionStart, arrows.selectionEnd], ['08/09/2026', 3, 5]);

section('date-mask — mask rỗng hoặc field không phải ngày: không làm gì');

const noMask = fakeInput('', 'abc');
attach(noMask);
noMask.fire('focus');
type(noMask, '99');
eq('không có mặt nạ thì bỏ qua hoàn toàn', noMask.value, 'abc');
