// definition-host.js — F12 / Ctrl+click trong EDITOR VĂN BẢN (khác Ctrl+click trên designer).
//
// Hai lối nhảy tồn tại song song, và chúng KHÔNG trùng nhau:
//
//   trên designer   bấm một ô → `revealSource` mở file và chọn dải. Đích tính từ MODEL đã dựng
//                   (`origin`/`range`/`hostRef` mà `buildViewModel` gắn lên từng hàng), và tầng
//                   vỏ còn quyết mở ở cột nào, có mở kèm file liên quan không.
//   trong editor    F12 tại một OFFSET văn bản. VS Code tự lo phần mở file; provider chỉ trả
//                   một `Location`.
//
// Vì đầu vào khác nhau (một bên là ô đã render, một bên là offset thô) nên không có bộ phân giải
// nào để dùng chung — thứ dùng chung là `sourceRange`/`expandEntities` của core, và cả hai lối
// đều đi qua đó. Chép lại một trong hai là chỗ chúng bắt đầu chỉ vào hai nơi khác nhau.
//
// Phần THUẦN — «con trỏ đang đứng trên cái gì» — nằm ở `core/src/definition.mjs`. File này chỉ
// làm nửa còn lại: cầm câu trả lời ấy đi tìm đích thật, việc đòi đọc đĩa và bung cả cây Include.

const vscode = require('vscode');

const { CONTROLLER_SELECTOR, cachedReadFile } = require('./render-host');
const { entryOf, positionAt } = require('./text-position');

/**
 * `Location` tại một dải OFFSET trong một file.
 *
 * Quy offset trên ĐÚNG chuỗi đã sinh ra nó — xem `text-position.js`. File đang mở thì lấy văn
 * bản của editor (có thể đang dirty); file khác thì đọc bằng bộ giải mã của core.
 */
function locationAt(core, filePath, start, end, document) {
  const isHost = document && document.uri.fsPath.toLowerCase() === String(filePath).toLowerCase();
  const text = isHost ? document.getText() : cachedReadFile(core)(filePath);
  if (typeof text !== 'string') return null;

  const entry = entryOf(text);
  const a = positionAt(entry, start);
  const b = positionAt(entry, end);
  return new vscode.Location(
    vscode.Uri.file(filePath),
    new vscode.Range(new vscode.Position(a.line, a.character), new vscode.Position(b.line, b.character)),
  );
}

function registerDefinitions(context, core, output) {
  const provider = {
    provideDefinition(document, position) {
      const raw = document.getText();
      const file = document.uri.fsPath;

      let target;
      try {
        // Offset của VS Code trên `document.getText()`, và `definitionTargetAt` đọc đúng chuỗi
        // ấy — hai bên cùng một hệ toạ độ, không cần quy đổi gì.
        target = core.definitionTargetAt(raw, document.offsetAt(position));
      } catch (err) {
        output.appendLine(`F12 bỏ qua ${file}: ${err && err.message}`);
        return undefined;
      }
      if (!target) return undefined;

      try {
        return resolve(target, document, file, core, output);
      } catch (err) {
        // Gõ dở, Include mất, đường dẫn lạ — nhường lại chứ đừng để VS Code hiện lỗi provider.
        output.appendLine(`F12 không phân giải được (${target.kind}): ${err && err.message}`);
        return undefined;
      }
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(CONTROLLER_SELECTOR, provider),
  );
  return provider;
}

function resolve(target, document, file, core, output) {
  /*
   * `SYSTEM "..\Include\X.ent"` ngay trong khai báo → chính file ấy, đầu file.
   *
   * Không cần bung gì cả: đường dẫn đã nằm ngay đó. Đây cũng là lối nhảy hữu dụng nhất trong ba
   * lối, vì DOCTYPE là chỗ người ta nhìn khi muốn biết controller này kéo những gì vào.
   */
  if (target.kind === 'system') {
    const abs = core.resolveSystemPath(file, target.path);
    return locationAt(core, abs, 0, 0, document);
  }

  const expanded = core.expandEntities(document.getText(), {
    filePath: file,
    readFile: cachedReadFile(core),
  });

  if (target.kind === 'entity') {
    const decl = expanded.declarations.get(target.name);
    if (!decl) {
      // Chưa khai thì KHÔNG có định nghĩa để mà tới. Chẩn đoán đã kêu chuyện này ở chỗ khác;
      // ở đây chỉ cần im lặng nhường, đừng nhảy đại đi đâu.
      output.appendLine(`F12: &${target.name}; chưa có khai báo`);
      return undefined;
    }
    /*
     * Entity trỏ FILE thì nhảy tới CHÍNH FILE ẤY, không nhảy tới dòng khai báo.
     *
     * «Đi tới định nghĩa» của một `&Rows;` là đi tới NỘI DUNG nó bung ra. Nhảy vào
     * `<!ENTITY Rows SYSTEM …>` là dừng lại ở tấm biển chỉ đường, và người dùng phải bấm thêm
     * một lần nữa — đúng cái F12 sinh ra để khỏi phải làm.
     *
     * Entity khai INLINE thì ngược lại: nội dung CHÍNH LÀ giá trị trong nháy, nên nhảy tới đó.
     */
    if (decl.system !== null) {
      const abs = core.resolveSystemPath(decl.file, decl.system);
      return locationAt(core, abs, 0, 0, document);
    }
    const len = String(decl.value ?? '').length;
    return locationAt(core, decl.file, decl.valueStart, decl.valueStart + len, document);
  }

  if (target.kind === 'field') {
    const span = core.fieldDeclarationSpan(expanded.clearText, target.name);
    if (!span) {
      output.appendLine(`F12: không có <field name="${target.name}">`);
      return undefined;
    }
    /*
     * Dải nằm trong văn bản ĐÃ BUNG, một chuỗi không có trên đĩa của ai. `sourceRange` quy nó về
     * file thật — và với field khai ở Include thì file thật KHÁC file đang mở. Đó chính là chỗ
     * cú nhảy này đáng giá nhất.
     */
    const range = core.sourceRange(expanded.segments, span.start, span.end);
    if (!range) return undefined;
    return locationAt(core, range.file, range.start, range.end, document);
  }

  return undefined;
}

module.exports = { registerDefinitions, locationAt };
