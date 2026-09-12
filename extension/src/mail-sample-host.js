// mail-sample-host.js — lấy dữ liệu mẫu THẬT cho Email Designer từ một `stt_rec` + `contactID`.
//
// Core (`mail-sample.mjs`) chỉ dựng câu lệnh. File này là tầng vỏ: hỏi xác nhận trước khi ghi
// `dmxn`, nối database, chạy stub → probe → master → footer → detail, áp mặt nạ từ bảng format
// (resultset CUỐI của detail/footer), và nếu mẫu có `{!in_words}` thì gọi ReadCurrency.

const vscode = require('vscode');

const sqlHost = require('./sql-host');
const { t, toast } = require('./locale');
const { dialogs } = require('./dialog/dialog-service');

const TIMEOUT_MS = 15000;

function settings() {
  const c = vscode.workspace.getConfiguration('fboDesigner');
  const params = c.get('sampleParams');
  return {
    sqlcmdPath: c.get('sqlcmdPath') || null,
    params: params && typeof params === 'object'
      ? Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('@@')).map(([k, v]) => [k, String(v)]))
      : {},
  };
}

function sqlQuote(v) {
  return `'${String(v ?? '').replace(/'/g, "''")}'`;
}

function segmentToRows(segment) {
  const names = (segment.header || []).map((n) => String(n ?? '').trim());
  return (segment.data || []).map((cells) => {
    const row = {};
    names.forEach((name, i) => {
      if (!name) return;
      const cell = cells[i];
      row[name] = (cell === undefined || cell === 'NULL') ? '' : cell;
    });
    return row;
  });
}

/**
 * Sau sentinel: bảng ĐẦU = dữ liệu; nếu có ≥2 bảng và bảng CUỐI là field/format → mặt nạ.
 * (Đúng hình report mail: data rồi `select field, format …`.)
 */
function tablesAfterSentinel(raw, sentinel, core) {
  let rows = raw;
  if (sentinel) {
    const at = rows.findIndex((cells) => cells.length === 1 && cells[0] === sentinel);
    if (at !== -1) rows = rows.slice(at + 1);
  }
  const segments = sqlHost.splitResultsets(rows);
  if (segments.length === 0) {
    const header = rows[0] ?? [];
    const dash = rows[1] ?? [];
    const isDash = dash.length > 0 && dash.every((c) => /^-+$/.test(String(c ?? '').trim()));
    const data = rows.slice(isDash ? 2 : 1);
    return {
      dataRows: segmentToRows({ header, data }),
      formatRows: [],
    };
  }
  const dataRows = segmentToRows(segments[0]);
  let formatRows = [];
  if (segments.length >= 2) {
    const last = segmentToRows(segments[segments.length - 1]);
    if (core.isMailFormatTable(last)) formatRows = last;
  }
  return { dataRows, formatRows };
}

/** Giữ API cũ cho test — chỉ bảng đầu. */
function rowsOfFirstTable(raw, sentinel) {
  let rows = raw;
  if (sentinel) {
    const at = rows.findIndex((cells) => cells.length === 1 && cells[0] === sentinel);
    if (at !== -1) rows = rows.slice(at + 1);
  }
  const segments = sqlHost.splitResultsets(rows);
  let header;
  let data;
  if (segments.length > 0) {
    header = segments[0].header;
    data = segments[0].data;
  } else {
    header = rows[0] ?? [];
    const dash = rows[1] ?? [];
    const isDash = dash.length > 0 && dash.every((c) => /^-+$/.test(String(c ?? '').trim()));
    data = rows.slice(isDash ? 2 : 1);
  }
  return segmentToRows({ header, data });
}

async function runSelect(core, conn, sql, opts) {
  const result = await sqlHost.runSqlcmd(conn, sql, {
    sqlcmdPath: opts.sqlcmdPath,
    timeoutMs: TIMEOUT_MS,
    headers: true,
  });
  if (!result.ok) return result;
  const { dataRows, formatRows } = tablesAfterSentinel(result.rows, opts.sentinel, core);
  const formatMap = core.mailFormatMap(formatRows);
  const rows = opts.applyFormats
    ? core.applyMailFieldFormats(dataRows, formatMap)
    : dataRows;
  return {
    ok: true, rows, formatCount: formatMap.size, formatFields: [...formatMap.keys()],
  };
}

async function showErrorDialog(reason) {
  await dialogs().ask({
    type: 'error',
    title: t('extension.mail_sample_error_title'),
    size: 'medium',
    body: [
      { type: 'highlight', kind: 'error', content: t('extension.sample_query_failed', { reason }) },
      { type: 'text', content: t('extension.mail_sample_error_hint') },
    ],
    buttons: [
      { id: 'ok', label: t('dialog.btn.close'), variant: 'primary', action: 'confirm' },
    ],
  });
}

/**
 * @param {object} core
 * @param {{appendLine:Function}} output
 * @param {import('vscode').TextDocument} document
 * @param {{actionId:string, stt_rec:string, contactID:string, clearText:string}} opts
 * @returns {Promise<{ok:true, data:object}|{ok:false, reason:string, cancelled?:boolean}>}
 */
async function loadMailSample(core, output, document, {
  actionId, stt_rec, contactID, clearText,
}) {
  const confirmed = await dialogs().ask({
    type: 'warning',
    title: t('extension.mail_sample_dialog_title'),
    size: 'medium',
    body: [
      {
        type: 'highlight',
        kind: 'warning',
        content: t('extension.mail_sample_dmxn_confirm', { stt_rec, contactID }),
      },
      { type: 'text', content: t('extension.mail_sample_dmxn_explain') },
    ],
    buttons: [
      { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
      { id: 'run', label: t('extension.mail_sample_run'), variant: 'primary', action: 'confirm' },
    ],
  });

  if (confirmed !== 'run') {
    vscode.window.showInformationMessage(toast('extension.mail_sample_cancelled'));
    return { ok: false, reason: 'đã huỷ', cancelled: true };
  }

  const opts = settings();
  const paths = core.resolveProgramPaths(document.uri.fsPath);
  const target = await sqlHost.resolveTargetConnection(core, paths?.programRoot, 'app', output, 'dữ liệu mẫu mail');
  if (!target.ok) {
    output.appendLine(`mail sample: không nối được database — ${target.reason}`);
    await showErrorDialog(target.reason);
    return { ok: false, reason: target.reason };
  }

  const sysConn = sqlHost.readConnection(core, paths?.programRoot, 'sysConnectionString', output);
  const params = {
    ...(target.conn.database ? { '@@appDatabaseName': target.conn.database } : {}),
    ...(sysConn?.database ? { '@@sysDatabaseName': sysConn.database } : {}),
    ...opts.params,
  };

  const runOpts = { sqlcmdPath: opts.sqlcmdPath, sentinel: core.SAMPLE_SENTINEL };

  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: t('extension.mail_sample_running') },
      async () => {
        const fail = async (reason, sql) => {
          output.appendLine(`mail sample: ${reason}`);
          if (sql) output.appendLine(sql);
          await showErrorDialog(reason);
          return { ok: false, reason };
        };

        const stub = core.buildMailSampleStub({ stt_rec, contactID });
        const stubResult = await sqlHost.runSqlcmd(target.conn, stub.sql, {
          sqlcmdPath: opts.sqlcmdPath,
          timeoutMs: TIMEOUT_MS,
        });
        if (!stubResult.ok) return fail(`ghi dmxn lỗi — ${stubResult.reason}`, stub.sql);
        output.appendLine(`mail sample: đã đánh dấu dmxn (stt_rec=${stt_rec}, contactID=${contactID})`);

        const probeSql = core.buildMailTableProbe({ stt_rec });
        const probeResult = await sqlHost.runSampleQueryNamed(
          target.conn,
          probeSql.sql,
          [{ name: 'ma_nt' }, { name: 'mtable' }, { name: 'dtable' }],
          runOpts,
        );
        if (!probeResult.ok) return fail(`dò bảng lỗi — ${probeResult.reason}`, probeSql.sql);
        const probe = probeResult.rows[0];
        if (!probe?.mtable || !probe?.dtable) {
          const reason = t('extension.mail_sample_probe_empty', { stt_rec });
          return fail(reason);
        }
        output.appendLine(`mail sample: bảng master=${probe.mtable}, detail=${probe.dtable}`
          + (probe.ma_nt ? `, ma_nt=${probe.ma_nt}` : ''));

        const baseParams = {
          ...params,
          ...(probe.ma_nt ? { '@@ma_nt': sqlQuote(probe.ma_nt) } : {}),
        };
        const selectOpts = {
          actionId, stt_rec, contactID, masterTable: probe.mtable, detailTable: probe.dtable,
        };

        const runCommand = async (id, cmd, applyFormats) => {
          if (!cmd) return { ok: true, rows: [], formatCount: 0, formatFields: [] };
          const ran = await runSelect(core, target.conn, cmd.sql, { ...runOpts, applyFormats });
          if (!ran.ok) {
            await fail(`${id} lỗi — ${ran.reason}`, cmd.sql);
          } else {
            output.appendLine(`mail sample: ${id} → ${ran.rows.length} dòng (bảng ${cmd.table})`
              + (ran.formatCount ? `, ${ran.formatCount} mặt nạ` : ''));
          }
          return ran;
        };

        const masterBuilt = core.buildMailSampleSelect(clearText, {
          ...selectOpts, params: baseParams, only: ['master'],
        });
        if (!masterBuilt.ok) return fail(`không dựng được SELECT master — ${masterBuilt.reason}`);

        const parts = { master: null, detail: [], footer: null };
        const masterRan = await runCommand('master', masterBuilt.commands.master, false);
        if (!masterRan.ok) return { ok: false, reason: masterRan.reason };
        parts.master = masterRan.rows[0] ?? null;

        const dLanguage = parts.master && parts.master.d_language != null
          ? String(parts.master.d_language).trim()
          : '';
        const afterParams = {
          ...baseParams,
          ...(dLanguage !== '' ? { '@@language': sqlQuote(dLanguage) } : {}),
        };

        const restBuilt = core.buildMailSampleSelect(clearText, {
          ...selectOpts, params: afterParams, only: ['footer', 'detail'],
        });
        if (!restBuilt.ok) return fail(`không dựng được SELECT footer/detail — ${restBuilt.reason}`);

        for (const id of ['footer', 'detail']) {
          const ran = await runCommand(id, restBuilt.commands[id], true);
          if (!ran.ok) return { ok: false, reason: ran.reason };
          if (id === 'detail') parts.detail = ran.rows;
          else parts.footer = ran.rows[0] ?? null;
        }

        let data = core.mailSampleFromRows(parts);

        // `{!in_words}` → ReadCurrency(ma_nt, t_tt_nt, language)
        if (/\{!in_words\}/i.test(clearText)) {
          const maNt = String(parts.master?.ma_nt ?? probe.ma_nt ?? '').trim();
          const tTtNt = parts.master?.t_tt_nt ?? parts.footer?.t_tt_nt ?? '';
          const inWordsSql = core.buildMailInWordsSelect({
            ma_nt: maNt, t_tt_nt: tTtNt, language: dLanguage || 'v',
          });
          const inWordsRan = await runSelect(core, target.conn, inWordsSql.sql, {
            ...runOpts, applyFormats: false,
          });
          if (!inWordsRan.ok) return fail(`in_words lỗi — ${inWordsRan.reason}`, inWordsSql.sql);
          const words = inWordsRan.rows[0]?.in_words;
          if (words != null && words !== '') data = { ...data, in_words: String(words) };
          output.appendLine(`mail sample: in_words ← ReadCurrency(${maNt}, ${tTtNt}, ${dLanguage || 'v'})`);
        }

        if (Object.keys(data).length === 0) {
          const reason = t('extension.mail_sample_no_values');
          return fail(reason);
        }

        const detailCount = Array.isArray(data.detail) ? data.detail.length : 0;
        vscode.window.showInformationMessage(toast('extension.mail_sample_done', {
          fields: Object.keys(data).filter((k) => k !== 'detail').length,
          detail: detailCount,
        }));
        return { ok: true, data };
      },
    );
  } catch (err) {
    const reason = err.message || String(err);
    output.appendLine(`mail sample: lỗi — ${err.stack || reason}`);
    await showErrorDialog(reason);
    return { ok: false, reason };
  }
}

module.exports = { loadMailSample, rowsOfFirstTable, tablesAfterSentinel };
