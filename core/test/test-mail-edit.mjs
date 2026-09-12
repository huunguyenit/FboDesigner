// test-mail-edit.mjs — kế hoạch sửa của Email Designer, kiểm bằng SỬA KHỨ HỒI.
//
// Mỗi ca: lập kế hoạch → quy về file nguồn (`mapMailEdits`) → áp vào VĂN BẢN NGUỒN → bung entity
// và dựng lại từ đầu → đọc lại. Không so chuỗi của kế hoạch: một kế hoạch "trông đúng" mà ghi
// lệch một ký tự chỉ lộ ra ở bước dựng lại. Kèm theo: mọi byte NGOÀI dải sửa phải giữ nguyên.

import { section, eq, ok } from './harness.mjs';
import { mapMailEdits, wireMailElements } from '../src/mail-html.mjs';
import {
  planMailText, planMailStyle, planMailAttr, escapeMailText,
} from '../src/mail-edit.mjs';
import {
  HOST, SHARED, SOURCE, SHARED_SOURCE, build, nth,
} from './test-mail-html.mjs';

const BASE = { [HOST]: SOURCE, [SHARED]: SHARED_SOURCE };

/** Áp kế hoạch, dựng lại. `changed` = file nào đổi và đổi đúng bao nhiêu ký tự. */
function roundTrip(plan, { actionId = 'Order' } = {}, files = BASE) {
  if (!plan.ok) return { ok: false, reason: plan.reason, noop: plan.noop };
  const { expanded } = build(files, { actionId });
  const mapped = mapMailEdits(expanded.segments, plan.edits);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  const next = { ...files };
  for (const e of [...mapped.edits].sort((a, b) => b.start - a.start)) {
    next[e.file] = next[e.file].slice(0, e.start) + e.text + next[e.file].slice(e.end);
  }
  const after = build(next, { actionId });
  return {
    ok: true, mapped, files: next, after, wire: wireMailElements(after.view, after.index),
  };
}

/** Hai văn bản chỉ khác nhau đúng ở một dải `[start, start+removed)` → `inserted`. */
function onlyChanged(before, after, { start, end, text }) {
  return after === before.slice(0, start) + text + before.slice(end);
}

const planOn = (planFn, tag, n, args, files = BASE, actionId = 'Order') => {
  const { view, index } = build(files, { actionId });
  const el = nth(index, tag, n);
  return planFn(view, index, { elementId: el.id, fingerprint: el.fingerprint, ...args });
};

section('mail edit — setText');
{
  const plan = planOn(planMailText, 'h2', 0, { value: 'Chào <bạn> & {!ten_kh}' });
  ok('lập được kế hoạch', plan.ok, plan.reason);
  eq('nhãn cho lịch sử hoàn tác', plan.label, 'mail: sửa chữ <h2>');
  const r = roundTrip(plan);
  ok('khứ hồi được', r.ok, r.reason);
  eq('đọc lại đúng chữ vừa gõ', r.wire.find((w) => w.tag === 'h2').text, 'Chào <bạn> & {!ten_kh}');
  ok('nguồn: HTML-escape, token nguyên văn, thụt lề giữ nguyên',
    r.files[HOST].includes('<h2 class="title" style="color:#333;">\n    Chào &lt;bạn&gt; &amp; {!ten_kh}\n</h2>'));
  ok('ngoài dải sửa không đổi một byte', onlyChanged(SOURCE, r.files[HOST], r.mapped.edits[0]));
  eq('file Include không bị đụng', r.files[SHARED], SHARED_SOURCE);
  eq('số phần tử không đổi → id đứng yên', r.after.index.elements.length, build().index.elements.length);
}
{
  const same = planOn(planMailText, 'h2', 0, { value: 'Xin chào {!ten_kh}' });
  ok('gõ lại y nguyên → noop, không phải lỗi', !same.ok && same.noop === true);

  const child = planOn(planMailText, 'p', 1, { value: 'x' });
  ok('phần tử có con → từ chối', !child.ok && child.reason.includes('phần tử con'));

  const empty = roundTrip(planOn(planMailText, 'p', 2, { value: 'Mới' }));
  ok('p rỗng → chèn chữ', empty.ok && empty.files[HOST].includes('<p>Mới</p>'), empty.reason);

  const nbsp = planOn(planMailText, 'p', 0, { value: `A${String.fromCharCode(160)}B` });
  ok('NBSP ghi thành &nbsp;', nbsp.ok && nbsp.edits[0].text === 'A&nbsp;B');
  eq('escape không đụng token', escapeMailText('{!a} <x>'), '{!a} &lt;x&gt;');

  const { view, index } = build();
  const h2 = nth(index, 'h2');
  const stale = planMailText(view, index, { elementId: h2.id, fingerprint: 'header|h2|<h2 khác>', value: 'x' });
  ok('fingerprint lệch → từ chối', !stale.ok && stale.reason.includes('đã đổi'));
  const gone = planMailText(view, index, { elementId: 'e9999', value: 'x' });
  ok('id không còn → từ chối', !gone.ok);

  const shared = roundTrip(planOn(planMailText, 'p', 0, { value: 'Chung mới' }, BASE, 'Shared'), { actionId: 'Shared' });
  ok('action tiêm từ Include → ghi vào file Include', shared.ok && shared.mapped.edits[0].file === SHARED, shared.reason);
  ok('file Include đổi đúng chữ, Message.xml giữ nguyên', shared.files[SHARED].includes('<p>Chung mới</p>') && shared.files[HOST] === SOURCE);
}

section('mail edit — setStyle');
{
  const upd = roundTrip(planOn(planMailStyle, 'h2', 0, { property: 'color', value: '#1677ff' }));
  ok('đổi khai báo có sẵn', upd.ok && upd.files[HOST].includes('<h2 class="title" style="color:#1677ff;">'), upd.reason);
  ok('chỉ đổi đúng dải giá trị', onlyChanged(SOURCE, upd.files[HOST], upd.mapped.edits[0]));

  const add = roundTrip(planOn(planMailStyle, 'h2', 0, { property: 'font-size', value: '18px' }));
  ok('thêm khai báo vào style có sẵn', add.ok && add.files[HOST].includes('style="color:#333;font-size:18px;"'), add.reason);
  eq('đọc lại qua webview', add.wire.find((w) => w.tag === 'h2').style, [['color', '#333'], ['font-size', '18px']]);

  const img = roundTrip(planOn(planMailStyle, 'img', 0, { property: 'width', value: '120px' }));
  ok('thẻ tự đóng chưa có style → chèn thuộc tính trước "/>"',
    img.ok && img.files[HOST].includes('<img src="logo.png" data-fbo-el="e999" style="width:120px;"/>'), img.reason);

  const rmOne = roundTrip(planOn(planMailStyle, 'a', 0, { property: 'color', value: '' }));
  ok('xoá một khai báo, giữ khai báo khác', rmOne.ok && rmOne.files[HOST].includes('style="display:{!slink};"'), rmOne.reason);

  const rmLast = roundTrip(planOn(planMailStyle, 'td', 3, { property: 'color', value: '' }));
  ok('xoá khai báo cuối → bỏ luôn thuộc tính style (nháy đơn)', rmLast.ok && rmLast.files[HOST].includes('<td>{!ten_vt}</td></tr>]]>'), rmLast.reason);

  const token = planOn(planMailStyle, 'a', 0, { property: 'text-decoration', value: 'none' });
  ok('khai báo khác trên phần tử có token vẫn thêm được', token.ok, token.reason);
  const display = planOn(planMailStyle, 'a', 0, { property: 'color', value: 'red' });
  ok('đổi color cạnh display:{!slink} được', display.ok, display.reason);

  const quote = planOn(planMailStyle, 'td', 3, { property: 'font-family', value: "'Segoe UI', Arial" });
  ok('giá trị có nháy đơn trong style nháy đơn → từ chối', !quote.ok && quote.reason.includes('dấu nháy'));

  const straddle = planOn(planMailStyle, 'td', 0, { property: 'color', value: 'red' });
  ok('style bị entity cắt ngang → từ chối', !straddle.ok && straddle.reason.includes('entity'));

  const notAllowed = planOn(planMailStyle, 'h2', 0, { property: 'position', value: 'fixed' });
  ok('thuộc tính ngoài danh sách → từ chối', !notAllowed.ok);
  const unsafe = planOn(planMailStyle, 'h2', 0, { property: 'color', value: 'red;display:none' });
  ok('giá trị không an toàn → từ chối', !unsafe.ok);
  const same = planOn(planMailStyle, 'h2', 0, { property: 'color', value: '#333' });
  ok('đặt lại đúng giá trị cũ → noop', !same.ok && same.noop === true);
}
section('mail edit — setAttr (Phase 4)');
{
  const alt = roundTrip(planOn(planMailAttr, 'img', 1, { name: 'alt', value: 'Banner mới' }));
  ok('đổi giá trị trong nháy', alt.ok && alt.files[HOST].includes('alt="Banner mới"'), alt.reason);
  eq('nhãn hoàn tác', planOn(planMailAttr, 'img', 1, { name: 'alt', value: 'x' }).label, 'mail: alt <img>');

  const width = roundTrip(planOn(planMailAttr, 'img', 1, { name: 'width', value: '480' }));
  ok('thuộc tính không nháy → ghi lại có nháy kép', width.ok && width.files[HOST].includes('<img src="banner.png" width="480" alt="Banner">'), width.reason);
  ok('chỉ đổi đúng dải giá trị', onlyChanged(SOURCE, width.files[HOST], width.mapped.edits[0]));
  eq('đọc lại qua webview', width.wire.find((w) => w.tag === 'img' && w.attrs.src === 'banner.png').attrs.width, '480');

  const add = roundTrip(planOn(planMailAttr, 'img', 1, { name: 'height', value: '120' }));
  ok('thêm thuộc tính chưa có', add.ok && add.files[HOST].includes('alt="Banner" height="120">'), add.reason);

  const rm = roundTrip(planOn(planMailAttr, 'img', 1, { name: 'alt', value: '' }));
  ok('xoá thuộc tính kèm khoảng trắng đứng trước', rm.ok && rm.files[HOST].includes('<img src="banner.png" width=600></a>'), rm.reason);

  const href = roundTrip(planOn(planMailAttr, 'a', 0, { name: 'href', value: '{!alink}&n=2' }));
  ok('href ghi nguyên văn: & không thành &amp;, token nguyên văn', href.ok && href.files[HOST].includes('href="{!alink}&n=2"'), href.reason);

  const link = roundTrip(planOn(planMailAttr, 'a', 1, { name: 'href', value: 'https://fast.com.vn/khuyen-mai' }));
  ok('link của ảnh = href của thẻ <a> cha', link.ok && link.files[HOST].includes('<a href="https://fast.com.vn/khuyen-mai"><img src="banner.png"'), link.reason);

  const align = roundTrip(planOn(planMailAttr, 'div', 0, { name: 'align', value: 'left' }));
  ok('căn lề nút = align của khối cha', align.ok && align.files[HOST].includes('<div align="left"><a href="{!order_url}"'), align.reason);

  const td = roundTrip(planOn(planMailAttr, 'td', 0, { name: 'align', value: 'center' }));
  ok('ô có style bị entity cắt vẫn thêm được align (sau dấu nháy, trong cdata)',
    td.ok && td.files[HOST].includes('<![CDATA[" align="center">{!h_so_ct}'), td.reason);

  const shared = roundTrip(planOn(planMailAttr, 'p', 0, { name: 'align', value: 'right' }, BASE, 'Shared'), { actionId: 'Shared' });
  ok('action tiêm từ Include → ghi vào file Include', shared.ok && shared.mapped.edits[0].file === SHARED && shared.files[SHARED].includes('<p align="right">Chung</p>'), shared.reason);
}
{
  const same = planOn(planMailAttr, 'img', 1, { name: 'alt', value: 'Banner' });
  ok('đặt lại đúng giá trị cũ → noop', !same.ok && same.noop === true);
  const h2 = planOn(planMailAttr, 'h2', 0, { name: 'align', value: 'center' });
  ok('thẻ không có whitelist → từ chối', !h2.ok);
  const wrongTag = planOn(planMailAttr, 'img', 1, { name: 'href', value: 'https://x.vn' });
  ok('thuộc tính không thuộc thẻ này → từ chối', !wrongTag.ok && wrongTag.reason.includes('không cho sửa'));
  const px = planOn(planMailAttr, 'img', 1, { name: 'width', value: '600px' });
  ok('sai kiểu (width có đơn vị) → từ chối', !px.ok && px.reason.includes('không hợp lệ'));
  const js = planOn(planMailAttr, 'a', 0, { name: 'href', value: 'javascript:alert(1)' });
  ok('URL chạy mã → từ chối', !js.ok);

  const files = { ...BASE, [HOST]: SOURCE.replace('<td style="width:100px;]]>&HeaderColor;<![CDATA[">', '<td width="]]>&HeaderColor;<![CDATA[">') };
  const locked = planOn(planMailAttr, 'td', 0, { name: 'width', value: '120' }, files);
  ok('thuộc tính bị entity cắt → từ chối kèm lý do', !locked.ok && locked.reason.includes('entity'), locked.reason);
}
{
  // `display` không nằm trong danh sách cho sửa, nên dựng biến thể mà token nằm ở thuộc tính CHO sửa.
  const files = { ...BASE, [HOST]: SOURCE.replace('style="display:{!slink};color:#003399;"', 'style="text-align:{!canh};color:#003399;"') };
  const { view, index } = build(files);
  const a = nth(index, 'a');
  const r = planMailStyle(view, index, { elementId: a.id, fingerprint: a.fingerprint, property: 'text-align', value: 'center' });
  ok('khai báo đang mang {!token} → từ chối', !r.ok && r.reason.includes('token'), r.reason);
  const hidden = planMailStyle(view, index, { elementId: a.id, property: 'display', value: 'block' });
  ok('thuộc tính ngoài danh sách bị chặn trước cả khi xét token', !hidden.ok && hidden.reason.includes('không cho sửa'));
}
