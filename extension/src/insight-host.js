// insight-host.js — CHẾ ĐỘ SOI: vẽ trực tiếp trên file controller.
//
// Mỗi `&Name;` được gạch chân, tô nền theo file nguồn, và ngay SAU nó là một dòng chữ MỘT DÒNG
// DUY NHẤT: nội dung nó bung ra (cắt ngắn nếu dài), hoặc `(rỗng)`, hoặc `⚠` nếu chưa khai. Không
// chèn dòng, không tràn xuống dòng dưới — file vẫn gõ được, vẫn `Ctrl+F` được như thường.
//
// KHÔNG có hover, không có mục lục, không có F12 — extension khác đã đảm nhận ba việc đó cho
// file XML nói chung. Chế độ soi chỉ còn đúng một việc mà không extension chung nào biết làm:
// nói NỘI DUNG THẬT một `&Name;` của FBO bung ra là gì, ngay bên cạnh nó.
//
// Bật/tắt qua cấu hình `fboDesigner.showInsight` (mặc định BẬT) — không phải lệnh, không phím
// tắt: đổi trong Settings là thấy ngay, không cần mở lại file.
//
// Vì sao annotation neo NGAY SAU `&Name;`, không phải cuối dòng: nhiều file FBO thật có nhiều thứ
// trên cùng một dòng với entity (`]]>&Name;<![CDATA[` — đóng CDATA, chèn Include, mở CDATA lại) —
// neo ở cuối dòng làm mũi tên trông như thuộc về CẢ DÒNG chứ không phải riêng `&Name;`. Neo ngay
// sau tham chiếu thì mũi tên luôn rõ ràng là của đúng cái vừa đứng trước nó, bất kể dòng còn gì.

const vscode = require('vscode');

const { cachedReadFile, samePath } = require('./render-host');
const { t } = require('./locale');

/**
 * Phạm vi RỘNG như provider ngôn ngữ, không phải như designer.
 *
 * Soi entity không cần vẽ được màn hình mới hữu ích — ngược lại: `Include\*.ent` mới là loại
 * file dày entity nhất. Ở đó phần lớn tham chiếu sẽ là «chưa có khai báo» (file không có
 * DOCTYPE riêng), và đó là câu trả lời ĐÚNG chứ không phải nhiễu: nó nói thẳng rằng mảnh này
 * không tự đứng một mình được.
 */
const CONTROLLER_PATH = /[\\/]App_Data[\\/]Controllers[\\/].+\.(xml|f)$/i;

const isInsightDocument = (doc) => !!doc
  && doc.uri.scheme === 'file'
  && CONTROLLER_PATH.test(doc.uri.fsPath);

/** `fboDesigner.showInsight` — mặc định BẬT, cùng quy ước với `autoLoadSampleData` (`sample-host.js`). */
const insightEnabled = () => vscode.workspace.getConfiguration('fboDesigner').get('showInsight') !== false;

/**
 * Bảng màu — 8 ô, quay vòng theo file nguồn.
 *
 * Mỗi ô hai giá trị vì editor có hai nền: màu đủ sáng để đọc trên nền tối thì nhạt tới mức
 * biến mất trên nền sáng. Lấy thẳng theo bộ token của Dark+/Light+ nên nó không chọi với màu
 * cú pháp đang có sẵn trên cùng dòng.
 *
 * Tám là con số cố ý: nhiều hơn thì hai màu cạnh nhau bắt đầu giống nhau, và cả điểm của việc
 * tô màu là PHÂN BIỆT ĐƯỢC bằng mắt, không phải mã hoá đủ mọi file.
 */
const PALETTE = [
  { dark: '#4FC1FF', light: '#0451A5' },
  { dark: '#C586C0', light: '#AF00DB' },
  { dark: '#4EC9B0', light: '#007D7D' },
  { dark: '#DCDCAA', light: '#795E26' },
  { dark: '#CE9178', light: '#A31515' },
  { dark: '#B5CEA8', light: '#098658' },
  { dark: '#F48771', light: '#C72E0F' },
  { dark: '#9CDCFE', light: '#1B6CA8' },
];

/** Màu của tham chiếu KHÔNG phân giải được — cố ý đứng ngoài bảng màu. */
const BROKEN = { dark: '#F14C4C', light: '#E51400' };

const shortName = (p) => String(p).split(/[\\/]/).pop();

/** Đường dẫn trình bày cho người đọc — tương đối workspace khi được, tên file khi không. */
function displayPath(abs) {
  if (!abs) return '';
  try {
    return vscode.workspace.asRelativePath(abs);
  } catch {
    return shortName(abs);
  }
}

/**
 * Nhớ bản soi theo (file, phiên bản tài liệu) — cùng lý do với `language-host.js`: một lần soi
 * là đọc lại toàn bộ cây Include.
 */
let memo = { key: '', value: null };

/**
 * Bản soi của MỘT file nguồn, dù nó đang mở hay không.
 *
 * Ưu tiên bản trong editor (có thể đang dirty — đó mới là thứ người dùng đang nhìn), rơi về đĩa.
 *
 * @returns {object|null} `null` khi không đọc được file
 */
function insightFor(core, fsPath) {
  const doc = vscode.workspace.textDocuments
    .find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, fsPath));
  const text = doc ? doc.getText() : cachedReadFile(core)(fsPath);
  if (typeof text !== 'string') return null;

  const key = `${fsPath} ${doc ? doc.version : 'disk'}`;
  if (memo.key === key) return memo.value;
  const value = core.buildEntityInsight(text, {
    filePath: fsPath,
    readFile: cachedReadFile(core),
  });
  memo = { key, value };
  return value;
}

/** Gõ một phím không được kéo theo một lượt bung cả cây Include. */
const DEBOUNCE_MS = 200;

function registerInsight(context, core, output) {
  const refTypes = refDecorationTypes();
  /*
   * MỘT kiểu cho mọi dòng chú giải, không phải một kiểu mỗi màu.
   *
   * Được, vì màu của chú giải khai ở TỪNG MỤC (`renderOptions.after.color`) chứ không ở kiểu —
   * khác viền và nền, vốn chỉ khai được ở tầng kiểu.
   */
  const noteType = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  context.subscriptions.push(...refTypes, noteType);

  let timer = null;

  const clear = (editor) => {
    for (const type of refTypes) editor.setDecorations(type, []);
    editor.setDecorations(noteType, []);
  };

  /** Chữ vẽ ngay sau `&Name;` — LUÔN một dòng, không bao giờ tràn xuống dòng dưới. */
  function noteText(ref) {
    if (ref.status === 'unresolved') return ' ⚠';
    if (ref.status === 'empty' || ref.value === '') return ` ⇢ ${t('insight.empty')}`;
    return ` ⇢ ${ref.inline}`;
  }

  /**
   * Trên file XML: vệt phủ `&Name;` (viền, nền — KHÔNG hover, xem đầu file), và MỘT chữ chú
   * giải ngay sau nó.
   *
   * `ref.inline` đã cắt sẵn theo `inlineMax` (`core/src/insight.mjs`) — không cần dựng lại, và
   * không bao giờ chứa `\n` nên không có gì để mà tràn dòng.
   */
  function paintRefs(editor, insight) {
    const buckets = refTypes.map(() => []);
    const notes = [];
    insight.refs.forEach((ref) => {
      const range = new vscode.Range(
        editor.document.positionAt(ref.start),
        editor.document.positionAt(ref.end),
      );
      buckets[bucketOf(ref, refTypes.length)].push({ range });

      const color = colorOf(ref);
      const after = { contentText: noteText(ref), fontStyle: 'italic' };
      notes.push({
        // Dải RỖNG ngay sau `&Name;` — chú giải chỉ treo vào đó, không tô lên chữ nào của file.
        range: new vscode.Range(range.end, range.end),
        renderOptions: {
          light: { after: { ...after, color: color.light } },
          dark: { after: { ...after, color: color.dark } },
        },
      });
    });
    buckets.forEach((items, i) => editor.setDecorations(refTypes[i], items));
    editor.setDecorations(noteType, notes);
  }

  function paint(editor) {
    if (!editor || !editor.document) return null;
    if (!insightEnabled() || !isInsightDocument(editor.document)) {
      clear(editor);
      return null;
    }

    let insight;
    try {
      insight = insightFor(core, editor.document.uri.fsPath);
    } catch (err) {
      // Gõ dở, Include mất, đường dẫn lạ — bỏ vệt cũ đi rồi im lặng. Một chế độ xem không được
      // phép nổ lên giữa lúc người ta đang gõ.
      output.appendLine(`soi entity bỏ qua ${editor.document.uri.fsPath}: ${err && err.message}`);
      insight = null;
    }
    if (!insight) {
      clear(editor);
      return null;
    }

    paintRefs(editor, insight);
    return insight;
  }

  const paintAll = () => {
    for (const editor of vscode.window.visibleTextEditors) paint(editor);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      paintAll();
    }, DEBOUNCE_MS);
  };

  /** Bảng màu đã dùng, in ra Output — nơi duy nhất đủ chỗ cho một danh sách file. */
  function legend(insight) {
    if (!insight || insight.groups.length === 0) return;
    output.appendLine(t('insight.legend'));
    insight.groups.forEach((g, i) => {
      const c = PALETTE[i % PALETTE.length];
      output.appendLine(`  ${c.dark}  ${displayPath(g.file)} — ${g.refs}`);
    });
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      legend(paint(editor));
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => paintAll()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isInsightDocument(e.document)) schedule();
    }),
    /*
     * File Include ĐỔI thì bản soi của MỌI controller đang mở phải dựng lại — nội dung nó bung
     * ra vừa khác đi. `onDidChangeTextDocument` không cứu được ca này: file thay đổi có thể
     * không phải file đang mở, và `document.version` của controller thì không nhúc nhích, nên
     * bộ nhớ đệm sẽ trả lại đúng bản cũ. Xoá đệm rồi vẽ lại là cách duy nhất thấy được thay đổi.
     */
    vscode.workspace.onDidSaveTextDocument(() => {
      memo = { key: '', value: null };
      paintAll();
    }),
    // Đổi `fboDesigner.showInsight` trong Settings thấy hiệu quả NGAY, không cần mở lại file.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('fboDesigner.showInsight')) paintAll();
    }),
  );

  // Vẽ ngay lúc kích hoạt — không chờ một sự kiện nào.
  paintAll();
  legend(paint(vscode.window.activeTextEditor));

  return {
    paint, paintAll, insightFor: (fsPath) => insightFor(core, fsPath), refTypes, noteType,
  };
}

/* ─── Kiểu trang trí ──────────────────────────────────────────────────────────────────────── */

/** Trên file XML: gạch chân dưới `&Name;`, nền rất nhạt. */
function refDecorationTypes() {
  const types = PALETTE.map((c) => vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 1px 0',
    borderStyle: 'solid',
    light: { borderColor: c.light, backgroundColor: `${c.light}22` },
    dark: { borderColor: c.dark, backgroundColor: `${c.dark}22` },
  }));
  // Gạch đứt nét, không phải gạch liền: cùng ngôn ngữ với gạch của Problems, nên không phải học
  // thêm quy ước nào để biết đây là chỗ hỏng.
  types.push(vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    borderWidth: '0 0 1px 0',
    borderStyle: 'dashed',
    light: { borderColor: BROKEN.light, backgroundColor: `${BROKEN.light}22` },
    dark: { borderColor: BROKEN.dark, backgroundColor: `${BROKEN.dark}22` },
  }));
  return types;
}

/* ─── Màu ──────────────────────────────────────────────────────────────────────────────────── */

/** Ô màu của một tham chiếu; ô CUỐI của mảng là ô dành cho tham chiếu hỏng. */
const bucketOf = (ref, count) => (ref.status === 'unresolved' || ref.group < 0
  ? count - 1
  : ref.group % PALETTE.length);

/** Màu của một tham chiếu — cùng phép chọn với `bucketOf`, để vệt và chú giải không lệch nhau. */
const colorOf = (ref) => (ref.status === 'unresolved' || ref.group < 0
  ? BROKEN
  : PALETTE[ref.group % PALETTE.length]);

module.exports = {
  registerInsight,
  isInsightDocument,
  displayPath,
  PALETTE,
  BROKEN,
  colorOf,
};
