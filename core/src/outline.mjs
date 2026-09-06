// outline.mjs — cấu trúc một file controller thành cây, cho `Ctrl+Shift+O` của editor.
//
// ═══ QUÉT VĂN BẢN THÔ, KHÔNG BUNG ENTITY ═══
//
// Đây là khác biệt quan trọng nhất giữa file này và mọi thứ đã làm cho chẩn đoán, và nó đi
// ngược lại thói quen vừa hình thành:
//
//   Chẩn đoán   hỏi «bản khai này SAI ở đâu» → phải bung entity, vì lỗi nằm ở hàng mà file này
//               kéo vào chứ không tự viết.
//   Outline     hỏi «FILE NÀY khai những gì» → tuyệt đối KHÔNG bung. Outline là mục lục của
//               tài liệu đang mở; liệt kê hai chục field đến từ một Include dùng chung là dựng
//               một mục lục cho một tài liệu không tồn tại, và bấm vào thì nhảy sang file khác.
//
// Hệ quả cố ý: một view mà mọi hàng đến từ `&Rows;` sẽ hiện ra đúng một nút `&Rows;`. Đó là câu
// trả lời THÀNH THẬT — file này thật sự chỉ khai có thế — và nó còn nói thêm một điều hữu ích:
// muốn sửa hàng thì phải sang file kia.
//
// Không có nút GỐC. VS Code đã hiện tên file ngay trên cây rồi; thêm một nút `<grid table="…">`
// bọc ngoài là một tầng phải bung ra mỗi lần mở, đổi lấy thông tin đã có sẵn ở nhãn tab.

import { scanViews, scanFields, scanToolbar } from './spans.mjs';
import { classifyItem, parseRow } from './item-value.mjs';
import { scanEntityRefs } from './entities.mjs';

function node(name, detail, kind, start, end, selStart, selEnd, children = []) {
  return {
    name,
    detail: detail ?? '',
    kind,
    start,
    end,
    // Dải CHỌN phải nằm TRONG dải phần tử — VS Code ném nếu không. Hụt hoặc thiếu thì lấy
    // trọn dải phần tử: rộng hơn mức cần, nhưng không bao giờ sai chỗ.
    selectionStart: Number.isFinite(selStart) && selStart >= start && selStart <= end ? selStart : start,
    selectionEnd: Number.isFinite(selEnd) && selEnd >= start && selEnd <= end ? selEnd : end,
    children,
  };
}

/** Nhãn của một `<header v e>` — ưu tiên tiếng Việt, rơi về English, rồi tới rỗng. */
const label = (h) => (h?.v || h?.e || '');

/** Cắt ngắn cho vừa một dòng cây, giữ đầu chuỗi vì đó là phần phân biệt được. */
function brief(s, max = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * `&Name;` khai TRỰC TIẾP trong ruột một view — hàng đến từ file khác.
 *
 * Bỏ qua tham chiếu nằm trong comment (cùng luật với mọi bộ quét khác) và thực thể dựng sẵn của
 * XML. Không đi tìm xem `&Name;` bung ra cái gì: đó là việc của designer, không phải của mục lục.
 */
function entityRefs(text, from, to) {
  return scanEntityRefs(text, from, to)
    .map((r) => node(`&${r.name};`, 'hàng đến từ file khác', 'reference', r.start, r.end));
}

/** Một `<item value>` của form: list px ở item đầu, còn lại là hàng control. */
function itemNode(item, indexInView) {
  const value = item.value ?? '';
  const span = item.valueSpan;
  if (classifyItem(value, indexInView) === 'widths') {
    return node(`cột: ${brief(value, 48)}`, 'list px của view', 'array',
      item.start, item.end, span?.start, span?.end);
  }
  const row = parseRow(value);
  const tokens = row.tokens.map((t) => t.raw).join(', ');
  return node(
    // Tên là DANH SÁCH TOKEN, không phải cả chuỗi `value`: pattern là toạ độ, token mới là thứ
    // người ta đi tìm khi mở mục lục ra («hàng nào có `ma_kh`?»).
    brief(tokens || '(hàng trống)'),
    row.pattern,
    'struct',
    item.start, item.end, span?.start, span?.end,
  );
}

/** Cây con của một `<view>` — form thì hàng, lưới thì cột. */
function viewChildren(text, view, fieldByName) {
  const children = [];

  view.items.forEach((item, i) => {
    if (item.value === null) return;
    children.push(itemNode(item, i));
  });

  for (const col of view.columns ?? []) {
    /*
     * `aliasName` tra từ khối `<fields>`, KHÔNG từ thẻ cột của view.
     *
     * Cột trong `<view>` chỉ liệt kê TÊN để xếp thứ tự; mọi thuộc tính của cột — `aliasName`,
     * `width`, `type` — khai ở `<fields>`. Đọc nhầm chỗ thì detail rỗng trơn trên mọi file
     * thật, và mục lục im lặng bỏ mất đúng thông tin đáng thấy nhất ở một lưới: cột này lấy dữ
     * liệu từ bảng nào.
     */
    const decl = fieldByName.get(col.name);
    const alias = decl?.attrs?.aliasName;
    children.push(node(col.name, alias ? `aliasName="${alias}"` : '',
      'field', col.start, col.end, col.attrSpans?.name?.start, col.attrSpans?.name?.end));
  }

  // Tham chiếu entity chỉ quét trong RUỘT view, không quét cả file: `&Name;` ở internal subset
  // là một KHAI BÁO, không phải một chỗ kéo hàng vào.
  children.push(...entityRefs(text, view.innerStart, view.innerEnd));

  if ((view.categories ?? []).length > 0) {
    const cats = view.categories.map((c) => node(
      `tab ${c.index}${label(c.header) ? ` — ${label(c.header)}` : ''}`,
      c.columns ? `columns="${brief(c.columns, 40)}"` : '',
      'object',
      c.start, c.end, c.attrSpans?.index?.start, c.attrSpans?.index?.end,
    ));
    // Nhóm `<categories>` không có dải riêng trong bộ quét — lấy từ tab đầu tới tab cuối. Đủ
    // đúng để bôi đen, và không phải thêm một bộ quét nữa chỉ để có hai con số.
    const first = view.categories[0];
    const last = view.categories[view.categories.length - 1];
    children.push(node(`categories (${cats.length})`, '', 'namespace',
      first.start, last.end, first.start, first.start, cats));
  }

  // Giữ đúng thứ tự XUẤT HIỆN trong file, không gom theo loại: mục lục phải đọc song song được
  // với văn bản, và người dùng cuộn cây để tìm chỗ mình vừa nhìn thấy trong XML.
  return children.sort((a, b) => a.start - b.start);
}

/**
 * @param {string} text văn bản controller THÔ (chưa bung entity)
 * @returns {Array<{name, detail, kind, start, end, selectionStart, selectionEnd, children}>}
 */
export function buildOutline(text) {
  const src = String(text ?? '');
  const out = [];

  const fields = scanFields(src);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  if (fields.length > 0) {
    const children = fields.map((f) => node(
      f.name,
      [label(f.header), f.attrs?.type, f.attrs?.width ? `${f.attrs.width}px` : '']
        .filter(Boolean).join(' · '),
      'field',
      f.start, f.end, f.attrSpans?.name?.start, f.attrSpans?.name?.end,
    ));
    out.push(node(`fields (${fields.length})`, '', 'namespace',
      children[0].start, children[children.length - 1].end,
      children[0].start, children[0].start, children));
  }

  for (const view of scanViews(src)) {
    const id = view.attrs?.id ?? '';
    out.push(node(
      `view${id ? ` "${id}"` : ''}`,
      view.attrs?.height ? `height="${view.attrs.height}"` : '',
      'class',
      view.start, view.end, view.attrSpans?.id?.start, view.attrSpans?.id?.end,
      viewChildren(src, view, fieldByName),
    ));
  }

  const buttons = scanToolbar(src);
  if (buttons.length > 0) {
    const children = buttons.map((b) => node(
      b.command || '(không có command)', label(b), 'event', b.start, b.end,
    ));
    out.push(node(`toolbar (${buttons.length})`, '', 'namespace',
      children[0].start, children[children.length - 1].end,
      children[0].start, children[0].start, children));
  }

  return out.sort((a, b) => a.start - b.start);
}
