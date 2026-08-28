// entities.mjs — phân giải DTD entity của controller FBO thành văn bản đã bung (clearText),
// kèm PROVENANCE: mỗi đoạn trong clearText đến từ file nào, offset nào.
//
// Cơ chế lấy theo `DevWorkFlow.Application/Language/EntitySymbolBinder.cs`. Bốn thứ phải làm
// đúng, thiếu một cái là ra kết quả sai mà vẫn chạy:
//
//   1. **Parameter entity** `<!ENTITY % X SYSTEM "…">` + `%X;` — kéo nguyên một file khai báo
//      vào internal subset. Đây là cách FBO gom hàng trăm entity theo module.
//   2. **Marked section** `<![%X;[ … ]]>` — công tắc bật/tắt cả mảng khai báo, trạng thái đọc
//      từ giá trị của parameter entity `%X;` (một file chứa đúng chữ INCLUDE hoặc IGNORE).
//      Đây là cách BI mode bật/tắt. Bỏ qua nó là bung cả nhánh lẽ ra phải tắt.
//   3. **First-wins.** XML quy định khai báo ĐẦU TIÊN thắng. FBO dựa hẳn vào luật này:
//      `<![%Cond;[ <!ENTITY E "có"> ]]> <!ENTITY E "">` — section bật thì E là "có", tắt thì
//      rơi xuống bản rỗng. Đổi thành last-wins là lộn ngược mọi công tắc.
//   4. **Không bịa.** Entity không tìm ra thì GIỮ NGUYÊN `&Name;` và ghi diagnostic.
//
// Thuần: không import fs. Người gọi truyền `readFile(absPath) -> string|null`.

import { commentSkipper } from './xml-comment.mjs';

const TOKEN_SOURCE = [
  // 1: marked section  <![ INCLUDE | IGNORE | %Name; [
  String.raw`<!\[\s*(%[\w.\-]+;|INCLUDE|IGNORE)\s*\[`,
  // 2..7: khai báo entity. Backreference phải là \4 (nháy của SYSTEM) và \6 (nháy của giá trị
  // inline) — đánh số theo TOÀN BỘ regex ghép, không theo riêng nhánh này. Viết \5 thì nhóm 5
  // không tham gia nhánh inline nên backreference khớp CHUỖI RỖNG: giá trị nuốt luôn dấu nháy
  // đóng, và giá trị nào có dấu `>` thì bị cắt ngang ở đó. Cả hai đều hỏng âm thầm.
  String.raw`<!ENTITY\s+(%\s+)?([A-Za-z_][\w.\-]*)\s+(?:SYSTEM\s+(["'])([\s\S]*?)\4|(["'])([\s\S]*?)\6)\s*>`,
  // 8: tham chiếu parameter entity ở mức khai báo
  String.raw`%([A-Za-z_][\w.\-]*);`,
].join('|');

const GENERAL_REF_SOURCE = String.raw`&([A-Za-z_][\w.\-]*);`;

// Regex `g` mang trạng thái `lastIndex`. `collect` và `expand` đều ĐỆ QUY, nên dùng chung một
// đối tượng regex là lần gọi trong giẫm lên con trỏ của lần gọi ngoài — thực tế cho vòng lặp
// vô tận, không phải kết quả sai lặt vặt. Mỗi lần gọi phải có regex riêng.
const tokenRegex = () => new RegExp(TOKEN_SOURCE, 'gi');
const generalRefRegex = () => new RegExp(GENERAL_REF_SOURCE, 'g');
const BUILTIN = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** Ghép đường dẫn SYSTEM tương đối theo THƯ MỤC CỦA FILE KHAI BÁO, không phải file gốc. */
export function resolveSystemPath(declaringFile, systemPath) {
  const sep = declaringFile.includes('\\') ? '\\' : '/';
  const unc = /^[\\/]{2}/.test(declaringFile);
  const dir = declaringFile.split(/[\\/]+/).filter((p) => p !== '').slice(0, -1);
  const stack = [...dir];
  for (const part of systemPath.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return (unc ? sep.repeat(2) : '') + stack.join(sep);
}

/** Vị trí của `]]>` khớp với một marked section mở, tính cả section lồng nhau. */
function findMarkedEnd(text, contentStart) {
  let depth = 1;
  let j = contentStart;
  while (j < text.length) {
    if (text.startsWith('<![', j)) { depth++; j += 3; }
    else if (text.startsWith(']]>', j)) { depth--; if (depth === 0) return j; j += 3; }
    else j++;
  }
  return -1;
}

/**
 * Tìm internal subset của DOCTYPE.
 *
 * KHÔNG dùng regex `\[[\s\S]*?\]\s*>`: subset chứa marked section kết thúc bằng `]]>`, và
 * regex đó dừng ngay ở dấu `]` thứ hai — cắt cụt subset đúng chỗ có công tắc BI mode.
 */
export function findInternalSubset(text) {
  const open = /<!DOCTYPE\s+[\w.:-]+/i.exec(text);
  if (!open) return null;

  const bracket = text.indexOf('[', open.index + open[0].length);
  if (bracket === -1) {
    const gt = text.indexOf('>', open.index);
    return gt === -1 ? null : { doctypeStart: open.index, subsetStart: -1, subsetEnd: -1, doctypeEnd: gt + 1 };
  }

  let j = bracket + 1;
  while (j < text.length) {
    if (text.startsWith('<![', j)) {
      const end = findMarkedEnd(text, j + 3);
      j = end === -1 ? text.length : end + 3;
    } else if (text[j] === ']') {
      const rest = /^\]\s*>/.exec(text.slice(j));
      if (rest) return { doctypeStart: open.index, subsetStart: bracket + 1, subsetEnd: j, doctypeEnd: j + rest[0].length };
      j++;
    } else j++;
  }
  return null;
}

class Context {
  constructor(readFile, diagnostics) {
    this.readFile = readFile;
    this.diagnostics = diagnostics;
    this.general = new Map();   // name -> {name, system, value, file, valueStart}
    this.params = new Map();
    this.fileStack = new Set();
    this.cache = new Map();
  }

  read(absPath) {
    if (this.cache.has(absPath)) return this.cache.get(absPath);
    let text = null;
    try { text = this.readFile(absPath); } catch { text = null; }
    this.cache.set(absPath, text);
    return text;
  }

  warn(message) {
    this.diagnostics.push({ severity: 'warn', message });
  }
}

/** Giá trị của một parameter entity: nội dung file SYSTEM, hoặc giá trị inline. */
function parameterValue(ctx, name, declaringFile) {
  const decl = ctx.params.get(name);
  if (!decl) return null;
  if (decl.system === null) return decl.value;
  const abs = resolveSystemPath(decl.file ?? declaringFile, decl.system);
  return ctx.read(abs);
}

/** INCLUDE / IGNORE / null (không rõ). Không rõ thì coi như INCLUDE — cùng lựa chọn với DWF. */
function markedStatus(ctx, raw, declaringFile) {
  const s = raw.trim();
  if (/^ignore$/i.test(s)) return 'IGNORE';
  if (/^include$/i.test(s)) return 'INCLUDE';
  if (!s.startsWith('%') || !s.endsWith(';')) return null;

  const value = parameterValue(ctx, s.slice(1, -1).trim(), declaringFile);
  if (value === null || value === undefined) return null;
  const v = value.replace(/^﻿/, '').trim();
  if (/^ignore$/i.test(v)) return 'IGNORE';
  if (/^include$/i.test(v)) return 'INCLUDE';
  return null;
}

/**
 * Quét tuần tự một khối khai báo, thu entity vào ctx.
 *
 * Tuần tự là bắt buộc, không phải tiện tay: trạng thái của một marked section phụ thuộc
 * parameter entity khai báo TRƯỚC nó. Gom hết khai báo rồi mới xét công tắc là xét bằng
 * thông tin của tương lai.
 */
/*
 * `base` — offset của `text` TRONG file `file`.
 *
 * Bắt buộc, vì `collect` gần như không bao giờ nhận cả file: nó nhận lát internal subset
 * (`text.slice(subsetStart, …)`), hoặc nhận giá trị của một parameter entity. `m.index` khi ấy
 * là offset trong LÁT, còn `valueStart` phải là offset trong FILE — cộng thiếu `base` là mọi
 * entity khai ở internal subset trỏ lệch đúng bằng vị trí của `<!DOCTYPE`.
 */
function collect(ctx, text, file, depth, base = 0) {
  if (depth > 32) { ctx.warn(`lồng entity quá sâu tại ${file}`); return; }

  /*
   * Khai báo nằm trong `<!-- … -->` KHÔNG tồn tại.
   *
   * Không có chốt này thì một `<!ENTITY X "cũ">` đã bị comment vẫn được ĐĂNG KÝ, và vì luật
   * first-wins nó còn THẮNG bản khai thật đứng sau — người viết file tưởng mình đã tắt một khai
   * báo, designer vẫn dùng nó. Đo được trên `Dir/Customer.xml` của HOATP.
   *
   * Cùng luật áp cho marked section và cho tham chiếu `%X;`: một `<![%Cond;[ … ]]>` bị comment
   * không được bật nhánh nào, và một `%X;` bị comment không được kéo file nào vào.
   */
  const skip = commentSkipper(text);
  const re = tokenRegex();
  let m;
  while ((m = re.exec(text)) !== null) {
    if (skip(m.index)) continue;
    const [, marked, param, name, , system, , inline] = m;

    if (marked !== undefined) {
      const contentStart = m.index + m[0].length;
      const end = findMarkedEnd(text, contentStart);
      if (end === -1) { ctx.warn(`marked section không đóng trong ${file}`); return; }
      if (markedStatus(ctx, marked, file) === 'IGNORE') re.lastIndex = end + 3;
      else re.lastIndex = contentStart; // INCLUDE hoặc không rõ: đi vào trong
      continue;
    }

    if (name !== undefined) {
      const target = param ? ctx.params : ctx.general;
      if (target.has(name)) continue; // FIRST-WINS — bản sau là bản dự phòng, không phải bản đè
      target.set(name, {
        name,
        system: system ?? null,
        value: inline ?? null,
        file,
        // Offset của GIÁ TRỊ trong nháy, không phải của `<!ENTITY`.
        //
        // Đây là gốc provenance của mọi entity inline: `expand` lấy đúng con số này làm
        // `sourceStart` cho đoạn văn bản mà `&Name;` bung ra. Trỏ vào `m.index` (đầu thẻ khai)
        // thì mọi thứ đến từ entity inline đều quy về ba ký tự `<!E`:
        //   · Ctrl+bấm một hàng viết bằng `&k;` nhảy vào giữa khối DOCTYPE
        //   · và mọi phép ghi ngược tự từ chối, vì văn bản tại range không khớp giá trị đang cầm
        //     — đúng lỗi «khai báo height trong file khác bản đã bung» của `Dir/Customer.xml`,
        //     nơi `height="&BI.Dir.Height;"` với `<!ENTITY BI.Dir.Height "302">` nằm ở Include.
        //
        // Cách đo: nháy ĐÓNG là lần xuất hiện CUỐI của ký tự nháy trong cả khớp — giá trị không
        // thể chứa chính ký tự nháy đang bao nó (regex dừng ở backreference). Lùi lại đúng độ
        // dài giá trị là ra đầu giá trị, không phụ thuộc khoảng trắng hay `\s*>` ở đuôi.
        valueStart: base + (inline === undefined
          ? m.index
          : m.index + m[0].lastIndexOf(m[6]) - inline.length),
      });
      continue;
    }

    const ref = m[8];
    if (ref === undefined) continue;

    const decl = ctx.params.get(ref);
    if (!decl) { ctx.warn(`%${ref}; chưa khai báo (tại ${file})`); continue; }

    // Giá trị inline của một parameter entity nằm ngay tại `decl.valueStart` trong file khai nó.
    if (decl.system === null) { collect(ctx, decl.value ?? '', decl.file ?? file, depth + 1, decl.valueStart); continue; }

    const abs = resolveSystemPath(decl.file ?? file, decl.system);
    if (ctx.fileStack.has(abs)) { ctx.warn(`vòng lặp include: ${abs}`); continue; }
    const body = ctx.read(abs);
    if (body === null) { ctx.warn(`không đọc được ${abs} (khai ở ${file})`); continue; }

    ctx.fileStack.add(abs);
    collect(ctx, body, abs, depth + 1);
    ctx.fileStack.delete(abs);
  }
}

/** Bung `&Name;` trong một đoạn văn bản, vừa nối chuỗi vừa ghi lại provenance từng đoạn. */
function expand(ctx, text, file, baseOffset, out, segments, stack, depth) {
  if (depth > 32) { ctx.warn(`bung entity quá sâu tại ${file}`); out.push(text); return; }

  /*
   * `&Name;` nằm trong `<!-- … -->` thì KHÔNG bung.
   *
   * Đây mới là vế nặng của lỗi «entity đã comment vẫn bị đọc vào», và nó khác hẳn vế khai báo ở
   * `collect`. Ca thật, `Dir/Customer.xml` của HOATP, ngay sau `<views>`:
   *
   *     <!-- &BI.Form.View.Customer; -->
   *
   * Entity ấy bung ra NGUYÊN MỘT khối `<view>`. Bung nó là chèn cả cái view đã bị tắt vào
   * `clearText`, rồi `scanViews` nhặt phải nó và designer vẽ nhầm view — trong khi file thì rõ
   * ràng đã comment.
   *
   * Giữ nguyên `&Name;` thì dấu comment còn nguyên trong `clearText`, và `scanViews` (cũng đã
   * biết bỏ comment) đi qua nó. Hai chốt cùng một luật, ở hai tầng.
   */
  const skip = commentSkipper(text);
  const re = generalRefRegex();
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (BUILTIN.has(name.toLowerCase())) continue;
    if (skip(m.index)) continue;

    const decl = ctx.general.get(name);
    if (!decl) {
      // Không biết thì để nguyên. Bịa một giá trị rỗng là làm biến mất một hàng mà không ai hay.
      ctx.diagnostics.push({ severity: 'error', message: `&${name}; không có khai báo — giữ nguyên` });
      continue;
    }
    if (stack.has(name)) {
      ctx.warn(`entity đệ quy: &${name};`);
      continue;
    }

    emit(out, segments, text.slice(last, m.index), file, baseOffset + last);
    last = m.index + m[0].length;

    let body;
    let bodyFile;
    let bodyOffset;
    if (decl.system === null) {
      body = decl.value ?? '';
      bodyFile = decl.file;
      bodyOffset = decl.valueStart;
    } else {
      const abs = resolveSystemPath(decl.file, decl.system);
      body = ctx.read(abs);
      bodyFile = abs;
      bodyOffset = 0;
      if (body === null) {
        ctx.diagnostics.push({ severity: 'error', message: `&${name}; trỏ tới ${abs} nhưng không đọc được` });
        emit(out, segments, m[0], file, baseOffset + m.index);
        continue;
      }
    }

    // Ghi lại CHỖ THAM CHIẾU ngay tại đây, không dựng lại từ các đoạn hàng xóm về sau.
    //
    // Mọi đoạn do lần bung này sinh ra đều được đóng dấu `&name;` đã kéo chúng vào. Đệ quy mở
    // ra rồi cuộn ngược lại, nên khung NGOÀI ghi đè khung trong — đoạn cuối cùng còn lại là
    // tham chiếu ở file NGOÀI CÙNG, tức đúng cái `&Name;` nằm trong controller đang mở.
    const mark = segments.length;
    stack.add(name);
    expand(ctx, body, bodyFile, bodyOffset, out, segments, stack, depth + 1);
    stack.delete(name);
    const ref = { file, start: baseOffset + m.index, end: baseOffset + m.index + m[0].length };
    for (let i = mark; i < segments.length; i++) segments[i].ref = ref;
  }
  emit(out, segments, text.slice(last), file, baseOffset + last);
}

function emit(out, segments, chunk, file, sourceStart) {
  if (chunk === '') return;
  const start = segments.length === 0 ? 0 : segments[segments.length - 1].end;
  segments.push({ start, end: start + chunk.length, file, sourceStart, sourceEnd: sourceStart + chunk.length });
  out.push(chunk);
}

/**
 * @param {string} text      nội dung controller đã decode
 * @param {{filePath: string, readFile: (abs: string) => string|null}} options
 * @returns {{clearText, segments, declarations, diagnostics, hostFile}}
 *
 * `clearText` KHÔNG chứa DOCTYPE: giá trị entity trong đó là văn bản chứa `<field …>`, quét
 * field trên bản còn DOCTYPE sẽ nhặt luôn cả field nằm trong khai báo.
 */
export function expandEntities(text, { filePath, readFile }) {
  const diagnostics = [];
  const ctx = new Context(readFile, diagnostics);
  const subset = findInternalSubset(text);

  if (subset && subset.subsetStart !== -1) {
    ctx.fileStack.add(filePath);
    collect(ctx, text.slice(subset.subsetStart, subset.subsetEnd), filePath, 0, subset.subsetStart);
    ctx.fileStack.delete(filePath);
  }

  const out = [];
  const segments = [];
  const stack = new Set();

  if (subset) {
    expand(ctx, text.slice(0, subset.doctypeStart), filePath, 0, out, segments, stack, 0);
    expand(ctx, text.slice(subset.doctypeEnd), filePath, subset.doctypeEnd, out, segments, stack, 0);
  } else {
    expand(ctx, text, filePath, 0, out, segments, stack, 0);
  }

  return {
    clearText: out.join(''),
    segments,
    declarations: ctx.general,
    diagnostics,
    hostFile: filePath,
  };
}

/**
 * Offset trong clearText → (file, offset) trong NGUỒN THẬT.
 *
 * Đây là chỗ nối giữa "cái đang nhìn thấy" và "cái sửa được": designer vẽ từ clearText, nhưng
 * mọi splice phải rơi vào đúng file sở hữu. Không có ánh xạ này thì sửa một hàng đến từ
 * Include sẽ ghi nhầm vào controller.
 */
export function mapToSource(segments, offset) {
  const seg = segmentAt(segments, offset);
  if (!seg) return null;
  return { file: seg.file, offset: seg.sourceStart + (offset - seg.start) };
}

/**
 * Với một offset trong clearText thuộc về file KHÁC, tìm dải `&Name;` trong file CHỦ đã sinh
 * ra nó.
 *
 * Vì sao cần: bấm vào một hàng đến từ Include mà mở luôn file Include là bắt người dùng rời
 * khỏi file họ đang sửa. Cái họ muốn thấy trước là *chỗ nào trong controller này* đã kéo hàng
 * đó vào — tức là chính tham chiếu `&Name;`.
 *
 * Chỗ tham chiếu đã được `expand` đóng dấu sẵn lên từng đoạn (`seg.ref`) — đọc thẳng, không
 * suy từ hàng xóm.
 *
 * Bản trước suy bằng cách lùi về đoạn thuộc host GẦN NHẤT rồi lấy `sourceEnd` của nó. Cách đó
 * gãy ngay khi DTD có entity kiểu `<!ENTITY k "ma_kh">`: `&k;` bung ra chữ `ma_kh` mà nguồn
 * thật của chữ đó NẰM TRONG chính khai báo DTD, nên nó cũng là một đoạn "thuộc host" — và
 * đoạn host gần nhất luôn là mẩu tí hon đó. Kết quả: mọi hàng đều trỏ về một chỗ trong DOCTYPE,
 * bấm vào field nào con trỏ cũng nhảy vào giữa khối khai báo. Nhìn ra ngoài thì đúng như
 * "không navigation được".
 *
 * @returns {{start:number,end:number}|null} offset trong file chủ
 */
export function hostRefAt(segments, offset, hostFile) {
  const seg = segmentAt(segments, offset);
  if (!seg) return null;
  if (seg.file === hostFile) return null; // không phải hàng ngoại lai
  const ref = seg.ref;
  if (!ref || ref.file !== hostFile) return null;
  return ref.end > ref.start ? { start: ref.start, end: ref.end } : null;
}

/**
 * Dải `[start,end)` của clearText quy về MỘT file nguồn — file sở hữu `start`.
 *
 * Vì sao không map hai đầu rồi ghép: một hàng có entity ở giữa thì đầu và cuối của nó nằm ở
 * HAI FILE KHÁC NHAU. Ví dụ thật:
 *
 *   <item value="10100&ExtraFields…Split.Customer;------: [doi_tac].Label, [doi_tac]&ExtraFields…;"/>
 *
 * `start` rơi vào file Include, `end` rơi vào file ExtraFields. Ghép `offset` của hai bên lại
 * thành một dải là cộng hai hệ toạ độ khác nhau — ra một khoảng khổng lồ, và bấm vào ô thì
 * editor bôi đen mấy chục dòng thay vì đúng dòng đang xét.
 *
 * Cách đúng: chỉ lấy các đoạn CÙNG FILE với `start`, rồi trải từ đoạn đầu tới đoạn cuối trong
 * số đó. Phần entity xen giữa vẫn nằm trong dải, vì trong FILE NGUỒN mấy ký tự `&Name;` nằm
 * đúng khoảng giữa hai đoạn ấy — nên dải trả về là một đoạn liền, đúng một dòng.
 *
 * @returns {{file:string,start:number,end:number}|null} offset trong file nguồn
 */
export function sourceRange(segments, start, end) {
  const lo = segmentIndexAt(segments, start);
  if (lo === -1) return null;

  const { file } = segments[lo];
  const from = segments[lo].sourceStart + (start - segments[lo].start);
  let to = segments[lo].sourceStart + (Math.min(end, segments[lo].end) - segments[lo].start);

  for (let i = lo + 1; i < segments.length && segments[i].start < end; i++) {
    const s = segments[i];
    if (s.file !== file) continue; // đoạn của file khác: không tính, cũng không cắt ngang
    to = Math.max(to, s.sourceStart + (Math.min(end, s.end) - s.start));
  }
  return { file, start: from, end: Math.max(to, from + 1) };
}

/** Chỉ số đoạn phủ offset, hoặc -1. Tách ra để `sourceRange` đi tiếp được từ đó. */
function segmentIndexAt(segments, offset) {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (offset < s.start) hi = mid - 1;
    else if (offset >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Đoạn nào của clearText phủ offset này — trả về provenance để biết ai sở hữu. */
export function segmentAt(segments, offset) {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (offset < s.start) hi = mid - 1;
    else if (offset >= s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Dải trong clearText do MỘT tham chiếu `&Name;` sinh ra — cộng chính dải `&Name;` trong file chủ.
 *
 * Sinh ra cho phép «phân giải entity vào file thiết kế»: muốn thay dòng `&Name;` bằng nội dung
 * đã bung thì phải cầm được ĐÚNG đoạn văn bản mà tham chiếu ấy đẻ ra, không nhiều hơn một ký
 * tự. `expand` đã đóng dấu cùng MỘT object `ref` lên mọi đoạn thuộc về một lần bung (khung
 * ngoài ghi đè khung trong), nên gom theo ĐỒNG NHẤT THAM CHIẾU (`===`) là đủ — không phải so
 * nội dung, cũng không phải đoán theo hàng xóm.
 *
 * Các đoạn của cùng một `ref` luôn LIỀN NHAU trong clearText: `expand` đẩy chúng vào `segments`
 * theo thứ tự và chỉ đóng dấu đúng khoảng `[mark, segments.length)`. Nên trải từ đoạn đầu tới
 * đoạn cuối là ra đúng dải, không sót và không thừa.
 *
 * @returns {{ref:{file:string,start:number,end:number}, start:number, end:number}|null}
 *          `start`/`end` là offset trong clearText; `ref` là dải `&Name;` trong file chủ.
 */
export function refResolvedSpan(segments, offset) {
  const i = segmentIndexAt(segments, offset);
  if (i === -1) return null;
  const { ref } = segments[i];
  if (!ref) return null;

  let lo = i;
  let hi = i;
  while (lo > 0 && segments[lo - 1].ref === ref) lo--;
  while (hi + 1 < segments.length && segments[hi + 1].ref === ref) hi++;
  return { ref, start: segments[lo].start, end: segments[hi].end };
}

/**
 * Dời TOÀN BỘ bản đồ đoạn đi `offset` ký tự — dùng khi chỉ một LÁT của clearText được đem đi quét.
 *
 * Ca thật: `Grid/Config/Initialize.xml` khai cấu hình của cả trăm controller, mỗi cái một thẻ
 * `<group id="…">`. Người gọi cắt đúng thẻ của controller mình cần rồi quét trên lát ấy, nên mọi
 * span do bộ quét trả về đo TỪ ĐẦU LÁT. Nhưng `segments` thì vẫn đo từ đầu file — trộn hai hệ là
 * `sourceRange` quy một offset của lát về vị trí cùng số ấy trong file, và con trỏ nhảy tới một
 * chỗ cách chỗ đúng đúng bằng khoảng cách từ đầu file tới thẻ `<group>`. Với `Initialize.xml`
 * của một chương trình thật thì đó là hàng chục nghìn ký tự — nhảy sang một controller khác hẳn.
 *
 * Dời bản đồ thay vì dời từng span: span nằm rải trong nhiều cấu trúc lồng nhau (`attrSpans`,
 * `columns`, `valueSpan`), còn bản đồ chỉ là một mảng phẳng. Đoạn nằm trước lát sẽ mang toạ độ
 * âm — không sao, phép tìm nhị phân chỉ cần thứ tự tăng dần, và không ai hỏi tới chúng.
 */
export function shiftSegments(segments, offset) {
  if (!Array.isArray(segments) || !offset) return segments ?? null;
  return segments.map((s) => ({ ...s, start: s.start - offset, end: s.end - offset }));
}
