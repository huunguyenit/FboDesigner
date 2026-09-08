// sample-host.js — lệnh «Xem dữ liệu thật trên lưới».
//
// Đây là lệnh DUY NHẤT của extension ĐỌC DỮ LIỆU NGHIỆP VỤ của khách. Mọi lệnh khác chỉ đọc
// lược đồ (`sys.columns`, `sys.types`) hoặc sinh script cho người khác chạy. Nên nó có mấy luật
// riêng, và đừng gỡ chúng đi cho gọn:
//
//   1. TỰ CHẠY LÀ MỘT CÔNG TẮC, và người dùng cầm nó. `fboDesigner.autoLoadSampleData` bật thì
//      mở giao diện giả lập cho một LƯỚI sẽ tự nạp một lần; tắt thì y như trước — chỉ chạy khi
//      bấm `Ctrl+Alt+D`. Không có nhánh nào chạy khi gõ phím hay khi vẽ lại.
//
//      Bản đầu để luật này là «không bao giờ tự chạy». Đổi theo yêu cầu của người dùng
//      (2026-09-07): dữ liệu thật là thứ họ muốn thấy NGAY khi mở lưới, không phải sau một phím
//      tắt nữa. Cái chặn lại vẫn nguyên: chỉ lưới, chỉ một lần cho mỗi file, che vẫn bật, và
//      TẮT TAY THẮNG — bấm `Ctrl+Alt+D` để tắt thì file ấy không tự nạp lại trong phiên này.
//   2. HIỆN GIÁ TRỊ SQL THẬT. Che từng ký tự từng là tuỳ chọn `maskSampleData` — bỏ: xem trước
//      phải khớp dữ liệu trả về (kể cả tiếng Việt có dấu), không phải bản đã thay bằng x/X/0.
//   3. CÓ TRẦN, CÓ HẠN GIỜ. `top n` do core dựng (trần 100), `READ UNCOMMITTED` để không khoá
//      ai đang làm việc thật, `sqlcmd` hạn 10 giây — riêng nhánh báo cáo 60 giây, vì nó gọi tới
//      một stored procedure báo cáo thật.
//   4. KHÔNG GIỮ LẠI. Dữ liệu nằm trong bộ nhớ của phiên VS Code (`sample-store.js`), không ghi
//      đĩa, không sống qua một lần đóng cửa sổ.
//   5. HỎI TRƯỚC KHI CHẠY BÁO CÁO, BẰNG MỘT FORM. Đó là nhánh duy nhất gọi một stored procedure
//      của khách với tham số người dùng vừa nhập — nó có thể chạy lâu và ghi bảng tạm y như một
//      lần chạy báo cáo thật. Ba nhánh còn lại chỉ đọc, chạy thẳng.
//
//      Form ấy là hộp thoại RIÊNG của extension (`dialog/`), không phải chuỗi QuickPick +
//      InputBox nữa: một báo cáo tồn kho hỏi 17 tham số, và nhìn thấy cả 17 ô cùng lúc — nhãn
//      lấy từ `<field>` của chính file Filter — là khác hẳn với bấm qua một danh sách từng cái
//      một. Nút chính của form CŨNG là chỗ xác nhận: một form rồi một hộp cảnh báo nữa là hỏi
//      hai lần cho cùng một quyết định.
//   7. LƯỚI CHI TIẾT DÒ TRƯỚC, ĐỌC SAU. Xem `buildSampleProbe` của core: nó cần biết chứng từ
//      nào và kỳ nào TRƯỚC khi dựng được câu đọc dữ liệu, nên nhánh ấy chạy HAI câu.
//   6. TỰ CHẠY THÌ KHÔNG BAO GIỜ HỎI. Lượt tự nạp bỏ qua mọi lưới cần hộp thoại (báo cáo, và
//      lưới nào có tham số `@x`) và không bật một thông báo nào — nó im lặng ghi lý do ra Output.
//      Một hộp thoại tự bật lên vì người ta vừa MỞ một file là thứ dạy người ta tắt tuỳ chọn.
//
// Luật «chỉ-đọc» nay là luật của FILE CONTROLLER, không còn là luật của công cụ: từ bản này
// lệnh chạy CHÍNH câu query của controller (xem đầu `core/src/grid-sample.mjs`). Đổi lấy điều
// đó là dữ liệu xem trước giống hệt dữ liệu runtime — đúng join, đúng kỳ, đúng phân quyền.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const { isControllerDocument, loadGridConfig, readOptionFormats } = require('./render-host');
const sqlHost = require('./sql-host');
const store = require('./sample-store');
const { t, toast } = require('./locale');
const { dialogs } = require('./dialog/dialog-service');

/** Hạn giờ cho ba nhánh đọc thẳng. */
const TIMEOUT_READ = 10000;
/** Hạn giờ cho nhánh báo cáo — nó gọi stored procedure báo cáo thật, mười giây là quá ngắn. */
const TIMEOUT_REPORT = 60000;

const readInclude = (core) => (abs) => {
  try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
};

function settings() {
  const c = vscode.workspace.getConfiguration('fboDesigner');
  const rows = Number(c.get('sampleRowCount'));
  const params = c.get('sampleParams');
  return {
    rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
    sqlcmdPath: c.get('sqlcmdPath') || null,
    autoLoad: c.get('autoLoadSampleData') !== false,
    // Đè lên `core/config/sample-params.json`. Chỉ nhận khoá `@@…` — một khoá gõ sai ở đây mà
    // được nhận vào là một biến không bao giờ được thay, và câu lệnh sẽ hỏng ở chỗ khác.
    params: params && typeof params === 'object'
      ? Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('@@')).map(([k, v]) => [k, String(v)]))
      : {},
  };
}

/** Liệt kê lý do từng cột bị bỏ ra Output — chỗ duy nhất nói đủ, hộp thoại chỉ đếm. */
function reportSkipped(output, plan) {
  for (const s of plan.skipped ?? []) output.appendLine(`  bỏ cột — ${s.message}`);
  for (const n of plan.notes ?? []) output.appendLine(`  ghi chú — ${n}`);
}

/**
 * Văn bản ĐÃ BUNG entity của file `Filter/<Controller>` — nguồn dữ liệu của lưới báo cáo.
 *
 * Thử `.xml` trước `.f`: `.xml` là bản đã customize, và bản đã customize là bản DUY NHẤT đọc
 * được (câu Processing của `.f` nằm trong `<Encrypted>` ở 729/751 file của FBISP24). Thử ngược
 * lại là gần như luôn tìm thấy bản không dùng được rồi dừng.
 */
function readFilterText(core, gridFile, output) {
  const paths = core.resolveProgramPaths(gridFile);
  if (!paths?.controllersDir || !paths.controller) return null;
  for (const ext of ['.xml', '.f']) {
    const file = path.join(paths.controllersDir, 'Filter', `${paths.controller}${ext}`);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = core.readSource(file).text;
      output?.appendLine(`xem dữ liệu: lưới báo cáo lấy dữ liệu từ ${file}`);
      return core.expandEntities(raw, { filePath: file, readFile: readInclude(core) }).clearText;
    } catch (err) {
      output?.appendLine(`xem dữ liệu: không đọc được ${file} — ${err.message}`);
    }
  }
  return null;
}

/**
 * FORM hỏi giá trị cho từng tham số `@x` mà câu query của file cần.
 *
 * Không riêng báo cáo: 6 lưới chi tiết của FBISP24 cũng hỏi (`@ma_vt`, `@stt_rec` — khoá của
 * hàng cha mà runtime bơm vào). Nhãn và giá trị mặc định lấy từ `<field>` của `fieldSource` —
 * file Filter với lưới báo cáo, chính file lưới với những lưới còn lại. Tức người dùng nhìn thấy
 * đúng những ô họ nhìn thấy trên màn hình lọc thật, đúng tên ấy, đúng mặc định ấy.
 *
 * MỘT form, không phải một chuỗi hộp nhập nối đuôi: báo cáo tồn kho hỏi 17 tham số, mà người
 * dùng thường chỉ sửa hai (từ ngày, kho). Bắt họ bấm qua mười lăm cái để tới cái thứ mười sáu là
 * cách chắc chắn nhất khiến không ai dùng lệnh này lần thứ hai.
 *
 * `report` bật thì form NÀY cũng là chỗ xác nhận — khối cảnh báo nằm ngay trên các ô, nút chính
 * mang chữ «Chạy báo cáo». Hỏi lại lần nữa bằng một hộp thoại thứ hai là hỏi hai lần cho cùng
 * một quyết định, và nó dạy người ta bấm Enter cho xong.
 *
 * CỘT NGÀY HIỆN THEO `field@dataFormatString` (`dd/MM/yyyy` mặc định, hoặc mặt nạ thật đọc từ
 * `Options.xml` nếu field trỏ `@tên`) — KHÔNG hiện chuỗi SQL trần `2026-09-07`. `formats` là bản
 * đồ `{tên: mặt nạ}` tầng vỏ đã đọc sẵn (xem `readOptionFormats`); `scriptParamFields` chỉ dùng
 * nó để tính `mask`, còn ĐỔI QUA LẠI (hiện theo mặt nạ / đọc lại thành SQL) là việc ở đây, bằng
 * `core.formatDate`/`core.parseDisplayDate`.
 *
 * @returns {Promise<Record<string, {type: string, literal: string}>|null>} `null` = người dùng huỷ
 */
async function askScriptParams(core, fieldSource, names, now, { report = false, controller = '', formats = {} } = {}) {
  const plan = core.scriptParamFields(fieldSource, names, { now, formats });

  // Giá trị HIỆN trên ô nhập — theo mặt nạ của field khi có; `formatDate` tự rơi về giá trị SQL
  // gốc nếu không đọc được (ví dụ `value` rỗng), nên không cần nhánh riêng cho ca ấy.
  const displayValue = (p) => (p.mask ? core.formatDate(p.value, p.mask) ?? p.value : p.value);

  const body = [
    ...(report ? [{ type: 'highlight', kind: 'warning', content: t('extension.sample_report_confirm', { controller }) }] : []),
    ...(plan.length === 0 ? [] : [{ type: 'text', content: t('extension.sample_param_pick') }]),
    ...plan.map((p) => ({
      type: 'field',
      name: p.name,
      label: p.label ? `@${p.name} — ${p.label}` : `@${p.name}`,
      control: 'text',
      value: String(displayValue(p) ?? ''),
      // `mask` → client (dialog-panel.js: attachDateMask) tự nhảy vùng, giữ dấu phân cách khi
      // xoá, và kẹp ngày/tháng theo lịch. Không có mặt nạ (tham số không phải cột ngày) thì ô
      // vẫn là một text input trần như trước.
      mask: p.mask || '',
      placeholder: p.mask || '',
      hint: [p.sqlType, p.mask].filter(Boolean).join('  ·  '),
    })),
  ];

  const result = await dialogs().show({
    type: report ? 'warning' : 'info',
    title: t(report ? 'extension.sample_report_dialog_title' : 'extension.sample_param_dialog_title'),
    size: plan.length > 6 ? 'large' : 'medium',
    body,
    buttons: [
      { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
      { id: 'run', label: t(report ? 'extension.sample_report_run' : 'extension.sample_param_run'), variant: 'primary', action: 'confirm' },
    ],
  });
  if (!result || result.action === 'close' || result.action === 'cancel') return null;

  /*
   * `values` KHÔNG có khoá của một ô mà người dùng không đụng tới ở vài đường vẽ; lấy giá trị mặc
   * định của `plan` làm nền để một ô bỏ trống nghĩa là «giữ mặc định», không phải «gửi undefined».
   *
   * Ô đó (dù người dùng gõ hay giữ mặc định) đang mang chuỗi THEO MẶT NẠ (`08/09/2026`), không
   * phải chuỗi SQL — đọc ngược lại bằng `parseDisplayDate` trước khi đưa cho `scriptParamLiteral`.
   * Đọc KHÔNG ra (gõ sai định dạng, hay field không phải cột ngày) thì giữ nguyên chuỗi gốc: để
   * SQL Server tự báo lỗi cú pháp còn hơn ta âm thầm nuốt mất giá trị người dùng vừa gõ.
   */
  const typed = result.values || {};
  return Object.fromEntries(plan.map((p) => {
    const raw = typed[p.name] === undefined ? p.value : typed[p.name];
    const value = p.mask ? (core.parseDisplayDate(raw, p.mask) ?? raw) : raw;
    return [p.name, { type: p.sqlType, literal: core.scriptParamLiteral(p.sqlType, value) }];
  }));
}

/**
 * BƯỚC 1 của lưới chi tiết — chạy câu dò, trả `{period, key}` cho `buildSampleSelect`.
 *
 * Hỏng ở bất kỳ đâu (không dựng được câu, sqlcmd lỗi, bảng rỗng) đều trả `null` và GHI LÝ DO,
 * chứ không dừng cả lệnh: bước 2 vẫn chạy được với `@@whereClause` = `1 = 1` và kỳ lịch. Kém
 * hơn, nhưng một bản xem trước kém vẫn hơn không có bản nào.
 */
async function runProbe(core, output, text, conn, opts) {
  const probe = core.buildSampleProbe(text);
  if (!probe.ok) {
    output.appendLine(`xem dữ liệu: bỏ qua câu dò — ${probe.reason}`);
    return null;
  }

  output.appendLine(`xem dữ liệu: câu dò trên bảng "${probe.table}"`);
  const result = await sqlHost.runSampleQuery(conn, probe.sql, probe.columns, {
    sqlcmdPath: opts.sqlcmdPath,
    timeoutMs: TIMEOUT_READ,
    sentinel: core.SAMPLE_SENTINEL,
    textAsHex: false,
  });

  if (!result.ok) {
    output.appendLine(`xem dữ liệu: câu dò lỗi — ${result.reason}`);
    output.appendLine(probe.sql);
    return null;
  }
  if (result.rows.length === 0) {
    output.appendLine(`xem dữ liệu: câu dò không thấy dòng nào trong "${probe.table}"`);
    return null;
  }

  const row = result.rows[0];
  const value = { period: probe.hasPeriod ? String(row.period ?? '') : '', key: String(row.key ?? '') };
  output.appendLine(`xem dữ liệu: câu dò chọn ${probe.keyColumn} = "${value.key}"${value.period ? `, kỳ ${value.period}` : ''}`);
  return value;
}

/**
 * Nạp dữ liệu thật cho một document lưới.
 *
 * `interactive` là toàn bộ khác biệt giữa hai cửa vào, và nó chia đôi mọi nhánh «cần con
 * người»:
 *
 *   `true`   người dùng vừa bấm `Ctrl+Alt+D`. Được hỏi tham số, được hiện hộp cảnh báo báo cáo,
 *            được bật thông báo — họ đang chờ một câu trả lời.
 *   `false`  lượt TỰ NẠP lúc mở giao diện. Không hỏi, không thông báo; ca nào cần hỏi thì bỏ
 *            qua và ghi lý do ra Output.
 *
 * @returns {Promise<boolean>} có nạp được dòng nào không
 */
async function loadSample(core, output, document, { interactive }) {
  const file = document.uri.fsPath;
  const say = (key, args) => { if (interactive) vscode.window.showWarningMessage(toast(key, args)); };
  const skip = (reason) => { output.appendLine(`xem dữ liệu: bỏ qua lượt tự nạp — ${reason}`); return false; };

  const expanded = core.expandEntities(document.getText(), {
    filePath: file,
    readFile: readInclude(core),
  });

  const root = core.scanRoot(expanded.clearText);
  if (root.mode !== 'grid') {
    say('extension.sample_only_grid');
    return false;
  }

  const opts = settings();
  const kind = core.sampleKindOf(root.attrs?.type);
  const now = new Date();

  // Lưới báo cáo LUÔN cần một hộp thoại (tham số + xác nhận), nên nó không bao giờ tự nạp.
  if (!interactive && kind === 'report') return skip('lưới báo cáo cần nhập tham số');

  /*
   * Nối database TRƯỚC khi dựng câu lệnh, không phải sau.
   *
   * Vì `@@sysDatabaseName` và `@@appDatabaseName` là hai biến chỉ kết nối mới biết, mà chúng có
   * mặt trong câu query của rất nhiều controller (750 chỗ trong FBISP24). Dựng trước rồi mới
   * nối là dựng ra một câu còn nguyên hai biến ấy, tức một câu chắc chắn hỏng.
   */
  const paths = core.resolveProgramPaths(file);
  const database = String(root.attrs?.database ?? '').trim() || 'app';
  const target = await sqlHost.resolveTargetConnection(core, paths?.programRoot, database, output, 'xem dữ liệu');
  if (!target.ok) {
    output.appendLine(`xem dữ liệu: không nối được database — ${target.reason}`);
    say('extension.sample_no_connection', { reason: target.reason });
    return false;
  }
  const sysConn = sqlHost.readConnection(core, paths?.programRoot, 'sysConnectionString', output);
  const params = {
    ...(target.conn.database ? { '@@appDatabaseName': target.conn.database } : {}),
    ...(sysConn?.database ? { '@@sysDatabaseName': sysConn.database } : {}),
    ...opts.params,
  };

  const filterText = kind === 'report' ? readFilterText(core, file, output) : null;

  /*
   * Cột người dùng NHÌN THẤY = view controller + `Grid/Config` (Initialize group / Fields).
   *
   * Bản vẽ đã merge qua `loadGridConfig` → `mergeGridConfig`. SELECT mẫu phải cùng danh sách
   * ấy: thiếu `status` của group 101 trong khi lưới đã hiện cột là xem trước nói dối.
   */
  const configParts = loadGridConfig(core, file, readInclude(core), new Map());
  const scanned = core.scanGridConfig(configParts);
  const views = core.scanViews(expanded.clearText);
  const hostFields = core.scanFields(expanded.clearText);
  const view = views.find((v) => (v.columns ?? []).length > 0) ?? views[0];
  const merged = view
    ? core.mergeGridConfig(view, hostFields, scanned, [])
    : { view: null, fields: hostFields };
  const columnNames = (merged.view?.columns ?? []).map((c) => c.name);

  /*
   * Cấu hình thêm cột thì cũng phải thêm JOIN nuôi cột ấy.
   *
   * `Grid/Config` khai điều đó dưới dạng vá chuỗi (`<query event="Loading"><items><item source
   * destination/>`), không phải một câu query mới. Bỏ qua là câu mẫu mang `v0.ten_nvbh` trong
   * khi mệnh đề join truyền cho proc không hề có `v0` — "The multi-part identifier could not be
   * bound", và nó giết cả câu chứ không chỉ một cột.
   */
  const rewrites = core.configQueryRewrites(scanned, 'Loading');

  /*
   * BƯỚC 1 — chỉ lưới chi tiết, và chỉ vì nó KHÔNG tự đứng được: khoá chứng từ và kỳ của chứng
   * từ ấy là hai thứ màn hình cha bơm vào, mà ở đây không có màn hình cha nào. Đi hỏi database
   * trước; hỏng thì `probe` là `null` và bước 2 quay về `1 = 1` + kỳ lịch.
   */
  const probe = kind === 'detail'
    ? await runProbe(core, output, expanded.clearText, target.conn, opts)
    : null;

  const build = (scriptParams) => core.buildSampleSelect(expanded.clearText, {
    top: opts.rows,
    params,
    filterText,
    scriptParams,
    now,
    probe,
    columns: columnNames.length > 0 ? columnNames : null,
    fields: merged.fields,
    rewrites,
  });

  let plan = build({});

  /*
   * Bản dựng đầu chỉ để BIẾT phải hỏi những gì. Hỏi xong dựng lại.
   *
   * Lưới báo cáo đi vào form KỂ CẢ khi câu Processing không cần tham số nào: form ấy cũng là chỗ
   * xác nhận «có chạy stored procedure của khách không», và câu hỏi ấy không phụ thuộc vào việc
   * proc có tham số hay không.
   */
  let needsParams = !plan.ok && plan.code === 'sample.need_params';
  let remainingParams = needsParams ? plan.needsParams : [];
  let autoFilled = {};
  // Tham số CUỐI CÙNG đã dùng để dựng `plan` — BƯỚC 0 của báo cáo (bên dưới) dựng LẠI câu lệnh
  // với cùng bấy nhiêu tham số, chỉ thêm schema; không được đánh mất @x người dùng vừa nhập.
  let finalScriptParams = autoFilled;

  /*
   * KHOÁ CHÍNH ĐÃ DÒ ĐƯỢC Ở BƯỚC 1 — 6 lưới chi tiết của FBISP24 đòi đúng khoá ấy dưới dạng một
   * tham số `@x` thẳng (`@stt_rec`) thay vì qua `@@whereClause`. `probe.key` đã trả lời câu hỏi
   * ấy rồi; hỏi lại bằng hộp thoại là hỏi một thứ vừa mới tự lấy được từ chính database.
   *
   * CHỈ điền tham số TRÙNG TÊN với `grid@code` — mọi tham số khác (`@ma_vt` của một khoá cha
   * khác) không có nguồn nào chắc chắn ở đây, nên vẫn phải hỏi.
   */
  if (needsParams && probe?.key) {
    const primaryKeyName = String(root.attrs?.code ?? '').trim();
    const match = remainingParams.find((n) => String(n).toLowerCase() === primaryKeyName.toLowerCase());
    if (match) {
      const [field] = core.scriptParamFields(filterText ?? expanded.clearText, [match], { now });
      autoFilled = { [match]: { type: field.sqlType, literal: core.scriptParamLiteral(field.sqlType, probe.key) } };
      finalScriptParams = autoFilled;
      remainingParams = remainingParams.filter((n) => n !== match);
      output.appendLine(`xem dữ liệu: điền @${match} bằng khoá vừa dò được ở bước 1 (${probe.key}), không hỏi`);
      if (remainingParams.length === 0) {
        plan = build(autoFilled);
        needsParams = false;
      }
    }
  }

  // `plan.ok` trong vế sau: một lưới báo cáo KHÔNG dựng được câu (thiếu file Filter, Processing
  // mã hoá) thì không có gì để xác nhận — nói thẳng lý do, đừng bắt người ta điền form rồi mới
  // nói.
  if (needsParams || (plan.ok && plan.kind === 'report')) {
    if (!interactive) return skip(needsParams ? plan.reason : 'lưới báo cáo cần xác nhận');
    // Mặt nạ ngày của form — đọc CHỈ khi thật sự cần hỏi, tránh một lượt đọc đĩa cho mọi lưới.
    const formats = readOptionFormats(core, paths?.programRoot, output);
    const answered = await askScriptParams(
      core,
      filterText ?? expanded.clearText,
      needsParams ? remainingParams : [],
      now,
      { report: plan.kind === 'report', controller: paths?.controller ?? '', formats },
    );
    if (!answered) {
      vscode.window.showInformationMessage(toast('extension.sample_params_cancelled'));
      return false;
    }
    if (needsParams) {
      finalScriptParams = { ...autoFilled, ...answered };
      plan = build(finalScriptParams);
    }
  }

  if (!plan.ok) {
    output.appendLine(`xem dữ liệu: không dựng được câu lệnh — ${plan.reason}`);
    reportSkipped(output, plan);
    say('extension.sample_cannot_build', { reason: plan.reason });
    return false;
  }

  output.appendLine(`xem dữ liệu: lưới ${plan.kind}, ${plan.columns.length} cột, top ${plan.top}, bảng "${plan.table}"`);
  reportSkipped(output, plan);

  /*
   * `headerMapped` — báo cáo mà proc/câu tự in kết quả (không qua `##fbo$sample`): CHẠY ĐỦ
   * SCRIPT, KHÔNG SỬA GÌ (không mốc, không bảng tạm, không dò schema), rồi tự đếm có bao nhiêu
   * bảng THẬT SỰ trả về và chọn đúng bảng `dir@id` — xem `sql-host.js: runSampleQueryDataset`.
   * Không hex-hoá (không cần — đường `sqlcmd -i/-o/-f 65001` mới đã ra đúng dấu tiếng Việt).
   */
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: t('extension.sample_running') },
    () => (plan.headerMapped
      ? sqlHost.runSampleQueryDataset(
        target.conn,
        plan.sql,
        plan.datasetIndex,
        plan.columns.map((c) => ({ name: c.column, label: c.label, textual: c.textual === true })),
        { sqlcmdPath: opts.sqlcmdPath, timeoutMs: plan.kind === 'report' ? TIMEOUT_REPORT : TIMEOUT_READ },
      )
      : sqlHost.runSampleQuery(
        target.conn,
        plan.sql,
        plan.columns.map((c) => ({ label: c.label, textual: c.textual === true })),
        {
          sqlcmdPath: opts.sqlcmdPath,
          timeoutMs: plan.kind === 'report' ? TIMEOUT_REPORT : TIMEOUT_READ,
          sentinel: core.SAMPLE_SENTINEL,
          textAsHex: plan.textAsHex === true,
        },
      )),
  );

  if (!result.ok) {
    // KHÔNG in `plan.sql` ra thông báo cho người dùng: nó mang tên bảng và tên cột của khách,
    // và thông báo thì hay bị chụp lại gửi đi. Output Channel là chỗ đủ riêng để chẩn đoán.
    output.appendLine(`xem dữ liệu: truy vấn lỗi — ${result.reason}`);
    output.appendLine(plan.sql);
    if (interactive) vscode.window.showErrorMessage(toast('extension.sample_query_failed', { reason: result.reason }));
    return false;
  }

  /*
   * `result.tableCount`/`tableIndex` — CHỈ `runSampleQueryDataset` trả về: số bảng script THẬT
   * SỰ sinh ra chỉ biết được SAU KHI CHẠY (xem `grid-sample.mjs: buildDirectResultsetSelect`).
   */
  if (Number.isInteger(result.tableCount)) {
    output.appendLine(`xem dữ liệu: script trả về ${result.tableCount} bảng, đọc bảng ${result.tableIndex}`);
    if (result.outOfRange) {
      output.appendLine(`  ${core.msg('sample.note_report_dataset_out_of_range', { id: plan.datasetIndex, count: result.tableCount })}`);
    }
  }

  if (result.rows.length === 0) {
    output.appendLine(plan.sql);
    if (interactive) vscode.window.showInformationMessage(toast('extension.sample_no_rows', { table: plan.table }));
    return false;
  }

  /*
   * `result.skipped` — CHỈ `runSampleQueryNamed` trả về: field khai trong lưới mà resultset
   * THẬT SỰ không có cột trùng tên. Biết được điều này chỉ SAU khi chạy xong, khác với
   * `plan.skipped` (biết ngay lúc dựng câu) — gộp cả hai vào một chỗ để người dùng thấy đủ.
   */
  if (result.skipped?.length > 0) {
    for (const name of result.skipped) output.appendLine(`  bỏ cột — "${name}" không có trong resultset thật (khớp theo tên)`);
  }
  const skippedCount = plan.skipped.length + (result.skipped?.length ?? 0);

  /*
   * CẮT CÒN ĐÚNG `plan.top` DÒNG Ở ĐÂY — không phải ở SQL. `buildDetailSelect`/
   * `buildDirectResultsetSelect` giờ chạy KHÔNG giới hạn số dòng (SET ROWCOUNT từng chặn nhầm cả
   * các câu insert bảng tạm ở giữa script của file, ra một con số không liên quan gì tới thứ
   * người dùng đang xem — xác nhận của người dùng 2026-09-08). `plan.top` vẫn là MỘT chỗ cấu
   * hình duy nhất (`fboDesigner.sampleRowCount`, mặc định `SAMPLE_TOP_DEFAULT`) cho MỌI kiểu
   * lưới — hai nhánh còn lại (danh mục/chứng từ) đã tự giới hạn bằng `top` thật trong câu lệnh,
   * nên lát cắt này với chúng là vô hại.
   */
  const rows = result.rows.slice(0, plan.top);
  store.setSample(file, {
    rows,
    columns: plan.columns,
    skipped: plan.skipped,
    notes: plan.notes,
    masked: false,
    table: plan.table,
    top: plan.top,
    kind: plan.kind,
  });

  if (result.rows.length > rows.length) {
    output.appendLine(`xem dữ liệu: câu lệnh trả về ${result.rows.length} dòng, chỉ hiện ${rows.length} dòng đầu (fboDesigner.sampleRowCount)`);
  }
  output.appendLine(`xem dữ liệu: ${rows.length} dòng`);
  if (interactive) {
    vscode.window.showInformationMessage(toast(
      'extension.sample_done_plain',
      {
        rows: rows.length,
        // Chỉ nhắc cột bị bỏ khi THẬT SỰ có cột bị bỏ — một mệnh đề «0 cột không lấy được» dính
        // vào mọi thông báo là tiếng ồn, và tiếng ồn thì dạy người ta thôi đọc thông báo.
        skippedNote: skippedCount === 0
          ? ''
          : t('extension.sample_skipped_note', { skipped: skippedCount }),
      },
    ));
  }
  return true;
}

/** `Ctrl+Alt+D` — bật/tắt dữ liệu thật trên lưới đang mở. */
async function previewData(core, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !isControllerDocument(document)) {
    vscode.window.showWarningMessage(toast('extension.sample_only_grid'));
    return;
  }

  const file = document.uri.fsPath;

  // Đang hiện dữ liệu rồi thì lệnh này TẮT nó đi. Một phím tắt bật/tắt dễ nhớ hơn hai lệnh, và
  // «tắt đi» là việc người ta muốn làm ngay sau khi đo xong cột.
  if (store.getSample(file)) {
    store.clearSample(file);
    store.dismissSample(file);
    vscode.window.showInformationMessage(toast('extension.sample_cleared'));
    return;
  }

  await loadSample(core, output, document, { interactive: true });
}

/**
 * Lượt TỰ NẠP khi giao diện giả lập bắt đầu vẽ một file.
 *
 * Gọi được nhiều lần cho cùng một file mà không tốn gì: bốn cửa chặn ở đầu hàm đều rẻ và đều
 * đứng TRƯỚC lượt nối database. Cả hai bề mặt designer đều gọi nó, nên nó phải chịu được việc
 * bị gọi mỗi lần người dùng nhảy qua nhảy lại giữa hai file.
 *
 * Không bao giờ ném: một bản xem trước không vẽ được vì lỗi mạng thì vẫn phải vẽ được phần bố
 * cục — đó mới là thứ designer sinh ra để làm.
 */
async function autoLoadSample(core, output, document) {
  try {
    if (!document || !isControllerDocument(document)) return;
    if (!settings().autoLoad) return;
    if (store.getSample(document.uri.fsPath)) return;
    // Người dùng vừa tự tắt file này. Tôn trọng, cho tới khi họ tự bấm nạp lại.
    if (store.isDismissed(document.uri.fsPath)) return;
    await loadSample(core, output, document, { interactive: false });
  } catch (err) {
    output.appendLine(`xem dữ liệu: lượt tự nạp hỏng — ${err.message}`);
  }
}

module.exports = { previewData, autoLoadSample };
