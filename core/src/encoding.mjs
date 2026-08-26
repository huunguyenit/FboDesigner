// encoding.mjs — đọc VÀ ghi file nguồn FBO mà không phá encoding.
//
// Phần decode lấy nguyên ý từ hub 4AI (`mcp/fbo/lib/encoding.mjs`); ADR-0002 chốt là về sau
// hub sẽ import ngược lại module này, không phải copy mãi.
//
// Phần encode là mới, và bắt buộc phải có: designer ghi lại file, không chỉ đọc. Node không
// có encoder Windows-1258 (TextEncoder chỉ biết UTF-8). Bảng mã ở đây dựng bằng cách quay
// ngược chính TextDecoder('windows-1258') — decode từng byte 0..255 rồi lật map. Không chép
// tay bảng mã từ đâu cả: bảng chép tay là bảng sai ở đúng ký tự hiếm mà không ai test.

import fs from 'node:fs';

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const cp1258 = new TextDecoder('windows-1258');

/**
 * @returns {{text: string, encoding: string, bom: boolean, newline: 'crlf'|'lf'|'mixed'|'none', bytes: number}}
 */
export function readSource(absPath) {
  return decodeSource(fs.readFileSync(absPath));
}

/**
 * BẪY đã trả giá một lần, ghi lại ở đây: text decode từ Windows-1258 mang thanh điệu ở dạng
 * TỔ HỢP (`'M','a',U+0303`), không phải NFC (`'Mã'`). Nên `text.includes('Mã khách')` trả
 * false trên file 1258 dù nội dung đúng y như vậy.
 *
 * decodeSource CỐ Ý không normalize: decode phải trung thành với byte, vì offset của mọi
 * splice đo trên chính chuỗi này. Chỗ nào SO CHUỖI hay TÌM KIẾM thì tự `.normalize('NFC')`
 * ở chỗ đó — đừng sửa hàm này.
 */
export function decodeSource(buf) {
  // UTF-16 có thật trong corpus và ở đúng chỗ nguy hiểm nhất: `Include\BIMode.txt` — file
  // một chữ "INCLUDE"/"IGNORE" bật tắt cả mảng khai báo entity — là UTF-16LE (ff fe).
  // Đọc nó bằng 1258 ra "I\0N\0C\0…", so với "INCLUDE" không khớp, và công tắc BI mode
  // âm thầm đọc sai. Nên phải nhận diện BOM UTF-16 TRƯỚC mọi thứ khác.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return describe(new TextDecoder('utf-16le').decode(buf.subarray(2)), 'utf-16le', true, buf.length);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return describe(new TextDecoder('utf-16be').decode(buf.subarray(2)), 'utf-16be', true, buf.length);
  }

  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = bom ? buf.subarray(3) : buf;

  // Gợi ý từ XML declaration — chỉ đọc 200 byte đầu bằng latin1 để không hỏng gì.
  const head = body.subarray(0, 200).toString('latin1');
  const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();

  let text;
  let encoding;
  if (declared && /^(windows-1258|cp1258)$/.test(declared)) {
    text = cp1258.decode(body);
    encoding = 'windows-1258';
  } else {
    try {
      text = utf8Strict.decode(body);
      encoding = 'utf-8';
    } catch {
      text = cp1258.decode(body);
      encoding = 'windows-1258';
    }
  }

  return describe(text, encoding, bom, buf.length);
}

function describe(text, encoding, bom, bytes) {
  const crlf = text.includes('\r\n');
  const bareLf = /(^|[^\r])\n/.test(text);
  const newline = crlf && bareLf ? 'mixed' : crlf ? 'crlf' : bareLf ? 'lf' : 'none';
  return { text, encoding, bom, newline, bytes };
}

/** byte -> ký tự, dựng từ chính decoder. Byte nhỏ nhất thắng khi hai byte cùng ra một ký tự. */
const CHAR_OF_BYTE = new Array(256).fill(null);
const BYTE_OF_CHAR = new Map();
{
  const one = new Uint8Array(1);
  for (let b = 0; b <= 0xff; b++) {
    one[0] = b;
    const ch = cp1258.decode(one);
    if (ch === '\uFFFD') continue; // byte không ánh xạ được trong 1258
    CHAR_OF_BYTE[b] = ch;
    if (!BYTE_OF_CHAR.has(ch)) BYTE_OF_CHAR.set(ch, b);
  }
}

function hex(ch) {
  return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Encode sang Windows-1258.
 *
 * 1258 lưu tiếng Việt kiểu LAI: nguyên âm có mũ/móc/trăng là ký tự dựng sẵn (ê = 0xEA,
 * ô = 0xF4, ơ, ư, ă), còn THANH ĐIỆU là ký tự tổ hợp đứng sau (huyền 0xCC, sắc 0xEC,
 * hỏi 0xD2, ngã 0xDE, nặng 0xF2). Nên "ề" ra HAI byte: 0xEA rồi 0xCC.
 *
 * Thuật toán vì thế phải gộp THAM LAM chứ không NFD thẳng: tách hết ra dấu rồi ghép lại
 * base với càng nhiều dấu càng tốt, miễn bản ghép còn nằm trong bảng; dấu còn thừa mới
 * phát ra dạng tổ hợp. NFD thẳng sẽ chết ở "ê" (U+0302 không có trong 1258).
 *
 * @throws nếu gặp ký tự không biểu diễn được — ném có vị trí, không thay bằng "?" âm thầm.
 */
export function encodeWindows1258(text) {
  const out = [];
  for (const ch of text.normalize('NFC')) {
    const direct = BYTE_OF_CHAR.get(ch);
    if (direct !== undefined) { out.push(direct); continue; }

    const d = ch.normalize('NFD');
    const base = d[0];
    const marks = Array.from(d.slice(1));

    let byte = BYTE_OF_CHAR.get(base);
    let used = 0;
    for (let k = 1; k <= marks.length; k++) {
      const composed = (base + marks.slice(0, k).join('')).normalize('NFC');
      if (composed.length !== 1) continue;
      const b = BYTE_OF_CHAR.get(composed);
      if (b !== undefined) { byte = b; used = k; }
    }
    if (byte === undefined) throw new Error(`encodeWindows1258: ${hex(ch)} (${JSON.stringify(ch)}) không có trong Windows-1258`);
    out.push(byte);

    for (const m of marks.slice(used)) {
      const b = BYTE_OF_CHAR.get(m);
      if (b === undefined) throw new Error(`encodeWindows1258: dấu tổ hợp ${hex(m)} của ${JSON.stringify(ch)} không có trong Windows-1258`);
      out.push(b);
    }
  }
  return Buffer.from(out);
}

/** Bỏ dấu tiếng Việt + lowercase — dùng cho index tìm kiếm và cho query đầu vào. */
export function stripAccents(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
    .toLowerCase();
}
