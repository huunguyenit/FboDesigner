// grid-sample.mjs — dựng câu SELECT lấy vài dòng dữ liệu THẬT cho một lưới.
//
// Vì sao có nó: chỉnh bề rộng cột trên blueprint hiện là làm bằng cảm tính. Không ai biết cột
// 60px có cắt mất tên khách hay không cho tới khi màn hình chạy trên máy khách. Vài dòng thật đổ
// vào lưới trả lời câu ấy trong một giây.
//
// ═══ LUẬT CỦA FILE NÀY: KHÔNG MỘT MẨU SQL NÀO CỦA FILE KHÁCH ĐI THẲNG VÀO CÂU LỆNH ═══
//
// Đây là file DUY NHẤT trong core sinh ra một câu lệnh sẽ chạy trên DATABASE CỦA KHÁCH. Mọi thứ
// đi vào câu lệnh đều phải là ĐỊNH DANH đã qua `assertIdent` — tên bảng, tên alias, tên cột.
// Tuyệt đối không chép nguyên mệnh đề `ON`, không chép nguyên biểu thức `aliasName`, không chép
// nguyên `<query>`. Một controller hỏng (hoặc bị sửa ác ý) không được biến thành một câu lệnh
// làm chuyện khác.
//
// Cái giá của luật ấy, nói thẳng ra: phép join được DỰNG LẠI từ cặp khoá chính mà
// `scanFindingJoin` tách được, chứ không phải mệnh đề `ON` đầy đủ. Join nhiều điều kiện vì thế
// có thể trả về thừa dòng. Với một phép xem trước để ĐO BỀ RỘNG CỘT thì thừa dòng không sao —
// và đó là lý do `notes` luôn nói ra điều này, chứ không để người đọc tự phát hiện.
//
// ═══ CHỖ LỆCH KHỎI KẾ HOẠCH BAN ĐẦU ═══
//
// Kế hoạch định TỪ CHỐI cả câu khi có cột join tới bảng tạm cục bộ (`#x`). Làm thật thì thấy
// BỎ RIÊNG CỘT ẤY tốt hơn hẳn ở cả hai mặt: mối nguy của bảng tạm là nó lọt VÀO câu lệnh (không
// tồn tại → lỗi, hoặc tệ hơn: trúng một `#x` khác cùng tên của phiên khác), mà bỏ cột thì nó
// không lọt vào nữa — nguy cơ biến mất y như từ chối. Còn mười chín cột lành thì vẫn xem được.
// Từ chối cả câu chỉ còn dành cho ca thật sự không dựng nổi câu lệnh nào.

import { scanRoot, scanViews, scanFields } from './spans.mjs';
import { scanFindingJoin, readAliasName, isLocalTempTable, scanPartition } from './filter-declare.mjs';
import { resolveLocaleName } from './control.mjs';
import { assertIdent } from './sql-config.mjs';
import { msg } from './msg.mjs';

/** Mặc định đủ để thấy dữ liệu dài ngắn ra sao, mà không kéo về một trang lưới. */
export const SAMPLE_TOP_DEFAULT = 10;
/** Trần cứng. Đây là phép XEM TRƯỚC để đo cột, không phải công cụ trích dữ liệu. */
export const SAMPLE_TOP_MAX = 100;

/** Bỏ một cột khỏi câu lệnh, kèm lý do đọc được. */
function skip(code, params) {
  return { code, message: msg(code, params), ...params };
}

/**
 * Nhãn cột trong `AS …`, bọc ngoặc vuông.
 *
 * Không dùng `assertIdent` được, và đó là chuyện đúng chứ không phải chỗ cần nới: tên cột FBO
 * mang hậu tố ngôn ngữ (`ten_kh%l`) nên KHÔNG phải định danh trần. Nhưng nhãn phải giữ NGUYÊN
 * VĂN tên FBO — tầng vỏ đối chiếu tên cột trả về với cột trên lưới để đổ đúng chỗ, và phân giải
 * `%l` ở đây là hai cột `ten_kh%l`/`ten_kh` cùng ra một nhãn rồi đổ chồng lên nhau.
 *
 * Nên: chặn bằng một BẢNG CHỮ CÁI HẸP trước, rồi mới bọc ngoặc. Chặn trước-bọc sau, không phải
 * bọc-rồi-tin: `]` bên trong ngoặc vuông là đường thoát ra khỏi định danh, và một bảng chữ cái
 * hẹp thì không cần ai phải nhớ điều đó.
 */
function quoteLabel(name) {
  const s = String(name ?? '');
  if (!/^[A-Za-z_][\w$%.]*$/.test(s)) {
    throw new Error(`nhãn cột không hợp lệ để đưa vào SQL: "${s}"`);
  }
  return `[${s}]`;
}

/**
 * Bảng là TIỀN TỐ chia kỳ chứ chưa phải một bảng thật?
 *
 * `m64$000000` là bảng master có thật; `m64$` mới chỉ là tiền tố, kỳ nào thì nối thêm vào sau.
 * `assertIdent` không bắt được ca này (`$` là ký tự hợp lệ trong định danh SQL Server), nên phải
 * hỏi riêng — chạy `select from m64$` là chắc chắn "Invalid object name".
 */
function isPartitionPrefix(table) {
  return /\$$/.test(String(table ?? '').trim());
}

/**
 * Tên BẢNG ghép được vào `FROM`/`JOIN`: định danh trần, cho phép thêm tiền tố `#`/`##`.
 *
 * Vì sao không dùng thẳng `assertIdent`: `identPattern` không cho `#`, mà bảng tạm TOÀN CỤC
 * (`##x`) là bảng tra thẳng được — nó sống hết phiên kết nối, khác hẳn `#x` cục bộ (đã bị loại
 * ở trên bằng `isLocalTempTable`). Chặn nó bằng `assertIdent` là bỏ mất một ca hợp lệ có thật.
 *
 * Bảng chữ cái vẫn kín như cũ ở chỗ quan trọng: không nháy, không chấm phẩy, không khoảng
 * trắng, không dấu gạch mở comment. Nới đúng một ký tự, và nới có lý do.
 */
const TABLE_NAME = /^#{0,2}[A-Za-z_][\w$]*$/;

function assertTableName(name, what) {
  const t = String(name ?? '');
  if (!TABLE_NAME.test(t)) throw new Error(`${what} không hợp lệ để đưa vào SQL: "${t}"`);
  return t;
}

/**
 * Che một giá trị, GIỮ NGUYÊN ĐỘ DÀI.
 *
 * Vì sao che mà vẫn đo được cột: thứ làm một cột bị cắt là ĐỘ DÀI chuỗi, không phải nội dung.
 * Giữ đúng số ký tự thì «tên khách này có tràn cột 60px không» vẫn trả lời được, mà ảnh chụp
 * màn hình gửi đi không kèm tên khách hàng thật.
 *
 * Nói thẳng phần KHÔNG giữ được: bề rộng từng chữ cái khác nhau trong font tỉ lệ, nên chuỗi đã
 * che rộng xấp xỉ chứ không bằng đúng chuỗi gốc. Ai cần đo chính xác tới từng pixel thì tắt
 * `fboDesigner.maskSampleData` trong một lát — đó là lý do nó là một công tắc chứ không phải
 * một luật cứng.
 *
 * Cách che chọn để NHÌN LÀ BIẾT đã che: chữ hoa thành `X`, chữ thường thành `x`, chữ số thành
 * `0`. Mọi thứ còn lại — khoảng trắng, dấu chấm, gạch nối, dấu phẩy — giữ NGUYÊN, vì chúng vừa
 * là phần lớn hình dạng của chuỗi (`12/03/2026`, `KH-001`) vừa không nói gì về danh tính ai.
 */
export function maskSampleValue(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/\p{Lu}|\p{Lt}|\p{Ll}|\p{N}/gu, (ch) => {
    if (/\p{N}/u.test(ch)) return '0';
    return ch === ch.toLowerCase() ? 'x' : 'X';
  });
}

/** Che mọi ô của mọi dòng. Khoá (tên cột) KHÔNG che — nó là bản khai, không phải dữ liệu. */
export function maskSampleRows(rows) {
  return (rows ?? []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = maskSampleValue(v);
    return out;
  });
}

/**
 * Văn bản controller lưới → câu SELECT lấy `top` dòng đầu.
 *
 * @param {string} text  văn bản ĐÃ BUNG entity
 * @param {{top?: number, columns?: string[]|null, fields?: object[]|null}} opts
 *   `columns` — tên cột theo ĐÚNG thứ tự muốn hiện. Bỏ trống thì lấy từ view đầu tiên có cột;
 *   tầng vỏ nên truyền vào danh sách đã merge với `Grid/Config`, vì cột do cấu hình ẩn thêm vào
 *   cũng là cột người dùng nhìn thấy.
 *
 * @returns {{ok: true, sql, columns, skipped, notes, table, base, top}
 *          | {ok: false, code, reason, skipped, notes}}
 */
export function buildSampleSelect(text, { top = SAMPLE_TOP_DEFAULT, columns = null, fields = null } = {}) {
  const notes = [];
  const skipped = [];

  const root = scanRoot(text);
  const table = String(root.attrs?.table ?? '').trim();
  if (table === '') {
    return { ok: false, code: 'sample.no_table', reason: msg('sample.no_table'), skipped, notes };
  }
  if (isPartitionPrefix(table)) {
    return {
      ok: false,
      code: 'sample.partition_no_period',
      reason: msg('sample.partition_no_period', { table }),
      skipped,
      notes,
      // Tầng vỏ cần hai thứ này để hỏi kỳ rồi gọi lại: tiền tố, và bảng master để gợi ý.
      partition: scanPartition(text),
      masterTable: `${table}000000`,
    };
  }

  const scanned = fields ?? scanFields(text);
  const fieldByName = new Map(scanned.map((f) => [f.name, f]));

  let wanted = columns;
  if (!wanted) {
    const view = scanViews(text).find((v) => (v.columns ?? []).length > 0);
    wanted = (view?.columns ?? []).map((c) => c.name);
  }

  const finding = scanFindingJoin(text);
  const byAlias = finding.ok ? new Map(finding.joins.map((j) => [j.alias, j])) : new Map();
  const base = finding.ok ? finding.base : 'a';
  if (!finding.ok) {
    // KHÔNG từ chối: cột của bảng chính vẫn lấy được, và với đa số lưới thì đó là phần lớn cột.
    // Chỉ nói ra vì sao mấy cột kia vắng mặt.
    notes.push(msg('sample.note_finding', { reason: finding.reason }));
  }

  const picked = [];
  const usedJoins = new Map(); // alias → join, chỉ những alias THẬT SỰ có cột được chọn

  for (const name of wanted) {
    const field = fieldByName.get(name);
    if (!field) {
      skipped.push(skip('sample.skip_no_field', { name }));
      continue;
    }

    const { alias, expression, column } = readAliasName(field.attrs?.aliasName, base);
    // Biểu thức không bóc được thành `alias.cot`: chép nguyên nó vào câu lệnh là phá luật ở đầu
    // file. Bỏ cột, nói lý do.
    if (expression && column === null) {
      skipped.push(skip('sample.skip_expression', { name, alias: String(field.attrs?.aliasName ?? '') }));
      continue;
    }

    // `%l` là hậu tố NGÔN NGỮ, không thuộc tên cột trên database. `readAliasName` đã bóc sẵn tên
    // cột khi `aliasName` là biểu thức; còn lại thì phân giải hậu tố như khi vẽ.
    const sourceColumn = column ?? resolveLocaleName(name, true);

    if (alias !== base) {
      const join = byAlias.get(alias);
      if (!join) {
        skipped.push(skip('sample.skip_alias_unknown', { name, alias }));
        continue;
      }
      if (isLocalTempTable(join.table)) {
        skipped.push(skip('sample.skip_local_temp', { name, alias, table: join.table }));
        continue;
      }
      // Không tách được cặp khoá thì không dựng lại được phép join mà KHÔNG chép nguyên `ON`.
      if (!join.leftAlias || !join.leftKey || !join.rightAlias || !join.rightKey) {
        skipped.push(skip('sample.skip_join_unparsed', { name, alias }));
        continue;
      }
      /*
       * Bảng join phải là một định danh TRẦN tra thẳng được. Hai ca rơi vào đây: tiền tố chia
       * kỳ (`hddt00$`, chưa có kỳ) và tên chứa ký tự lạ.
       *
       * Bỏ CỘT chứ không để `assertIdent` ném ở khâu ghép: một bảng join lạ chỉ làm hỏng đúng
       * mấy cột đi qua nó, và giết cả phép xem trước vì một cột là đổi một phiền toái nhỏ lấy
       * một phiền toái lớn.
       */
      if (isPartitionPrefix(join.table) || !TABLE_NAME.test(String(join.table ?? ''))) {
        skipped.push(skip('sample.skip_join_table', { name, alias, table: join.table }));
        continue;
      }
      usedJoins.set(alias, join);
    }

    picked.push({ name, alias, column: sourceColumn, label: name });
  }

  if (picked.length === 0) {
    return {
      ok: false,
      code: 'sample.no_columns',
      reason: msg('sample.no_columns', { skipped: skipped.length }),
      skipped,
      notes,
    };
  }

  /*
   * ─── Từ đây trở xuống, MỌI mẩu ghép vào câu lệnh đều đi qua `assertIdent`/`quoteLabel` ───
   *
   * Cả khối nằm trong `try`: hai hàm ấy NÉM khi gặp thứ không phải định danh, và đó là hành vi
   * đúng của chúng — nhưng một lệnh của người dùng thì không được chết vì một tên cột lạ trong
   * file khách. Bắt lại, trả về một lời từ chối đọc được, giữ nguyên lý do.
   */
  try {
    return assemble();
  } catch (err) {
    return { ok: false, code: 'sample.bad_identifier', reason: msg('sample.bad_identifier', { reason: err.message }), skipped, notes };
  }

  function assemble() {
  const t = assertIdent(table, 'tên bảng');
  const b = assertIdent(base, 'alias bảng chính');

  const selectList = picked
    .map((c) => `${assertIdent(c.alias, 'alias cột')}.${assertIdent(c.column, 'tên cột')}`
      + ` AS ${quoteLabel(c.label)}`)
    .join(', ');

  const joinLines = [...usedJoins.values()].map((j) => 'LEFT JOIN '
    + `${assertTableName(j.table, 'bảng join')} ${assertIdent(j.alias, 'alias join')} ON `
    + `${assertIdent(j.leftAlias, 'alias trái')}.${assertIdent(j.leftKey, 'khoá trái')} = `
    + `${assertIdent(j.rightAlias, 'alias phải')}.${assertIdent(j.rightKey, 'khoá phải')}`);
  if (joinLines.length > 0) notes.push(msg('sample.note_join_keys'));

  const n = Math.max(1, Math.min(Math.trunc(Number(top) || SAMPLE_TOP_DEFAULT), SAMPLE_TOP_MAX));

  const sql = [
    'SET NOCOUNT ON;',
    // Xem trước KHÔNG được chặn ai đang làm việc thật trên database của khách.
    'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;',
    `SELECT TOP ${n} ${selectList}`,
    `FROM ${t} ${b}`,
    ...joinLines,
    ';',
  ].join('\n');

  return { ok: true, sql, columns: picked, skipped, notes, table: t, base: b, top: n };
  }
}
