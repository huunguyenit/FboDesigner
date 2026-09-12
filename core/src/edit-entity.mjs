// edit-entity.mjs — phân giải MỘT `&Name;` vào chính file thiết kế. Tách từ edit.mjs (Phase 3
// audit) — đứng riêng vì không chia sẻ helper hay bị gọi bởi cụm nào khác trong edit.mjs.

import { msg } from './msg.mjs';

/**
 * PHÂN GIẢI một `&Name;` vào chính file thiết kế: comment dòng tham chiếu, chèn bản đã bung
 * ngay dưới.
 *
 * Đây là lối thoát cho ca «tôi muốn sửa hàng này, nhưng nó khai ở Include dùng chung». Hai
 * đường đi được, và chúng dẫn tới hai kết quả khác hẳn nhau:
 *
 *   sửa vào file gốc  → mọi controller include file đó cùng đổi theo
 *   phân giải vào đây → chỉ controller NÀY đổi; Include giữ nguyên cho người khác
 *
 * Dấu vết để lại phải đọc được bằng mắt, nên tham chiếu cũ được COMMENT chứ không xoá: người
 * đọc file sau này thấy ngay «chỗ này từng là `&Name;`, đã bung ra tại chỗ» và biết đường quay
 * lại. Xoá đi là biến một quyết định thành một sự trùng hợp.
 *
 * TỪ CHỐI khi dòng chứa `&Name;` còn thứ khác ngoài chính nó. Comment cả dòng khi ấy là tắt
 * luôn phần nội dung kia — hỏng im lặng, đúng thứ luật «không chắc thì từ chối» sinh ra để
 * chặn. Ca đó hiếm, và người dùng sửa tay được.
 *
 * @param hostText  văn bản file thiết kế (controller đang mở)
 * @param ref       {start,end} dải `&Name;` trong `hostText`
 * @param resolved  văn bản ĐÃ BUNG mà tham chiếu ấy sinh ra
 */
export function planInlineEntity(hostText, ref, resolved) {
  if (!ref || !(ref.end > ref.start) || ref.end > hostText.length) {
    return { ok: false, reason: msg('edit.entity_ref_unknown') };
  }
  const refText = hostText.slice(ref.start, ref.end);
  if (!/^&[A-Za-z_][\w.:-]*;$/.test(refText)) {
    return { ok: false, reason: msg('edit.entity_ref_mismatch', { refText }) };
  }

  const lineStart = hostText.lastIndexOf('\n', ref.start - 1) + 1;
  let lineEnd = hostText.indexOf('\n', ref.end);
  if (lineEnd === -1) lineEnd = hostText.length;
  else if (hostText[lineEnd - 1] === '\r') lineEnd -= 1;

  const line = hostText.slice(lineStart, lineEnd);
  if (line.trim() !== refText) {
    return {
      ok: false,
      reason: msg('edit.entity_line_has_extra', { p0: line.trim() })
        + ' Tách nó ra dòng riêng rồi thử lại.',
    };
  }

  const body = String(resolved ?? '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  if (body === '') return { ok: false, reason: msg('edit.entity_empty_resolve', { refText }) };

  const indent = /^[ \t]*/.exec(line)[0];
  const eol = hostText.includes('\r\n') ? '\r\n' : '\n';
  // Bản bung mang thụt lề của FILE GỐC. Chỉ kê lại dòng đầu nếu nó trần trụi — kê hết mọi dòng
  // là phá thụt lề tương đối bên trong khối, thứ nói ra cấu trúc của nó.
  const first = /^[ \t]/.test(body) ? '' : indent;
  const text = `${indent}<!-- ${refText} -->${eol}${first}${body.split(/\r?\n/).join(eol)}`;

  return { ok: true, splice: { start: lineStart, end: lineEnd, text } };
}
