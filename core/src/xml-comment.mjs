// xml-comment.mjs — vùng `<!-- … -->` của một file XML, để mọi bộ quét BỎ QUA chúng.
//
// Vì sao phải có: cả `spans.mjs` lẫn `entities.mjs` quét bằng regex trên văn bản thô, và không
// cái nào biết comment là gì. Hệ quả đo được trên `Dir/Customer.xml` của HOATP: một
// `<!ENTITY … >` đã bị comment vẫn được ĐĂNG KÝ, và vì luật first-wins nó còn thắng bản khai
// thật đứng sau. Người viết file tưởng mình đã tắt một khai báo; designer vẫn dùng nó.
// Cùng lỗi ấy áp cho `<item>`, `<field>`, `<view>`, `<button>` bị comment.
//
// KHÔNG cắt comment ra khỏi văn bản — trả về VÙNG. Cả tầng ghi ngược của dự án chạy bằng offset
// vào văn bản GỐC (`applySplices`); cắt bớt một ký tự là mọi offset phía sau lệch, và phép ghi
// ngược nhắm sai chỗ. Bộ quét gọi `inComment()` để bỏ khớp, offset giữ nguyên từng byte.

/**
 * @returns {Array<{start:number,end:number}>} vùng comment, đã sắp tăng dần, không chồng nhau.
 *
 * CDATA được coi là ĐỤC: `<![CDATA[ … ]]>` có thể chứa `<!--` (script và SQL của FBO đầy dấu
 * so sánh và chú thích), và đọc nó thành comment là nuốt mất phần văn bản thật phía sau.
 *
 * GIỚI HẠN PHẢI NÓI RÕ: giá trị của một `<!ENTITY>` chứa nguyên văn `<!--` sẽ bị đọc thành
 * comment. XML thì không cấm, nhưng trong corpus FBO mọi dấu `<` trong giá trị entity đều viết
 * bằng `&lt;` nên chuyện đó không xảy ra. Ngày nào nó xảy ra, hàm này phải biết cả dấu nháy.
 */
export function commentRanges(text) {
  const s = String(text ?? '');
  const ranges = [];
  const re = /<!\[CDATA\[|<!--/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '<![CDATA[') {
      const close = s.indexOf(']]>', m.index + 9);
      // CDATA không đóng: coi như hết file là đục. Đọc tiếp là chắc chắn đọc nhầm.
      re.lastIndex = close === -1 ? s.length : close + 3;
      continue;
    }
    const close = s.indexOf('-->', m.index + 4);
    const end = close === -1 ? s.length : close + 3;
    ranges.push({ start: m.index, end });
    re.lastIndex = end;
  }
  return ranges;
}

/**
 * Offset này có nằm trong một comment không.
 *
 * Quét tuyến tính chứ không nhị phân: số comment trong một controller đếm bằng hàng chục, và
 * người gọi hỏi theo thứ tự tăng dần nên `ranges` gần như luôn khớp ở vài phần tử đầu.
 */
export function inComment(ranges, index) {
  for (const r of ranges) {
    if (index < r.start) return false; // đã sắp tăng dần: qua khỏi là chắc chắn không nằm trong
    if (index < r.end) return true;
  }
  return false;
}

/**
 * Bọc sẵn cho vòng lặp regex: trả về hàm `skip(index)` dùng một lần cho một văn bản.
 * Tránh việc mỗi bộ quét tự tính lại `commentRanges` cho cùng một chuỗi.
 */
export function commentSkipper(text) {
  const ranges = commentRanges(text);
  if (ranges.length === 0) return () => false;
  return (index) => inComment(ranges, index);
}
