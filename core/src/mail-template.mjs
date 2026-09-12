// mail-template.mjs — quét và dựng HTML tham khảo cho một mẫu mail khai trong
// `App_Data\Controllers\Options\Message.xml`.
//
// Sơ đồ file (khác hẳn Dir/Grid/Filter): <message><mail><template> chứa nhiều
// <action id="…">, mỗi action có <fields> (bảng tra field → nhãn hiện) và một hoặc nhiều biến
// thể thân thư <body>, <body2>, <body3>… mỗi biến thể gồm <header>/<detail>/<footer>, mỗi phần
// bọc trong <text><![CDATA[ … ]]></text> — chính là mảnh HTML thật sẽ gửi đi.
//
// Bài toán quét khác hẳn `render.mjs`: CDATA ở đây mang HTML thật (`<html>`, `<tr>`, `<td>`…),
// nên khi tìm biên `<body>`/`</body>` KHÔNG được lẫn với thẻ `<body>` của chính bức mail nằm
// bên trong CDATA. Mọi hàm tìm thẻ ở file này vì thế đều che (mask) vùng CDATA/comment trước khi
// tìm — xem `maskRanges`.
//
// Việc gọi module này PHẢI đi sau `expandEntities` (core/src/entities.mjs): file khai `&CssClass;`,
// `&HeaderColor;`… và cả action injected qua `%…Message;` — chưa bung thì thiếu CSS, thiếu action.

/**
 * Vùng "đục" với bộ quét thẻ — comment và CDATA. Cùng kỹ thuật một-lượt của
 * `xml-comment.mjs#commentRanges`, gộp thêm CDATA vì nội dung trong đó là HTML thật, đầy thẻ
 * trùng tên với khung XML bên ngoài (`<body>` của action vs `<body>` của chính bức mail).
 *
 * CDATA không đóng hay comment không đóng: coi như "đục" tới hết chuỗi — đọc tiếp là chắc chắn
 * đọc nhầm cấu trúc.
 */
function maskRanges(text) {
  const ranges = [];
  const re = /<!\[CDATA\[|<!--/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '<![CDATA[') {
      const close = text.indexOf(']]>', m.index + 9);
      const end = close === -1 ? text.length : close + 3;
      ranges.push({ start: m.index, end });
      re.lastIndex = end;
    } else {
      const close = text.indexOf('-->', m.index + 4);
      const end = close === -1 ? text.length : close + 3;
      ranges.push({ start: m.index, end });
      re.lastIndex = end;
    }
  }
  return ranges;
}

/** Quét tuyến tính — số vùng CDATA/comment của một action đếm bằng chục, không cần nhị phân. */
function masked(ranges, index) {
  for (const r of ranges) {
    if (index < r.start) return false;
    if (index < r.end) return true;
  }
  return false;
}

/** Thuộc tính của một thẻ mở, dạng `name="value"` — đủ dùng cho schema message (không có thuộc
 * tính không nháy hay nháy đơn trong corpus này). */
function parseAttrs(openTag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(openTag)) !== null) out[m[1]] = m[2];
  return out;
}

/**
 * Thẻ ĐẦU TIÊN tên `name` không nằm trong vùng đục, kể từ `from`. `(?=[\s>])` chặn khớp nhầm
 * thẻ có tên là tiền tố — tìm `body` không được khớp `body2`.
 *
 * `to` (mặc định vô hạn) chặn khớp tràn sang phần tử ANH EM đứng sau — cần khi `text` là văn
 * bản TUYỆT ĐỐI của cả tài liệu (`locateMailSection` tìm theo toạ độ gốc, không cắt lát), nên
 * "tìm `<footer>` từ đây" phải dừng lại ở biên action/body đang xét, không lỡ vớ phải `<footer>`
 * của action kế tiếp khi action đang xét không có phần tử đó.
 */
function findOpenFrom(text, name, from, ranges, to = Infinity) {
  const re = new RegExp(`<${name}(?=[\\s>])[^>]*>`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) return null;
    if (!masked(ranges, m.index)) return m;
  }
  return null;
}

function findCloseFrom(text, name, from, ranges, to = Infinity) {
  const re = new RegExp(`</${name}(?=[\\s>])\\s*>`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) return -1;
    if (!masked(ranges, m.index)) return m.index;
  }
  return -1;
}

/**
 * Một thẻ `name` trọn vẹn (mở → đóng), tìm trong `text` kể từ `from` (và không vượt quá `to`,
 * xem `findOpenFrom`).
 *
 * KHÔNG đếm độ sâu lồng nhau: không thẻ nào trong schema message tự lồng vào chính nó
 * (`action` không nằm trong `action`, `body` không nằm trong `body`…), nên thẻ đóng ĐẦU TIÊN
 * gặp sau thẻ mở, ngoài vùng đục, chính là thẻ đóng đúng.
 *
 * `openStart` (đầu thẻ mở) tách riêng khỏi `contentStart` (sau thẻ mở) để người gọi chọn được
 * dải "cả thẻ" (`openStart`..`blockEnd`, dùng khi đi tới định nghĩa — muốn thấy nguyên
 * `<header>…</header>`) hay dải "chỉ nội dung" (`contentStart`..`contentEnd`, dùng khi trích chữ
 * bên trong như `sectionText`).
 *
 * @returns {{attrs, openStart, contentStart, contentEnd, blockEnd}|null}
 */
function findElement(text, name, from = 0, to = Infinity) {
  const ranges = maskRanges(text);
  const open = findOpenFrom(text, name, from, ranges, to);
  if (!open) return null;
  const contentStart = open.index + open[0].length;
  const contentEnd = findCloseFrom(text, name, contentStart, ranges, to);
  if (contentEnd === -1) return null;
  return {
    attrs: parseAttrs(open[0]),
    openStart: open.index,
    contentStart,
    contentEnd,
    blockEnd: contentEnd + text.slice(contentEnd).match(new RegExp(`^</${name}(?=[\\s>])\\s*>`))[0].length,
  };
}

/** Giải mã 5 entity dựng sẵn của XML trong MỘT lượt — đúng ngữ nghĩa khi một trình đọc XML thật
 * (`XmlNode.InnerText`) trả về giá trị chữ của một text node: giá trị đó đã qua giải mã entity,
 * kể cả entity lồng bên trong một entity tổng quát khác (`&CssClass;` chứa sẵn `&lt;head&gt;…`).
 * `expandEntities` (entities.mjs) CỐ TÌNH không làm việc này — nó phục vụ Dir/Grid/Filter, nơi
 * `&lt;` phải giữ nguyên làm CHỮ hiển thị (một field muốn hiện dấu "<"), không phải mở thẻ.
 * Ở đây thì ngược lại: nội dung là HTML thật sẽ gửi đi, nên `&lt;` phải trở lại thành `<` để
 * trình duyệt/ứng dụng mail vẽ ra thẻ, không phải chữ "&lt;" nằm trơ trên màn hình. */
function decodeXmlBuiltins(s) {
  return String(s ?? '').replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => (
    { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[name]
  ));
}

/** Escape một chuỗi CHỮ để chèn an toàn vào giữa markup/CDATA đã gỡ — bù lại đúng một lượt giải
 * mã của `decodeXmlBuiltins` chạy sau cùng, nên nhãn field chèn vào đây không thể bị hiểu nhầm
 * thành thẻ dù nó chứa `&`, `<`, `>` hay `"`. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BODY_NAME_RE = /^body\d*$/;

/** Mọi biến thể thân thư khai trực tiếp trong nội dung một action — `body`, `body2`, `body3`…
 * Không đếm bản nằm trong CDATA (HTML thật của mail có thể tự chứa chữ "body"). */
function scanBodyNames(actionContent) {
  const ranges = maskRanges(actionContent);
  const re = /<(body\d*)(?=[\s>])/g;
  const found = new Set();
  let m;
  while ((m = re.exec(actionContent)) !== null) {
    if (masked(ranges, m.index)) continue;
    if (BODY_NAME_RE.test(m[1])) found.add(m[1]);
  }
  return [...found].sort((a, b) => {
    const na = a === 'body' ? 0 : Number(a.slice(4));
    const nb = b === 'body' ? 0 : Number(b.slice(4));
    return na - nb;
  });
}

/** Bảng field → nhãn hiện (`<fields><field name="X"><header v="…" e="…"/></field></fields>`)
 * của một action. `<header>` có thể tự đóng hoặc mở/đóng — bắt cả hai bằng cách chỉ đọc tới
 * dấu `>` đầu tiên của thẻ mở, không cần biết nó tự đóng hay không. */
function scanFieldLabels(actionContent) {
  const map = new Map();
  const fields = findElement(actionContent, 'fields', 0);
  if (!fields) return map;
  const body = actionContent.slice(fields.contentStart, fields.contentEnd);
  const ranges = maskRanges(body);
  const openRe = /<field(?=[\s>])[^>]*>/g;
  let m;
  while ((m = openRe.exec(body)) !== null) {
    if (masked(ranges, m.index)) continue;
    const name = parseAttrs(m[0]).name;
    if (!name) continue;
    const contentStart = m.index + m[0].length;
    const contentEnd = findCloseFrom(body, 'field', contentStart, ranges);
    if (contentEnd === -1) continue;
    const fieldBody = body.slice(contentStart, contentEnd);
    const hm = /<header([^>]*)>/.exec(fieldBody);
    if (hm) {
      const hattrs = parseAttrs(`<header${hm[1]}>`);
      map.set(name, {
        v: decodeXmlBuiltins(hattrs.v ?? ''),
        e: decodeXmlBuiltins(hattrs.e ?? ''),
      });
    }
  }
  return map;
}

/**
 * Nội dung của `<message><mail><template>…</template></mail></message>` — PHẢI khoanh vùng vào
 * đây trước khi tìm `<action>`: file thật có thêm `<message><sms><template>…</template></sms>`
 * đứng SAU `</mail>`, cùng dùng thẻ `<action id="…">` nhưng thân hoàn toàn khác (`<content>` chữ
 * thường gửi SMS, không có `<body>`/`<fields><field><header>`). Qua ranh giới này thì mọi action
 * SMS lẫn vào danh sách chọn mẫu MAIL, và ngược lại — đo được trên `Options\Message.xml` của
 * HOATP: 22 action mail, 21 action sms, hai bộ trùng khá nhiều `id` (`PurchaseRequisition`,
 * `SOApproval`…) nên không thể phân biệt bằng id, chỉ phân biệt được bằng vị trí trong cây.
 *
 * @returns {string|null} nội dung `<template>` của `<mail>`, hoặc `null` nếu file không có cấu
 * trúc này (không phải Message.xml, hoặc thiếu `<mail>`/`<template>`).
 */
function mailTemplateScope(clearText) {
  const bounds = mailTemplateBounds(clearText);
  return bounds ? clearText.slice(bounds.start, bounds.end) : null;
}

/**
 * Như `mailTemplateScope`, nhưng trả TOẠ ĐỘ TUYỆT ĐỐI trong `clearText` thay vì cắt lát —
 * `locateMailSection` cần toạ độ gốc để sau đó quy về file nguồn qua `entities.mjs#sourceRange`
 * (map ấy đo từ đầu `clearText`, không phải từ đầu một lát đã cắt).
 */
function mailTemplateBounds(clearText) {
  const mail = findElement(clearText, 'mail', 0);
  if (!mail) return null;
  const template = findElement(clearText, 'template', mail.contentStart, mail.contentEnd);
  if (!template) return null;
  return { start: template.contentStart, end: template.contentEnd };
}

/** Thẻ `<tagName id="wantedId">` đầu tiên (không lồng — cùng giả định với `findElement`), tìm
 * bằng toạ độ tuyệt đối trong khoảng `[from, to)`. Tổng quát của `findActionByIdAbs` cũ — dùng
 * chung cho `<action id>`, và cho `<query id="report">`/`<command id="master|detail|footer">`
 * của `readMailReportCommands`, vốn khớp bằng `id` giữa nhiều thẻ ANH EM cùng tên chứ không phải
 * thẻ đầu tiên như `findElement`. */
function findTagByIdAbs(text, tagName, wantedId, from, to) {
  const ranges = maskRanges(text);
  const re = new RegExp(`<${tagName}(?=[\\s>])[^>]*>`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) return null;
    if (masked(ranges, m.index)) continue;
    if (parseAttrs(m[0]).id !== wantedId) continue;
    const contentStart = m.index + m[0].length;
    const contentEnd = findCloseFrom(text, tagName, contentStart, ranges, to);
    return contentEnd === -1 ? null : { contentStart, contentEnd };
  }
  return null;
}

/** `<action id="…">` khớp `id`, tìm bằng toạ độ tuyệt đối trong khoảng `[from, to)`. Tách khỏi
 * `renderMailPreview`/`scanMailActions` (cắt lát, toạ độ tương đối) vì `locateMailSection` cần
 * toạ độ gốc để đi tiếp qua `sourceRange`. */
function findActionByIdAbs(clearText, id, from, to) {
  return findTagByIdAbs(clearText, 'action', id, from, to);
}

/** Bóc CDATA, giữ nguyên phần còn lại — cùng quy tắc `grid-sample.mjs#stripCdata`, lặp lại ở đây
 * để `readMailReportCommands` không phải kéo theo cả `grid-sample.mjs` (file đó ngược lại có
 * import `mail-template.mjs`, xem `mail-sample.mjs`). */
function stripCdataText(text) {
  return String(text ?? '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
}

/**
 * SQL của MỘT `<command id="…">` bên trong `<query id="report">` — nội dung có thể bọc thêm một
 * lớp `<text>` (cùng khảo sát đã ghi ở `grid-sample.mjs#readControllerQuery`), và luôn bọc CDATA.
 */
function commandSql(text, contentStart, contentEnd) {
  const inner = text.slice(contentStart, contentEnd);
  const wrapped = /<text\s*>([\s\S]*?)<\/text>/i.exec(inner);
  const sql = stripCdataText(wrapped ? wrapped[1] : inner).trim();
  return sql === '' ? null : sql;
}

/**
 * Ba câu SQL của `<query id="report">` trong MỘT action — `master`/`detail`/`footer` — dùng để
 * lấy DỮ LIỆU MẪU THẬT cho mail (khác hẳn `<header>/<detail>/<footer>` của `<body>`, đó là KHUNG
 * HTML mẫu; đây là ba câu SQL runtime chạy trên database khách khi gửi mail thật, xem
 * `mail-sample.mjs` về cách dùng lại chúng cho một bản xem trước).
 *
 * @param {string} clearText văn bản Message.xml ĐÃ bung entity
 * @param {string} actionId
 * @returns {{ok:true, commands:{master:string|null, detail:string|null, footer:string|null}}
 *           |{ok:false, reason:string}}
 */
export function readMailReportCommands(clearText, actionId) {
  const bounds = mailTemplateBounds(clearText);
  if (!bounds) return { ok: false, reason: 'không tìm thấy <mail><template>' };

  const action = findActionByIdAbs(clearText, actionId, bounds.start, bounds.end);
  if (!action) return { ok: false, reason: `không tìm thấy action "${actionId}"` };

  const report = findTagByIdAbs(clearText, 'query', 'report', action.contentStart, action.contentEnd);
  if (!report) return { ok: false, reason: `action "${actionId}" không có <query id="report">` };

  const commands = {};
  for (const id of ['master', 'detail', 'footer']) {
    const cmd = findTagByIdAbs(clearText, 'command', id, report.contentStart, report.contentEnd);
    commands[id] = cmd ? commandSql(clearText, cmd.contentStart, cmd.contentEnd) : null;
  }
  if (!commands.master && !commands.detail && !commands.footer) {
    return { ok: false, reason: `<query id="report"> của "${actionId}" không có <command> nào đọc được` };
  }
  return { ok: true, commands };
}

const MAIL_SECTIONS = new Set(['header', 'detail', 'footer']);

/**
 * Toạ độ tuyệt đối trong `clearText` của trọn `<header>`/`<detail>`/`<footer>` (kể cả thẻ bao,
 * không chỉ phần chữ) cho một cặp (action, body) — dùng cho «đi tới định nghĩa»: người dùng bấm
 * nút tương ứng trên panel, host quy dải này về file nguồn qua `sourceRange` rồi mở đúng chỗ.
 *
 * KHÔNG trả về vị trí một token/hàng cụ thể bên trong: `header` của một body thường là NỬA ĐẦU
 * của một bảng HTML (mở `<table>`, hàng tiêu đề) còn `detail` là đúng MỘT `<tr>` mẫu lặp lại —
 * chúng không phải các khối DOM tách rời được sau khi ghép vào một trang, nên bấm vào một dòng
 * cụ thể trong bản xem không thể quy ngược về đúng phần tử schema nào đã sinh ra nó. Ba nút
 * header/detail/footer là mức chi tiết CAO NHẤT quy được mà không phải đoán.
 *
 * @param {string} clearText văn bản ĐÃ bung entity (`core.expandEntities(...).clearText`)
 * @param {{actionId: string, body: string, section: 'header'|'detail'|'footer'}} opts
 * @returns {{start:number, end:number}|null}
 */
export function locateMailSection(clearText, { actionId, body, section }) {
  if (!MAIL_SECTIONS.has(section)) return null;
  const bounds = mailTemplateBounds(clearText);
  if (!bounds) return null;

  const action = findActionByIdAbs(clearText, actionId, bounds.start, bounds.end);
  if (!action) return null;

  const bodyEl = findElement(clearText, body, action.contentStart, action.contentEnd);
  if (!bodyEl) return null;

  const sectionEl = findElement(clearText, section, bodyEl.contentStart, bodyEl.contentEnd);
  if (!sectionEl) return null;

  return { start: sectionEl.openStart, end: sectionEl.blockEnd };
}

/**
 * Toạ độ tuyệt đối của NỘI DUNG `<text>` bên trong `<header>`/`<detail>`/`<footer>` — chỗ HTML
 * thật của mail nằm (các mảnh CDATA xen với chữ entity đã bung). Email Designer
 * (`mail-html.mjs`) dựng dòng HTML từ đúng dải này; tách khỏi `sectionText` vì bên đó cắt lát và
 * bỏ dấu CDATA, còn designer cần toạ độ gốc để ghi ngược.
 *
 * @returns {{start:number, end:number}|null} `null` khi part vắng hoặc không có `<text>`
 */
export function locateMailText(clearText, { actionId, body, section }) {
  const loc = locateMailSection(clearText, { actionId, body, section });
  if (!loc) return null;
  const text = findElement(clearText, 'text', loc.start, loc.end);
  return text ? { start: text.contentStart, end: text.contentEnd } : null;
}

/** Bảng field → nhãn (`<fields>`) của một action, tìm theo toạ độ tuyệt đối — cho Email Designer
 * thay `{!h_…}` bằng nhãn giống hệt bản «Xem mail». */
export function mailActionLabels(clearText, actionId) {
  const bounds = mailTemplateBounds(clearText);
  if (!bounds) return new Map();
  const action = findActionByIdAbs(clearText, actionId, bounds.start, bounds.end);
  return action ? scanFieldLabels(clearText.slice(action.contentStart, action.contentEnd)) : new Map();
}

/**
 * Mọi `<action id="…">` ở tầng mail (bỏ qua `<sms>` — xem `mailTemplateScope`) — dùng để dựng
 * danh sách chọn mẫu mail.
 *
 * @param {string} clearText văn bản Message.xml ĐÃ bung entity (`core.expandEntities(...).clearText`)
 * @returns {Array<{id:string, table:string, v:string, e:string, bodies:string[]}>}
 */
export function scanMailActions(clearText) {
  const bounds = mailTemplateBounds(clearText);
  if (bounds === null) return [];
  const scope = clearText.slice(bounds.start, bounds.end);

  const ranges = maskRanges(scope);
  const actions = [];
  const re = /<action(?=[\s>])[^>]*>/g;
  let m;
  while ((m = re.exec(scope)) !== null) {
    if (masked(ranges, m.index)) continue;
    const attrs = parseAttrs(m[0]);
    if (!attrs.id) continue;
    const contentStart = m.index + m[0].length;
    const contentEnd = findCloseFrom(scope, 'action', contentStart, ranges);
    if (contentEnd === -1) continue;
    const content = scope.slice(contentStart, contentEnd);
    const bodies = scanBodyNames(content);
    // Action mail luôn có ít nhất một `<body…>` — khai chỉ để tiêm field/query dùng chung
    // (thấy trên corpus thật, đứng lẫn trong `<template>`) không có gì để xem, bỏ khỏi danh sách.
    if (bodies.length === 0) continue;
    // Toạ độ TUYỆT ĐỐI trong clearText: `mailLocationAt` cần chúng để nói con trỏ XML đang đứng ở
    // action/body nào — đó là thứ quyết định designer có phải đổi mẫu đang vẽ hay không.
    const contentStartAbs = bounds.start + contentStart;
    const contentEndAbs = bounds.start + contentEnd;
    actions.push({
      id: attrs.id,
      table: attrs.table ?? '',
      v: decodeXmlBuiltins(attrs.v ?? ''),
      e: decodeXmlBuiltins(attrs.e ?? ''),
      bodies,
      start: bounds.start + m.index,
      end: contentEndAbs + '</action>'.length,
      bodyRanges: bodies.map((body) => {
        const el = findElement(clearText, body, contentStartAbs, contentEndAbs);
        return el
          ? { body, start: el.openStart, end: el.blockEnd }
          : { body, start: contentStartAbs, end: contentStartAbs };
      }),
    });
  }
  return actions;
}

/**
 * Vị trí trong clearText → mẫu mail đang đứng ở đó. Con trỏ ở BẤT CỨ đâu trong `<action>` đều tính
 * (kể cả `<fields>` hay thuộc tính của thẻ mở); ngoài vùng body thì lấy biến thể đầu.
 *
 * @returns {{actionId:string, body:string}|null}
 */
export function mailLocationAt(clearText, clearOffset) {
  for (const a of scanMailActions(clearText)) {
    if (clearOffset < a.start || clearOffset > a.end) continue;
    const hit = a.bodyRanges.find((b) => clearOffset >= b.start && clearOffset < b.end);
    return { actionId: a.id, body: hit ? hit.body : a.bodies[0] };
  }
  return null;
}

/** Đường dẫn so được giữa editor và bản đồ đoạn — xem `mail-html.mjs#mailElementAtSource`. */
const locPathKey = (p) => String(p ?? '').replace(/\\/g, '/').toLowerCase();

/**
 * Con trỏ trong FILE NGUỒN → mẫu mail chứa nó. Action tiêm từ file Include cũng tính: bản đồ đoạn quy
 * vị trí nguồn về clearText trước, rồi mới hỏi `mailLocationAt`.
 *
 * @returns {{actionId:string, body:string}|null}
 */
export function mailLocationAtSource(clearText, segments, file, offset) {
  const key = locPathKey(file);
  for (const s of segments) {
    if (locPathKey(s.file) !== key || offset < s.sourceStart || offset > s.sourceEnd) continue;
    const hit = mailLocationAt(clearText, s.start + (offset - s.sourceStart));
    if (hit) return hit;
  }
  return null;
}

/** Nội dung chữ thật của `<header>|<detail>|<footer><text><![CDATA[ … ]]></text></…>` — bỏ mọi
 * dấu CDATA, giữ nguyên phần chữ nằm GIỮA hai lần CDATA (đó là chỗ một entity như `&CssClass;`
 * đã được bung thẳng vào, không phải markup của schema). `null` khi phần này không có trong
 * biến thể — `footer` đôi khi vắng ở body tối giản. */
function sectionText(bodyContent, sectionName) {
  const section = findElement(bodyContent, sectionName, 0);
  if (!section) return null;
  const sectionBody = bodyContent.slice(section.contentStart, section.contentEnd);
  const text = findElement(sectionBody, 'text', 0);
  if (!text) return null;
  return sectionBody.slice(text.contentStart, text.contentEnd).replace(/<!\[CDATA\[|\]\]>/g, '');
}

const TOKEN_RE = /\{!([A-Za-z_]\w*)\}/g;

/** Thay `{!name}` bằng nhãn hiện của field cùng tên (tiếng Việt hoặc Anh theo `vi`) — đúng luật
 * khai trong Message.xml: `mail@action@fields@field.name=X` → thay bằng `header@v|header@e`.
 * Token không khai trong `<fields>` (dữ liệu thật lúc gửi, vd `{!so_ct}`, `{!ma_vt}`) GIỮ NGUYÊN
 * — bản xem này không chạy query, không có gì để điền vào đó. */
export function substituteFieldTokens(text, labels, vi) {
  return text.replace(TOKEN_RE, (whole, name) => {
    const label = labels.get(name);
    if (!label) return whole;
    const value = vi ? (label.v || label.e) : (label.e || label.v);
    return value ? esc(value) : whole;
  });
}

/**
 * Gắn `data-fbo-col="N"` vào `<td>` của HÀNG TIÊU ĐỀ CỘT — dùng cho chế độ blueprint (kéo giãn
 * cột trực tiếp trên bản xem, xem `mail-preview-host.js`). Chỉ đánh dấu header: đó là nơi
 * `width:Npx` thật sự nằm trong corpus (detail thường dùng token class như `{!s0}`, chọn class
 * lúc chạy chứ không tự mang bề rộng — xem lời dẫn của `analyzeMailColumns`), nên chỉ header
 * mới là chỗ cần một tay cầm kéo.
 *
 * Thuộc tính chỉ là DỮ LIỆU cho tầng vỏ đọc qua DOM — trình duyệt bỏ qua khi vẽ, không đổi bất
 * kỳ điểm ảnh nào của bản xem. Vì vậy hàm này chạy TRÊN CHÍNH `header`/`detail` (còn nguyên
 * `{!field}`, trước khi thay nhãn) rồi mới nối chuỗi tiếp — thứ tự này không quan trọng với kết
 * quả cuối, nhưng làm trước thì offset của `findRows`/`findCells` đo trên đúng hai chuỗi độc
 * lập, không phải chuỗi đã nối (đỡ phải quy đổi offset qua ranh giới nối).
 *
 * Dùng LẠI đúng luật của `analyzeMailColumns` (đếm cột theo `<detail>`, tìm ngược lên `<header>`
 * hàng khớp số cột) — nhưng KHÔNG gọi thẳng nó, vì ở đây `header`/`detail` là hai CHUỖI RIÊNG
 * (toạ độ cục bộ của từng chuỗi), còn `analyzeMailColumns` đo theo toạ độ TUYỆT ĐỐI trong cả
 * `clearText`. Hai bài toán giống nhau về LUẬT, khác nhau về HỆ TOẠ ĐỘ.
 *
 * @returns {{header: string, detail: string}} bản đã gắn marker — nguyên văn nếu không suy được
 * cấu trúc cột (không phải lỗi, chỉ là mẫu này không hỗ trợ kéo giãn).
 */
function markColumnsForBlueprint(header, detail) {
  const detailRows = findRows(detail, 0, detail.length);
  if (detailRows.length !== 1) return { header, detail };
  const detailCells = findCells(detail, detailRows[0].contentStart, detailRows[0].contentEnd);
  if (detailCells.length === 0) return { header, detail };

  const headerRows = findRows(header, 0, header.length);
  let headerCells = null;
  for (let i = headerRows.length - 1; i >= 0; i--) {
    const cells = findCells(header, headerRows[i].contentStart, headerRows[i].contentEnd);
    if (cells.length === detailCells.length) { headerCells = cells; break; }
  }
  if (!headerCells) return { header, detail };

  // Chèn từ CUỐI lùi về đầu — offset của cột đứng trước không bị lệch bởi lần chèn vừa rồi.
  let markedHeader = header;
  for (let i = headerCells.length - 1; i >= 0; i--) {
    const insertAt = headerCells[i].openEnd - 1; // ngay trước dấu `>` đóng thẻ mở
    markedHeader = `${markedHeader.slice(0, insertAt)} data-fbo-col="${i}"${markedHeader.slice(insertAt)}`;
  }
  return { header: markedHeader, detail };
}

/**
 * Dựng HTML tham khảo cho một cặp (action, body) trong Message.xml.
 *
 * @param {string} clearText văn bản ĐÃ bung entity (xem `scanMailActions`)
 * @param {{actionId: string, body: string, vi?: boolean, blueprint?: boolean}} opts `blueprint`
 *   gắn thêm `data-fbo-col` vào `<td>` tiêu đề cột (xem `markColumnsForBlueprint`) — dùng cho
 *   chế độ kéo giãn cột trực tiếp trên bản xem, mặc định tắt để bản THAM KHẢO thường (so sánh,
 *   xuất…) không mang thuộc tính thừa nào.
 * @returns {{ok:true, html:string, action:{id,v,e}}|{ok:false, reason:string}}
 */
export function renderMailPreview(clearText, { actionId, body, vi = true, blueprint = false }) {
  const scope = mailTemplateScope(clearText);
  if (scope === null) return { ok: false, reason: 'Không tìm thấy <message><mail><template> trong file.' };

  const ranges = maskRanges(scope);
  const re = /<action(?=[\s>])[^>]*>/g;
  let action = null;
  let m;
  while ((m = re.exec(scope)) !== null) {
    if (masked(ranges, m.index)) continue;
    const attrs = parseAttrs(m[0]);
    if (attrs.id !== actionId) continue;
    const contentStart = m.index + m[0].length;
    const contentEnd = findCloseFrom(scope, 'action', contentStart, ranges);
    if (contentEnd === -1) return { ok: false, reason: `action "${actionId}" thiếu thẻ đóng </action>.` };
    action = { attrs, content: scope.slice(contentStart, contentEnd) };
    break;
  }
  if (!action) return { ok: false, reason: `Không tìm thấy action id="${actionId}".` };

  const bodyBlock = findElement(action.content, body, 0);
  if (!bodyBlock) return { ok: false, reason: `Action "${actionId}" không có "<${body}>".` };
  const bodyContent = action.content.slice(bodyBlock.contentStart, bodyBlock.contentEnd);

  let header = sectionText(bodyContent, 'header');
  let detail = sectionText(bodyContent, 'detail');
  const footer = sectionText(bodyContent, 'footer');
  if (header === null && detail === null && footer === null) {
    return { ok: false, reason: `"<${body}>" của action "${actionId}" không có header/detail/footer đọc được.` };
  }

  if (blueprint && header !== null && detail !== null) {
    ({ header, detail } = markColumnsForBlueprint(header, detail));
  }

  const labels = scanFieldLabels(action.content);
  const raw = [header, detail, footer].filter((s) => s !== null).join('\n');
  const html = decodeXmlBuiltins(substituteFieldTokens(raw, labels, vi));

  return {
    ok: true,
    html,
    action: {
      id: action.attrs.id,
      v: decodeXmlBuiltins(action.attrs.v ?? ''),
      e: decodeXmlBuiltins(action.attrs.e ?? ''),
    },
  };
}

/** File này có đúng schema mail template không — dùng để quyết định lệnh «Xem mail» có chạm
 * được vào file đang mở hay không, mà không phải bung entity trước (rẻ hơn, chạy trên văn bản
 * thô ngay khi người dùng bấm lệnh). */
export function isMailTemplateDoc(text) {
  return /<message\b[^>]*\sxmlns="urn:schemas-fast-com:data-message"/.test(String(text ?? ''));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Kéo giãn cột / thêm dòng / thêm cột — SỬA THẬT vào Message.xml.
//
// Khác hẳn phần dựng HTML tham khảo ở trên: đây là những hàm TRẢ VỀ KẾ HOẠCH SỬA (splice), theo
// đúng khuôn `core/src/edit.mjs` đã dùng cho Dir/Grid — `{ok:true, edits:[{start,end,text}]}`
// hay `{ok:false, reason}`. `start`/`end` là toạ độ trong CÙNG `clearText` đã bung entity;
// tầng vỏ tự quy về file nguồn qua `entities.mjs#sourceRange` (giống `locateMailSection`) rồi
// mới ghi — core không chạm filesystem (ADR-0002 của core).
//
// Vì sao KHÔNG đi qua CSS class dùng chung: nhiều mẫu mail đặt bề rộng cột bằng
// `<td class="r1">` với `.r1{width:50px}` khai MỘT LẦN cho hàng chục action khác nhau (xem
// `&CssClass;` ở đầu Message.xml). Nếu kéo giãn mà sửa thẳng luật `.r1` thì MỌI mail khác đang
// dùng `.r1` cũng đổi theo — một thao tác tưởng cục bộ lại có blast radius toàn file. Vì thế
// `analyzeMailColumns` CHỈ nhận cột có bề rộng khai TRỰC TIẾP bằng `style="width:Npx"` ngay
// trên `<td>` của hàng tiêu đề — cột dùng class dùng chung bị báo `width: null`, không cho kéo.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Mọi `<tr…>…</tr>` trong `[from, to)` — không đếm độ sâu (thẻ `tr` không tự lồng), và KHÔNG
 * cần che CDATA/comment: tới đây `text` đã là phần HTML THẬT bên trong `<header>`/`<detail>`/
 * `<footer>` (giữa các dấu CDATA, xem `locateMailSection`) — `tr`/`td` không phải tên thẻ
 * schema nào cả nên không thể lẫn, khác hẳn bài toán của `findElement`.
 */
function findRows(text, from, to) {
  const rows = [];
  const re = /<tr(?=[\s>])[^>]*>/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) break;
    const contentStart = m.index + m[0].length;
    const closeIdx = text.indexOf('</tr>', contentStart);
    if (closeIdx === -1 || closeIdx >= to) break;
    rows.push({
      rowStart: m.index, contentStart, contentEnd: closeIdx, rowEnd: closeIdx + '</tr>'.length,
    });
    re.lastIndex = rows.at(-1).rowEnd;
  }
  return rows;
}

/** Mọi `<td…>…</td>` trực tiếp trong `[from, to)` (thân một `<tr>`) — cùng lý do không cần che
 * CDATA như `findRows`. Giả định `<td>` luôn có cặp mở/đóng tường minh, đúng với mọi mẫu thấy
 * trong corpus thật (không viết `<td/>` tự đóng). */
function findCells(text, from, to) {
  const cells = [];
  const re = /<td(?=[\s>])[^>]*>/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) break;
    const contentStart = m.index + m[0].length;
    const closeIdx = text.indexOf('</td>', contentStart);
    if (closeIdx === -1 || closeIdx >= to) break;
    cells.push({
      tdStart: m.index, openEnd: contentStart, contentEnd: closeIdx, tdEnd: closeIdx + '</td>'.length,
    });
    re.lastIndex = cells.at(-1).tdEnd;
  }
  return cells;
}

const WIDTH_PX_RE = /width\s*:\s*(\d+)\s*px/;

/**
 * Cấu trúc cột của bảng chi tiết trong một (action, body) — nền cho cả kéo giãn cột lẫn thêm
 * cột. Neo vào `<detail>` để ĐẾM cột: nó luôn là ĐÚNG MỘT `<tr>` mẫu không colspan (khác
 * `<header>` có thể có nhiều hàng thông tin không liên quan tới bảng lưới, khác `<footer>`
 * thường colspan cho hàng tổng cộng) — số `<td>` của nó là con số ĐÁNG TIN CẬY nhất để biết
 * bảng có bao nhiêu cột. Sau đó tìm NGƯỢC LÊN `<header>`, lấy hàng `<tr>` GẦN `<detail>` nhất có
 * cùng số `<td>` — đó chính là hàng tiêu đề của bảng (những hàng đứng trước nó, như "Số phiếu:
 * …", là bảng thông tin khác, không phải bảng lưới).
 *
 * @param {string} clearText văn bản ĐÃ bung entity
 * @param {{actionId: string, body: string}} opts
 * @returns {{ok:true, columns: Array<{index:number, width:number|null}>}|{ok:false, reason:string}}
 */
export function analyzeMailColumns(clearText, { actionId, body }) {
  const detailLoc = locateMailSection(clearText, { actionId, body, section: 'detail' });
  if (!detailLoc) return { ok: false, reason: `Action "${actionId}" · <${body}> không có <detail> để phân tích cột.` };
  const headerLoc = locateMailSection(clearText, { actionId, body, section: 'header' });
  if (!headerLoc) return { ok: false, reason: `Action "${actionId}" · <${body}> không có <header> để phân tích cột.` };

  const detailRows = findRows(clearText, detailLoc.start, detailLoc.end);
  if (detailRows.length !== 1) {
    return {
      ok: false,
      reason: `<detail> phải có đúng một dòng mẫu để suy ra số cột (đang thấy ${detailRows.length}).`,
    };
  }
  const detailCells = findCells(clearText, detailRows[0].contentStart, detailRows[0].contentEnd);
  if (detailCells.length === 0) return { ok: false, reason: '<detail> không có ô (<td>) nào.' };

  const headerRows = findRows(clearText, headerLoc.start, headerLoc.end);
  let headerRow = null;
  let headerCells = null;
  for (let i = headerRows.length - 1; i >= 0; i--) {
    const cells = findCells(clearText, headerRows[i].contentStart, headerRows[i].contentEnd);
    if (cells.length === detailCells.length) { headerRow = headerRows[i]; headerCells = cells; break; }
  }
  if (!headerRow) {
    return {
      ok: false,
      reason: `Không tìm được dòng tiêu đề trong <header> khớp ${detailCells.length} cột của <detail> — tự sửa tay trong XML.`,
    };
  }

  const footerLoc = locateMailSection(clearText, { actionId, body, section: 'footer' });

  const columns = headerCells.map((headerCell, index) => {
    const openTagText = clearText.slice(headerCell.tdStart, headerCell.openEnd);
    const wm = WIDTH_PX_RE.exec(openTagText);
    let width = null;
    let widthSpan = null;
    if (wm) {
      width = Number(wm[1]);
      const digitsStart = headerCell.tdStart + wm.index + wm[0].lastIndexOf(wm[1]);
      widthSpan = { start: digitsStart, end: digitsStart + wm[1].length };
    }
    return {
      index, width, widthSpan, headerCell, detailCell: detailCells[index],
    };
  });

  return {
    ok: true, columns, headerRow, detailRow: detailRows[0], footerLoc,
  };
}

/**
 * Kế hoạch đổi bề rộng MỘT cột — chỉ ghi đè đúng dải CHỮ SỐ đã có trong `style="width:Npx"` của
 * `<td>` tiêu đề, không đụng gì khác (không suy luận qua class dùng chung — xem lời dẫn đầu
 * phần này).
 *
 * @returns {{ok:true, edits:Array<{start:number,end:number,text:string}>}|{ok:false, reason:string}}
 */
export function planResizeMailColumn(clearText, { actionId, body, columnIndex, width }) {
  if (!Number.isInteger(width) || width < 10 || width > 2000) {
    return { ok: false, reason: 'Bề rộng phải là số nguyên trong khoảng 10–2000px.' };
  }
  const analysis = analyzeMailColumns(clearText, { actionId, body });
  if (!analysis.ok) return analysis;
  const col = analysis.columns[columnIndex];
  if (!col) return { ok: false, reason: `Không có cột số ${columnIndex + 1}.` };
  if (!col.widthSpan) {
    return {
      ok: false,
      reason: `Cột ${columnIndex + 1} không khai "width:Npx" trực tiếp trên <td> (có thể đang dùng class CSS dùng chung) — không tự đổi an toàn được, tự sửa tay.`,
    };
  }
  return { ok: true, edits: [{ start: col.widthSpan.start, end: col.widthSpan.end, text: String(width) }] };
}

/**
 * Mọi dòng `<tr>` trong `<header>`/`<footer>` của một (action, body) — vật liệu cho «thêm dòng»:
 * người dùng chọn MỘT dòng có sẵn để nhân bản, không tự bịa ra một dòng trống (dòng trống không
 * biết mang field nào, đặt sai lại phải sửa tay còn mệt hơn). `<detail>` CỐ TÌNH không góp mặt —
 * đó là dòng MẪU LẶP LẠI theo từng bản ghi dữ liệu lúc gửi thật, nhân đôi nó là nhân đôi mọi dòng
 * dữ liệu của mọi lần gửi mail, không phải "thêm một dòng thông tin tĩnh" như người dùng muốn.
 *
 * @returns {Array<{section:'header'|'footer', rowIndex:number, start:number, end:number, preview:string}>}
 */
export function listMailRows(clearText, { actionId, body }) {
  const out = [];
  for (const section of ['header', 'footer']) {
    const loc = locateMailSection(clearText, { actionId, body, section });
    if (!loc) continue;
    const rows = findRows(clearText, loc.start, loc.end);
    rows.forEach((r, rowIndex) => {
      const raw = clearText.slice(r.rowStart, r.rowEnd).replace(/<!\[CDATA\[|\]\]>/g, '');
      out.push({
        section,
        rowIndex,
        start: r.rowStart,
        end: r.rowEnd,
        preview: raw.replace(/\s+/g, ' ').trim().slice(0, 140),
      });
    });
  }
  return out;
}

/**
 * Kế hoạch «thêm dòng»: chèn NGUYÊN VĂN một bản sao của dòng đã chọn, ngay sau chính nó — an
 * toàn theo cấu trúc (đang là markup hợp lệ thì bản sao cũng vậy), người dùng tự gõ lại field
 * mới trong bản sao đó (mở XML qua "Đi tới định nghĩa" ngay sau khi ghi).
 */
export function planAddMailRow(clearText, { actionId, body, section, rowIndex }) {
  const loc = locateMailSection(clearText, { actionId, body, section });
  if (!loc) return { ok: false, reason: `Action "${actionId}" · <${body}> không có <${section}>.` };
  const rows = findRows(clearText, loc.start, loc.end);
  const row = rows[rowIndex];
  if (!row) return { ok: false, reason: `<${section}> không có dòng số ${rowIndex + 1}.` };
  const clone = clearText.slice(row.rowStart, row.rowEnd);
  return { ok: true, edits: [{ start: row.rowEnd, end: row.rowEnd, text: clone }] };
}

const COLSPAN_RE = /colspan\s*=\s*"(\d+)"/;

/**
 * Kế hoạch «thêm cột»: nhân bản `<td>` của cột đã chọn, chèn NGAY SAU chính nó — ở CẢ hàng tiêu
 * đề (`<header>`) LẪN hàng dữ liệu mẫu (`<detail>`), để hai bên tiếp tục khớp số cột với nhau.
 * Bản sao giữ nguyên style/class của cột gốc (kể cả `width:Npx` nếu có) — người dùng đổi nội
 * dung ({!field}, nhãn) sau khi mở XML.
 *
 * `<footer>` (nếu có) thường không đi theo từng cột mà dùng `colspan` để gộp — cố hết sức tăng
 * con số đó thêm 1 để bảng không lệch tổng số cột; không thấy `colspan` nào thì BÁO RÕ trong
 * `notes` để người dùng tự kiểm, không âm thầm bỏ qua.
 */
export function planAddMailColumn(clearText, { actionId, body, columnIndex }) {
  const analysis = analyzeMailColumns(clearText, { actionId, body });
  if (!analysis.ok) return analysis;
  const col = analysis.columns[columnIndex];
  if (!col) return { ok: false, reason: `Không có cột số ${columnIndex + 1} để nhân bản.` };

  const headerCellText = clearText.slice(col.headerCell.tdStart, col.headerCell.tdEnd);
  const detailCellText = clearText.slice(col.detailCell.tdStart, col.detailCell.tdEnd);

  const edits = [
    { start: col.headerCell.tdEnd, end: col.headerCell.tdEnd, text: headerCellText },
    { start: col.detailCell.tdEnd, end: col.detailCell.tdEnd, text: detailCellText },
  ];

  const notes = [];
  if (analysis.footerLoc) {
    const footerRows = findRows(clearText, analysis.footerLoc.start, analysis.footerLoc.end);
    let bumped = false;
    for (const r of footerRows) {
      const rowText = clearText.slice(r.rowStart, r.rowEnd);
      const m = COLSPAN_RE.exec(rowText);
      if (!m) continue;
      const digitsStart = r.rowStart + m.index + m[0].lastIndexOf(m[1]);
      edits.push({ start: digitsStart, end: digitsStart + m[1].length, text: String(Number(m[1]) + 1) });
      bumped = true;
      break;
    }
    if (!bumped) {
      notes.push('Không thấy colspan trong <footer> để tự tăng theo — tự kiểm tra lại bố cục hàng tổng cộng.');
    }
  }

  return { ok: true, edits, notes };
}
