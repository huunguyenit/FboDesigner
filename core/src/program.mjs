// program.mjs — từ đường dẫn file controller suy ra thư mục program và các gốc tài nguyên.
//
// Controller luôn nằm ở `<program>\App_Data\Controllers\<Dir|Grid|Filter|…>\<Tên>.xml`, nên
// chính file đang mở đã nói program nằm ở đâu — không cần khai cấu hình, và không thể khai
// nhầm sang program của khách khác.
//
//   \\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421\App_Data\Controllers\Dir\Site.xml
//   → program      \\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421
//   → css          <program>\Css
//   → images       <program>\Images
//   → clientScript <program>\ClientScript
//
// Thuần phép tính chuỗi: không đụng filesystem. Ai cần biết thư mục có thật hay không thì tự
// kiểm ở tầng trên — nhờ vậy hàm này test được mà không cần một program thật trên đĩa.

/** @returns {{programRoot,cssDir,imagesDir,clientScriptDir,controllersDir,folder,controller}|null} */
export function resolveProgramPaths(controllerPath) {
  if (!controllerPath) return null;

  const unc = /^[\\/]{2}/.test(controllerPath);
  const sep = controllerPath.includes('\\') ? '\\' : '/';
  const parts = controllerPath.split(/[\\/]+/).filter((p) => p !== '');

  const lower = parts.map((p) => p.toLowerCase());
  const idx = lower.lastIndexOf('app_data');
  if (idx < 1) return null; // không có App_Data, hoặc nó là phần tử đầu → không suy được program

  const prefix = unc ? sep.repeat(2) : '';
  const join = (...segments) => prefix + segments.filter((s) => s !== '').join(sep);
  const rootParts = parts.slice(0, idx);
  const programRoot = join(...rootParts);

  const controllersIdx = lower.indexOf('controllers', idx);
  const folder = controllersIdx !== -1 ? parts[controllersIdx + 1] ?? null : null;
  const file = parts[parts.length - 1] ?? '';

  return {
    programRoot,
    cssDir: join(...rootParts, 'Css'),
    imagesDir: join(...rootParts, 'Images'),
    clientScriptDir: join(...rootParts, 'ClientScript'),
    controllersDir: join(...rootParts, 'App_Data', 'Controllers'),
    folder,                                        // 'Dir' | 'Grid' | 'Filter' | …
    controller: file.replace(/\.(xml|f)$/i, ''),   // 'Site'
  };
}
