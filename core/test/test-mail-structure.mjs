// test-mail-structure.mjs — xoá / di chuyển / chèn / bọc liên kết (Phase 5), kiểm bằng SỬA KHỨ HỒI.
//
// Như `test-mail-edit.mjs`: kế hoạch → quy về nguồn → áp vào văn bản nguồn → bung entity + dựng lại.
// Thêm một điều phải đúng: `selectId` của kế hoạch trỏ ĐÚNG phần tử người dùng đang cầm trong bản
// dựng lại — id là số thứ tự, và mọi phép ở đây làm dồn số.

import { section, eq, ok } from './harness.mjs';
import { mapMailEdits } from '../src/mail-html.mjs';
import {
  planMailRemove, planMailMove, planMailInsert, planMailWrapLink,
} from '../src/mail-structure.mjs';
import { INSERTABLE_COMPONENTS, componentHtml } from '../src/mail-components.mjs';
import {
  HOST, SHARED, SOURCE, SHARED_SOURCE, build, nth,
} from './test-mail-html.mjs';

const BASE = { [HOST]: SOURCE, [SHARED]: SHARED_SOURCE };

function roundTrip(plan, { actionId = 'Order' } = {}, files = BASE) {
  if (!plan.ok) return { ok: false, reason: plan.reason, noop: plan.noop };
  const { expanded, index } = build(files, { actionId });
  const mapped = mapMailEdits(expanded.segments, plan.edits);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  const next = { ...files };
  for (const e of [...mapped.edits].sort((a, b) => b.start - a.start)) {
    next[e.file] = next[e.file].slice(0, e.start) + e.text + next[e.file].slice(e.end);
  }
  const after = build(next, { actionId });
  return {
    ok: true, mapped, files: next, before: index, after, selected: plan.selectId ? after.index.byId.get(plan.selectId) : null,
  };
}

const planOn = (planFn, tag, n, args = {}, files = BASE, actionId = 'Order') => {
  const { view, index } = build(files, { actionId });
  const el = nth(index, tag, n);
  return planFn(view, index, { elementId: el.id, fingerprint: el.fingerprint, ...args });
};
const idOf = (tag, n = 0, files = BASE) => nth(build(files).index, tag, n).id;

section('mail structure — caps: chỗ chèn và anh em đổi chỗ');
{
  const { index } = build();
  const h2 = nth(index, 'h2');
  const p0 = nth(index, 'p', 0);
  eq('h2 là con đầu của body → không lên được, xuống đổi với <p>', h2.moveTargets, { up: null, down: p0.id });
  eq('h2 chèn trước/sau được, không chèn vào trong', [h2.insertPositions.before, h2.insertPositions.after, typeof h2.insertPositions.append], [true, true, 'string']);
  const td = nth(index, 'td', 1);
  eq('ô bảng: chèn vào cuối được', td.insertPositions.append, true);
  ok('ô bảng: không chèn cạnh', String(td.insertPositions.before).includes('không chèn cạnh'));
  eq('ảnh chưa bọc link → bọc được', nth(index, 'img', 0).caps.wrapLink, true);
  ok('ảnh đã trong <a> → không bọc lại', String(nth(index, 'img', 1).caps.wrapLink).includes('đã nằm'));
  ok('thẻ không phải ảnh → không bọc', String(h2.caps.wrapLink).includes('chỉ bọc'));
  eq('bảng mở header đóng footer vẫn là khung', nth(index, 'table').role, 'frame');
}

section('mail structure — xoá');
{
  const r = roundTrip(planOn(planMailRemove, 'p', 0));
  ok('xoá được', r.ok, r.reason);
  ok('bỏ cả dòng, không để dòng trắng', r.files[HOST].includes('</h2>\n<a href="{!alink}&n=1"') && !r.files[HOST].includes('Cảm ơn'));
  eq('bớt đúng một phần tử', r.after.index.elements.length, r.before.elements.length - 1);
  eq('chọn lại anh em đứng trước (h2)', r.selected.tag, 'h2');

  const withChild = roundTrip(planOn(planMailRemove, 'a', 1));
  ok('xoá liên kết kéo theo ảnh bên trong', withChild.ok && !withChild.files[HOST].includes('banner.png'), withChild.reason);
  eq('bớt cả cây (a + img)', withChild.after.index.elements.length, withChild.before.elements.length - 2);

  const td = planOn(planMailRemove, 'td', 1);
  ok('ô bảng → từ chối', !td.ok && td.reason.includes('hàng/ô bảng'));
  const frame = planOn(planMailRemove, 'body', 0);
  ok('khung tài liệu → từ chối', !frame.ok && frame.reason.includes('khung tài liệu'));

  const files = { ...BASE, [HOST]: SOURCE.replace('<p>Cảm ơn &amp; hẹn gặp lại</p>', '<p>Màu ]]>&HeaderColor;<![CDATA[ đẹp</p>') };
  const entity = planOn(planMailRemove, 'p', 0, {}, files);
  ok('phần tử chứa chữ do entity sinh ra → từ chối', !entity.ok && entity.reason.includes('entity'), entity.reason);
  eq('và anh em của nó không đổi chỗ qua nó', nth(build(files).index, 'h2').moveTargets.down, null);

  const shared = roundTrip(planOn(planMailRemove, 'p', 0, {}, BASE, 'Shared'), { actionId: 'Shared' });
  ok('action từ Include → xoá trong file Include', shared.ok && shared.mapped.edits[0].file === SHARED && shared.files[SHARED].includes('<![CDATA[<html><body>]]>'), shared.reason);
  eq('Message.xml không đổi', shared.files[HOST], SOURCE);
}

section('mail structure — di chuyển lên/xuống');
{
  const up = roundTrip(planOn(planMailMove, 'p', 0, { direction: 'up' }));
  ok('p lên trên h2', up.ok && up.files[HOST].includes('<body>\n<p>Cảm ơn &amp; hẹn gặp lại</p>\n<h2 class="title"'), up.reason);
  eq('số phần tử không đổi', up.after.index.elements.length, up.before.elements.length);
  eq('selectId đi theo <p>', up.selected.tag, 'p');
  ok('chỉ một splice', up.mapped.edits.length === 1);

  const down = roundTrip(planOn(planMailMove, 'h2', 0, { direction: 'down' }));
  ok('h2 xuống dưới p', down.ok && down.files[HOST].includes('<p>Cảm ơn &amp; hẹn gặp lại</p>\n<h2 class="title"'), down.reason);
  eq('selectId đi theo <h2>', down.selected.tag, 'h2');

  const linkDown = roundTrip(planOn(planMailMove, 'a', 1, { direction: 'down' }));
  ok('liên kết có ảnh con xuống dưới div', linkDown.ok, linkDown.reason);
  eq('selectId tính cả cây của anh em (div + a) → vẫn là <a> vừa di chuyển', [linkDown.selected.tag, linkDown.selected.children.length], ['a', 1]);

  const top = planOn(planMailMove, 'h2', 0, { direction: 'up' });
  ok('không có anh em phía trên → từ chối', !top.ok && top.reason.includes('phía trên'));
}

section('mail structure — kéo thả');
{
  const hrBefore = roundTrip(planOn(planMailMove, 'hr', 0, { targetId: idOf('h2'), position: 'before' }));
  ok('đường kẻ thả trước h2', hrBefore.ok && hrBefore.files[HOST].includes('<body>\n<hr style="border:0;border-top:1px solid #dddddd;"><h2 class="title"'), hrBefore.reason);
  ok('chỗ cũ không để dòng trắng', hrBefore.files[HOST].includes('</a></div>\n<div style="height:20px'));
  eq('hai edit: xoá chỗ cũ + chèn chỗ mới', hrBefore.mapped.edits.length, 2);
  eq('selectId đi theo <hr>', hrBefore.selected.tag, 'hr');
  eq('số phần tử không đổi', hrBefore.after.index.elements.length, hrBefore.before.elements.length);

  const intoTd = roundTrip(planOn(planMailMove, 'a', 0, { targetId: idOf('td', 1), position: 'append' }));
  ok('liên kết thả vào cuối ô bảng (cùng part header)', intoTd.ok && intoTd.files[HOST].includes('{!so_ct}<a href="{!alink}&n=1"'), intoTd.reason);
  eq('selectId đi theo <a>', intoTd.selected.tag, 'a');

  const self = planOn(planMailMove, 'a', 1, { targetId: idOf('img', 1), position: 'before' });
  ok('thả vào phần tử con của chính nó → từ chối', !self.ok && self.reason.includes('chính nó'));
  const cross = planOn(planMailMove, 'h2', 0, { targetId: idOf('td', 2), position: 'append' });
  ok('thả sang part khác (ô của detail) → từ chối', !cross.ok && cross.reason.includes('part'), cross.reason);
  const notFlow = planOn(planMailMove, 'h2', 0, { targetId: idOf('td', 1), position: 'before' });
  ok('thả cạnh ô bảng → từ chối', !notFlow.ok);
  const same = planOn(planMailMove, 'p', 0, { targetId: idOf('a', 0), position: 'before' });
  ok('thả đúng chỗ cũ → noop', !same.ok && same.noop === true);
}

section('mail structure — chèn component');
{
  const button = roundTrip(planOn(planMailInsert, 'h2', 0, { position: 'after', component: 'button' }));
  ok('nút chèn sau h2', button.ok && button.files[HOST].includes('</h2><table role="presentation" cellpadding="0"'), button.reason);
  eq('nút kiểu bảng: table + tr + td + a', button.after.index.elements.length, button.before.elements.length + 4);
  eq('chọn gốc vừa chèn: <table> là khối', [button.selected.tag, button.selected.role], ['table', 'block']);
  eq('<a> bên trong nhận là nút', button.after.index.byId.get(button.selected.children[0]).children.map((id) => button.after.index.byId.get(id))
    .flatMap((td) => td.children.map((id) => button.after.index.byId.get(id).kind)), ['button']);

  const intoTd = roundTrip(planOn(planMailInsert, 'td', 1, { position: 'append', component: 'text' }));
  ok('chữ chèn vào cuối ô bảng', intoTd.ok && intoTd.files[HOST].includes('{!so_ct}<p style="margin:0 0 12px;'), intoTd.reason);
  eq('chọn <p> vừa chèn', intoTd.selected.tag, 'p');

  for (const { kind } of INSERTABLE_COMPONENTS) {
    const r = roundTrip(planOn(planMailInsert, 'h2', 0, { position: 'after', component: kind }));
    const rootTag = /^<([a-z0-9]+)/.exec(componentHtml(kind))[1];
    ok(`chèn ${kind}: dựng lại sạch, chọn đúng <${rootTag}>`,
      r.ok && r.after.index.warnings.length === 0 && r.selected?.tag === rootTag && r.after.index.elements.length > r.before.elements.length, r.reason);
  }
  ok('không component nào mang "]]>"', INSERTABLE_COMPONENTS.every(({ kind }) => !componentHtml(kind).includes(']]>')));

  const beforeTd = planOn(planMailInsert, 'td', 1, { position: 'before', component: 'text' });
  ok('chèn cạnh ô bảng → từ chối', !beforeTd.ok);
  const variable = planOn(planMailInsert, 'h2', 0, { position: 'after', component: 'variable' });
  ok('component chưa có bộ sinh → từ chối', !variable.ok && variable.reason.includes('chưa hỗ trợ'));
}

section('mail structure — bọc liên kết cho ảnh');
{
  const r = roundTrip(planOn(planMailWrapLink, 'img', 0, { href: 'https://fast.com.vn' }));
  ok('bọc <a href> quanh ảnh', r.ok && r.files[HOST].includes('<a href="https://fast.com.vn"><img src="logo.png" data-fbo-el="e999"/></a>'), r.reason);
  eq('chọn lại chính ảnh, giờ nằm trong <a>', [r.selected.tag, r.after.index.byId.get(r.selected.parentId).tag], ['img', 'a']);

  const inside = planOn(planMailWrapLink, 'img', 1, { href: 'https://x.vn' });
  ok('ảnh đã có link → từ chối', !inside.ok);
  const js = planOn(planMailWrapLink, 'img', 0, { href: 'javascript:alert(1)' });
  ok('href chạy mã → từ chối', !js.ok);
}
