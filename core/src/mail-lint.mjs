// mail-lint.mjs — kiểm HTML của mẫu mail theo luật MAIL CLIENT (Phase 8).
//
// Không phải bộ kiểm HTML chung. Mỗi luật ở đây là một thứ «trình duyệt vẽ đúng mà mail client vẽ
// sai», tức đúng loại lỗi bản xem của designer KHÔNG lộ ra: bản xem chạy trên Chromium, còn người
// nhận mở bằng Outlook (bộ vẽ Word), Gmail (gỡ bớt CSS, cắt thư lớn), hay ứng dụng chặn ảnh.
//
// Chỉ báo, không sửa hộ: mỗi vấn đề trỏ về phần tử (`elementId`) để designer chọn tới, người dùng quyết.

import { parseStyleDeclarations } from './mail-html.mjs';

/** Gmail cắt thư có HTML lớn hơn ~102 KB và hiện «[Thư đã bị cắt]». */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/** Mail client gỡ các thẻ này khi nhận — designer cũng không vẽ chúng (`renderMailDesign`). */
const BLOCKED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset', 'form']);

const RANK = { error: 0, warning: 1, info: 2 };

/** [kiểm (thuộc tính, giá trị), lời giải thích] — CSS trình duyệt hiểu mà mail client phổ biến bỏ. */
const CSS_RULES = [
  [(p, v) => p === 'display' && /\b(inline-)?(flex|grid)\b/i.test(v), 'display:flex/grid — Outlook (bộ vẽ Word) không hiểu, bố cục vỡ; dựng bố cục bằng bảng'],
  [(p) => p === 'position', 'position — Gmail và Outlook bỏ thuộc tính này; trong mail không định vị phần tử được'],
  [(p) => p === 'float', 'float — Outlook bỏ; dùng bảng hoặc thuộc tính align'],
  [(p, v) => (p === 'background' || p === 'background-image') && /url\s*\(/i.test(v), 'ảnh nền CSS — Outlook không hiện; dùng màu nền hoặc ảnh thật'],
];

/**
 * @returns {Array<{severity:'error'|'warning'|'info', code:string, message:string, elementId:string|null}>}
 *          lỗi trước, rồi cảnh báo, rồi gợi ý; cùng mức giữ thứ tự xuất hiện trong mẫu
 */
export function lintMailHtml(view, index) {
  const issues = [];
  const add = (severity, code, message, elementId = null) => issues.push({
    severity, code, message, elementId,
  });

  for (const w of index.warnings) add('error', 'mail.html-structure', `HTML sai cấu trúc: ${w}`);

  for (const el of index.elements) {
    if (BLOCKED_TAGS.has(el.tag)) {
      add('error', 'mail.blocked-tag', `<${el.tag}> — mail client gỡ bỏ khi nhận thư (designer cũng không vẽ)`, el.id);
      continue;
    }
    const attrs = new Map(el.attrs.map((a) => [a.name, a.value]));
    const events = el.attrs.filter((a) => a.name.startsWith('on')).map((a) => a.name);
    if (events.length > 0) add('error', 'mail.event-attr', `${events.join(', ')} — mã chạy trong mail luôn bị chặn, thuộc tính này không có tác dụng`, el.id);

    if (el.tag === 'img') {
      const src = attrs.get('src');
      if (typeof src !== 'string' || src.trim() === '') add('warning', 'mail.img-src', 'ảnh chưa có src', el.id);
      if (!attrs.has('alt')) add('warning', 'mail.img-alt', 'ảnh thiếu alt — mail chặn ảnh chỉ còn hiện chữ này, trình đọc màn hình cũng đọc nó', el.id);
      if (!attrs.has('width')) add('info', 'mail.img-width', 'ảnh thiếu thuộc tính width — Outlook vẽ theo kích thước gốc của file ảnh', el.id);
    }

    if (el.tag === 'a') {
      const href = attrs.get('href');
      if (typeof href !== 'string' || href.trim() === '' || href.trim() === '#') {
        add('warning', 'mail.link-empty', 'liên kết chưa có địa chỉ (href rỗng hoặc "#")', el.id);
      }
    }

    const style = attrs.get('style');
    if (typeof style === 'string') {
      for (const d of parseStyleDeclarations(style)) {
        for (const [test, message] of CSS_RULES) if (test(d.property, d.value)) add('warning', 'mail.css-support', message, el.id);
      }
    }
  }

  const bytes = new TextEncoder().encode(view.html).length;
  if (bytes > GMAIL_CLIP_BYTES) {
    add('warning', 'mail.size', `HTML khoảng ${Math.round(bytes / 1024)} KB — Gmail cắt thư lớn hơn 102 KB; lúc gửi, dòng detail còn nhân thêm`);
  }

  return issues
    .map((issue, order) => ({ issue, order }))
    .sort((a, b) => (RANK[a.issue.severity] - RANK[b.issue.severity]) || (a.order - b.order))
    .map(({ issue }) => issue);
}
