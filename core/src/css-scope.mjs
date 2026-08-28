// css-scope.mjs — nâng độ đặc hiệu của một tập CSS bằng cách gắn tiền tố vào mọi selector.
//
// Vì sao cần: CSS của program khai `div.ToolbarBackgroundImage` (đặc hiệu 0-1-1) trong khi base
// pack khai `.ToolbarBackgroundImage` (0-1-0). Đặc hiệu cao thắng bất kể ai nạp trước, nên đảo
// thứ tự `<link>` không cứu được — icon toolbar vẫn bị CSS của khách đè. Ca thật:
// `FastBusiness.NotifyExtender.NotifyExtender.css` của dự án HOATP.
//
// Gắn `#fbo-form` vào đầu mỗi selector cho 1-0-0, nên `#fbo-form .ToolbarBackgroundImage`
// (1-1-0) thắng `div.ToolbarBackgroundImage` (0-1-1) mà KHÔNG cần `!important`.
//
// Vì sao không `!important`: nó thắng cả những chỗ program CỐ Ý vá. `Menu.css` của program là
// lớp vá thật (`padding-right: 1px !important`) và lớp vá ấy phải còn tác dụng — đúng luật ở
// `extension/media/base/README.md`. Nâng đặc hiệu thì `!important` của khách vẫn thắng, còn rule
// thường của khách thì thua. Đó chính là ranh giới cần.
//
// Vì sao không `@layer`: style KHÔNG layer luôn thắng style CÓ layer, mà CSS của program nạp
// bằng `<link>` nên nó không layer. Muốn dùng `@layer` thì phải đổi `<link>` của khách thành
// `@import … layer(program)` — tức đụng vào cách nạp file của khách, thứ ta không kiểm soát.
//
// File này nằm ở core vì CẢ HAI tầng vỏ đều cần nó: webview (`render-host.js`) và bàn đo
// (`tools/probe-layout.mjs`). Hai bản sao của cùng một phép biến đổi là hai bản sẽ trôi khỏi
// nhau, và bàn đo sẽ đo một cascade khác cái đang chạy.

const RE_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * @param {string} css   CSS nguồn
 * @param {string} scope selector gắn vào đầu, ví dụ `#fbo-form`
 * @returns {string}
 *
 * GIỚI HẠN PHẢI NÓI RÕ: hàm này KHÔNG đi vào trong at-rule. `@media`, `@supports`, `@keyframes`
 * có khối lồng, và gắn tiền tố vào dòng `@media …` hay vào `0% {`/`100% {` của keyframes là phá
 * cả file. Base pack hôm nay không có at-rule nào — kiểm bằng máy trước khi viết hàm này — nên
 * ràng buộc ấy đủ. Ngày nào base pack có at-rule thì hàm này phải được dạy đọc khối lồng TRƯỚC,
 * chứ không phải chạy tiếp và hỏng im lặng.
 */
export function scopeCss(css, scope) {
  const text = String(css ?? '');
  if (text === '' || !scope) return text;

  // Bỏ comment TRƯỚC khi tách khối: comment trong base pack chứa cả `{`, `}` và `,` (mấy bảng
  // đối chiếu runtime), để nguyên là phép tách selector đọc nhầm chúng thành rule.
  return text.replace(RE_COMMENT, '').split('}')
    .map((chunk) => {
      const cut = chunk.lastIndexOf('{');
      if (cut === -1) return chunk;
      const head = chunk.slice(0, cut);
      // Giữ nguyên khoảng trắng ĐẦU khối. Cắt nó đi thì cả file dồn thành một dòng, và bảng
      // Stylesheet của debug mode lẫn devtools đều thành không đọc được — thứ duy nhất còn để
      // soi khi cascade sai.
      const lead = /^\s*/.exec(head)[0];
      const selectors = head.slice(lead.length).split(',')
        .map((s) => (s.trim() === '' ? s : `${scope} ${s.trim()}`))
        .join(', ');
      return `${lead}${selectors} {${chunk.slice(cut + 1)}`;
    })
    .join('}');
}

/** Selector bọc bản vẽ trong webview — `<div id="fbo-form">` ở `extension/media/shell.html`. */
export const FORM_SCOPE = '#fbo-form';
