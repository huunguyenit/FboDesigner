// insight.mjs — «chế độ soi»: mỗi `&Name;` trong file chủ đi kèm ĐÚNG đoạn chữ mà nó bung ra,
// cộng file đã sinh ra đoạn ấy.
//
// Vì sao không dùng thẳng `declarations` của `expandEntities`: bản khai báo chỉ nói giá trị
// NGUYÊN VĂN của một entity, mà giá trị ấy thường lại chứa `&Name;` khác. Người đọc muốn thấy
// bản CUỐI CÙNG — thứ runtime thật sự nhận — nên phải lấy từ `clearText`, không phải từ chuỗi
// trong nháy.
//
// Cách lấy: `expand` đã đóng dấu lên mỗi đoạn của `clearText` cái tham chiếu NGOÀI CÙNG đã kéo
// nó vào (`seg.ref`, xem `entities.mjs`). Gom đoạn theo ĐỒNG NHẤT `ref` là ra dải clearText của
// từng `&Name;` trong file chủ — không phải đoán, không phải so nội dung.
//
// Ba trạng thái, và phải phân biệt được cả ba, vì chúng trông giống hệt nhau nếu chỉ nhìn
// «không có đoạn nào»:
//
//   resolved    có đoạn trong `clearText` — trường hợp thường.
//   empty       khai báo có, nhưng bung ra chuỗi rỗng. Đây là CÔNG TẮC TẮT của FBO
//               (`<!ENTITY E "">` đứng sau một marked section IGNORE), nên nói «rỗng» là nói
//               «nhánh này đang tắt» — thông tin đắt nhất của cả chế độ soi.
//   unresolved  không khai, hoặc khai trỏ tới file không đọc được. Runtime giữ nguyên văn.
//
// Thuần: không import fs, không biết gì về editor. Người gọi truyền `readFile`.

import { expandEntities, findInternalSubset, scanEntityRefs, resolveSystemPath } from './entities.mjs';

/** Độ dài tối đa của bản xem-một-dòng. Dài hơn thì cắt — tầng vỏ vẽ nó ngay trên dòng XML. */
const INLINE_MAX = 120;

/** Bản một dòng: nuốt mọi khoảng trắng liên tiếp. Attachment của editor không xuống dòng được. */
const flatten = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Khoá của một dải `&Name;` trong file chủ — dùng để bắt cặp ref ↔ đoạn clearText. */
const rangeKey = (start, end) => `${start}:${end}`;

/**
 * @param {string} text nội dung file chủ đã decode
 * @param {{filePath: string, readFile: (abs: string) => string|null, inlineMax?: number}} options
 * @returns {{hostFile: string, clearText: string, refs: Array, groups: Array<{file: string, refs: number}>, diagnostics: Array}}
 *
 * `clearText` là CẢ FILE đã bung — mọi entity, mọi Include lồng trong Include, không cắt ở đâu
 * cả. Trả ra ngoài vì đó là thứ duy nhất hiện được một bản bung nhiều dòng: chú giải trên dòng
 * của editor chỉ vẽ được MỘT dòng (VS Code cắt `contentText` ở dòng đầu), nên bản đầy đủ phải
 * sống trong một tài liệu thật. Không chứa DOCTYPE — cùng lý do với `expandEntities`.
 *
 * `segments` là bản đồ đoạn của `expandEntities`, trả kèm để tầng vỏ quy được MỘT VỊ TRÍ trong
 * `clearText` về file nguồn thật (`sourceRange`/`mapToSource`). Đó là điều kiện của `Ctrl+click`
 * trên bản đã bung: bấm vào một dòng đến từ Include thì phải mở ĐÚNG file Include ấy, đúng dòng
 * — mà `refs` chỉ biết dải của từng `&Name;`, không biết bên trong dải ấy chữ nào của file nào.
 *
 * Mỗi phần tử của `refs`:
 *   `name`, `start`, `end`   dải `&Name;` TRONG FILE CHỦ (offset, không phải dòng/cột)
 *   `outStart`, `outEnd`     dải tương ứng TRONG `clearText` — chỗ chữ nó đẻ ra thật sự nằm.
 *                            `null` khi không có đoạn nào (rỗng, hoặc không phân giải được).
 *   `status`                 'resolved' | 'empty' | 'unresolved'
 *   `origin`                 file mang nội dung: đích SYSTEM, hoặc file khai inline. `null` khi
 *                            không có khai báo.
 *   `originKind`             'system' | 'inline' | null
 *   `declFile`, `declStart`  chỗ đặt GIÁ TRỊ trong khai báo — đủ để nhảy tới, không phải dò lại
 *   `value`                  đoạn chữ ĐÃ BUNG HẾT, nguyên văn kể cả xuống dòng. KHÔNG cắt theo
 *                            số dòng: một Include bốn trăm dòng thì ở đây đủ bốn trăm dòng.
 *   `inline`                 bản một dòng, đã cắt theo `inlineMax`
 *   `firstLine`              dòng ĐẦU của `value`, đã cắt theo `inlineMax` — thứ tầng vỏ vẽ lên
 *                            dòng XML khi `value` nhiều dòng
 *   `truncated`              `inline` ngắn hơn sự thật
 *   `lines`                  số dòng của `value` (0 khi rỗng)
 *   `from`                   các file KHÁC file chủ đã góp chữ vào `value`, theo thứ tự gặp
 *   `group`                  chỉ số trong `groups` — tầng vỏ tô màu theo con số này; `-1` khi
 *                            không có nguồn nào để mà tô
 */
export function buildEntityInsight(text, { filePath, readFile, inlineMax = INLINE_MAX }) {
  const expanded = expandEntities(text, { filePath, readFile });
  const { clearText, segments, declarations, diagnostics } = expanded;

  /*
   * Dải clearText của từng tham chiếu ở FILE CHỦ.
   *
   * Lọc `ref.file === filePath` là chỗ loại đi tham chiếu lồng: `&A;` chứa `&B;` thì mọi đoạn
   * đều mang dấu của `&A;` (khung ngoài ghi đè khung trong), nên `&B;` không bao giờ xuất hiện
   * ở đây — đúng ý, vì trong file chủ người đọc chỉ nhìn thấy `&A;`.
   */
  const spans = new Map(); // ref object → { start, end, files[] }
  for (const s of segments) {
    if (!s.ref || s.ref.file !== filePath) continue;
    let g = spans.get(s.ref);
    if (!g) {
      g = { start: s.start, end: s.end, files: [] };
      spans.set(s.ref, g);
    } else {
      g.start = Math.min(g.start, s.start);
      g.end = Math.max(g.end, s.end);
    }
    if (s.file !== filePath && !g.files.includes(s.file)) g.files.push(s.file);
  }

  const byRange = new Map();
  for (const [ref, g] of spans) byRange.set(rangeKey(ref.start, ref.end), g);

  /*
   * «Khai SYSTEM nhưng không đọc được» phải tách khỏi «bung ra rỗng» — hai thứ cùng cho ra
   * không-đoạn-nào. Nhận diện bằng CHÍNH DẢI của cảnh báo: `entity.unread_system` neo đúng vào
   * `&Name;` trong file chủ (xem `entities.mjs`), nên không cần đọc lại đĩa để đoán.
   */
  const unread = new Set(
    diagnostics
      .filter((d) => d.code === 'entity.unread_system' && d.range && d.range.file === filePath)
      .map((d) => rangeKey(d.range.start, d.range.end)),
  );

  /*
   * Chỉ soi phần THÂN. `&Name;` nằm trong internal subset là một mẩu của GIÁ TRỊ đang được khai,
   * không phải chỗ dùng — vẽ chú giải lên đó là nói rằng khai báo đang bung, điều không xảy ra.
   */
  const subset = findInternalSubset(text);
  const raw = subset
    ? [...scanEntityRefs(text, 0, subset.doctypeStart), ...scanEntityRefs(text, subset.doctypeEnd)]
    : scanEntityRefs(text);

  const groups = [];
  const groupOf = new Map(); // file → chỉ số trong `groups`
  const refs = [];

  for (const r of raw) {
    const decl = declarations.get(r.name);
    const originKind = decl ? (decl.system !== null ? 'system' : 'inline') : null;
    const origin = decl
      ? (decl.system !== null ? resolveSystemPath(decl.file, decl.system) : decl.file)
      : null;

    const key = rangeKey(r.start, r.end);
    const span = byRange.get(key);
    const value = span ? clearText.slice(span.start, span.end) : '';

    let status;
    if (span) status = 'resolved';
    else if (!decl || unread.has(key)) status = 'unresolved';
    else status = 'empty';

    // Không phân giải được thì KHÔNG chiếm một màu: bảng màu là để phân biệt các nguồn có thật,
    // pha thêm một ô cho thứ không tồn tại là làm loãng đúng cái nó sinh ra để làm rõ.
    let group = -1;
    if (status !== 'unresolved' && origin) {
      if (!groupOf.has(origin)) {
        groupOf.set(origin, groups.length);
        groups.push({ file: origin, refs: 0 });
      }
      group = groupOf.get(origin);
      groups[group].refs++;
    }

    const flat = flatten(value);
    const truncated = flat.length > inlineMax;
    const cut = (s) => (s.length > inlineMax ? `${s.slice(0, inlineMax - 1)}…` : s);
    refs.push({
      name: r.name,
      start: r.start,
      end: r.end,
      outStart: span ? span.start : null,
      outEnd: span ? span.end : null,
      status,
      origin,
      originKind,
      declFile: decl ? decl.file : null,
      declStart: decl ? decl.valueStart : null,
      value,
      inline: cut(flat),
      // Dòng đầu, KHÔNG nuốt xuống dòng như `inline`: với giá trị nhiều dòng thì dòng đầu là
      // một dòng XML thật, còn bản nuốt-hết-khoảng-trắng là một chuỗi không có trong file nào.
      firstLine: cut(value.split('\n', 1)[0].trim()),
      truncated,
      lines: value === '' ? 0 : value.split('\n').length,
      from: span ? span.files : [],
      group,
    });
  }

  return {
    hostFile: filePath, clearText, segments, refs, groups, diagnostics,
  };
}
