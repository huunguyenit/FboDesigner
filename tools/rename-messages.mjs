#!/usr/bin/env node
/**
 * rename-messages.mjs — đổi key message sang tiếng Anh ngắn, gom template trùng thành 1 key,
 * rồi thay mọi msg('old') / t('old') / toast('old') trong source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MSG_FILE = path.join(ROOT, 'core/config/messages.json');

/** Gợi ý tên ngắn theo domain + nội dung (ưu tiên hơn auto-slug). */
const HINTS = [
  [/không tìm thấy hàng$/, 'edit.row_not_found'],
  [/hàng có entity/, 'edit.row_has_entity'],
  [/không xác định được hàng này nằm ở đâu/, 'edit.row_range_unknown'],
  [/chưa đọc được văn bản nguồn để đối chiếu/, 'edit.source_unread'],
  [/văn bản trong file khác với bản đã bung \(có &entity/, 'edit.source_mismatch_entity'],
  [/không có gì thay đổi$/, 'common.no_change'],
  [/không xác định được nguồn của \{what\}/, 'edit.source_of_unknown'],
  [/vắt qua ranh giới entity/, 'edit.cross_entity_boundary'],
  [/pattern của hàng viết bằng entity/, 'edit.pattern_is_entity'],
  [/pattern trong file là/, 'edit.pattern_mismatch'],
  [/file có \{length\} token/, 'edit.token_count_mismatch'],
  [/dải sắp ghi đè mang "\{actual\}", không phải "\{expect\}"/, 'edit.patch_expect_mismatch'],
  [/dải sắp ghi đè trong \{file\} mang/, 'edit.patch_expect_mismatch_file'],
  [/phép sửa không biết/, 'edit.unknown_op'],
  [/phép sửa cột không biết/, 'edit.unknown_column_op'],
  [/không xác định được vị trí thẻ <item>/, 'edit.item_tag_unknown'],
  [/không xác định được vùng chứa hàng/, 'edit.region_unknown'],
  [/không dồn nửa split khi các hàng nằm ở file khác nhau/, 'edit.split_cascade_multi_file'],
  [/field "\{fieldName\}" đã tồn tại/, 'edit.field_exists'],
  [/file không có <fields> để thêm/, 'edit.no_fields_section'],
  [/còn được \{length\} hàng dùng/, 'edit.field_still_used'],
  [/không tìm thấy khai báo <field name="\{fieldName\}">$/, 'edit.field_decl_missing'],
  [/không tìm thấy khai báo <field name="\{columnName\}">$/, 'edit.field_decl_missing_col'],
  [/không có cột "\{columnName\}"$/, 'edit.column_missing'],
  [/bề rộng phải là số/, 'edit.width_invalid'],
  [/khai báo width trong file khác bản đã bung/, 'edit.width_foreign'],
  [/không xác định được thẻ <field> trong file nguồn$/, 'edit.field_tag_unknown'],
  [/không xác định được vị trí cột trong file nguồn$/, 'edit.column_range_unknown'],
  [/lưới phải còn ít nhất một cột/, 'edit.grid_min_one_col'],
  [/văn bản trong file khác bản đã bung — sửa tại file khai nó/, 'edit.source_mismatch'],
  [/cột "\{newName\}" đã có trong lưới/, 'edit.column_exists'],
  [/cột đích trùng cột đang kéo/, 'edit.column_same_target'],
  [/không có cột neo "\{anchorName\}"/, 'edit.anchor_missing'],
  [/không xác định được vị trí cột "\{columnName\}"/, 'edit.column_pos_unknown'],
  [/không xác định được vị trí cột neo/, 'edit.anchor_pos_unknown'],
  [/hai cột nằm ở hai file khác nhau/, 'edit.column_cross_file'],
  [/đến từ cấu hình ẩn — chỉ dời cột khai/, 'edit.column_hidden_config'],
  [/cột neo "\{anchorName\}" đến từ cấu hình ẩn/, 'edit.anchor_hidden_config'],
  [/bị arrangement neo/, 'edit.column_arrangement_pinned'],
  [/vị trí chèn nằm trong dòng cột đang kéo/, 'edit.insert_inside_moving'],
  [/\{attr\} phải là số/, 'edit.attr_must_be_number'],
  [/khai báo \{attr\} trong file khác bản đã bung/, 'edit.attr_foreign'],
  [/không tìm thấy thẻ <\{tagName\}>/, 'edit.tag_not_found'],
  [/không xác định được thẻ <\{tagName\}>/, 'edit.tag_unknown'],
  [/thuộc tính không sửa được/, 'edit.attr_readonly'],
  [/không có vùng "\{regionId\}"/, 'edit.region_missing'],
  [/không có vùng "\{region\}"/, 'edit.region_missing'],
  [/không xác định được thẻ khai vùng/, 'edit.region_tag_unknown'],
  [/vượt quá \{length\} cột của vùng/, 'edit.attr_exceeds_cols'],
  [/không xác định được <category index/, 'edit.category_columns_unknown'],
  [/view không khai list px/, 'edit.no_width_list'],
  [/không xác định được <item> list px/, 'edit.width_item_unknown'],
  [/split=\{v\} trỏ đúng vào vạch/, 'edit.split_on_merge_edge'],
  [/không xác định được nguồn của list px/, 'edit.width_list_source_unknown'],
  [/không có cột \{p0\} trong vùng này/, 'edit.region_col_missing'],
  [/là cột cuối — bên phải không còn/, 'edit.merge_last_col'],
  [/item \{index\}: không xác định được vị trí/, 'edit.item_pos_unknown'],
  [/item \{index\}: \{reason\}/, 'edit.item_reason'],
  [/vùng \{id\}: \{reason\}/, 'edit.region_reason'],
  [/vùng \{id\}: không xác định được vị trí/, 'edit.region_attr_pos_unknown'],
  [/hai chỗ đòi ghi hai thứ khác nhau/, 'edit.conflict_writes'],
  [/hai chỗ cần sửa chồng lên nhau/, 'edit.overlap_writes'],
  [/chưa đọc được \{file\} để đối chiếu/, 'edit.file_unread'],
  [/không đọc được \{file\} để đối chiếu/, 'edit.file_unread'],
  [/không có field "\{fieldName\}"$/, 'edit.field_missing'],
  [/\{what\}: không xác định được vị trí/, 'edit.what_pos_unknown'],
  [/cụm \[\{p0\}\] không đặt vừa/, 'edit.cluster_no_fit'],
  [/sẽ hất hàng \{p0\} từ vùng/, 'edit.region_kick'],
  [/làm \{length\} hàng đổi vùng ngoài ý muốn/, 'edit.region_side_effects'],
  [/không có khai báo <field name="\{name\}"> để ghi categoryIndex/, 'edit.no_field_for_category'],
  [/categoryIndex \{value\} không hợp lệ/, 'edit.category_invalid'],
  [/không tìm thấy thẻ <field name="\{name\}">/, 'edit.field_tag_not_found'],
  [/không tìm thấy hàng đích \{toItem\}/, 'edit.target_row_not_found'],
  [/không tìm thấy hàng \{toItem\}/, 'edit.target_row_not_found'],
  [/không tìm thấy hàng \{item\}/, 'edit.row_item_not_found'],
  [/cột đích \{baseCol\} không hợp lệ/, 'edit.target_col_invalid'],
  [/ô trống, không có gì để dời/, 'common.empty_move'],
  [/không tìm lại được ô ở cột/, 'edit.cell_not_relocated'],
  [/đặt tại cột \{p0\} thì control trải 1 cột vượt/, 'edit.place_overflow_1'],
  [/không còn slot trống để đặt/, 'edit.no_empty_slot'],
  [/ô trống, không có control để đổi chỗ/, 'common.empty_swap'],
  [/không map được token của một trong hai ô/, 'edit.token_unmap'],
  [/có ô \.Label\/\.Footer\/\.Description/, 'edit.has_companion_cells'],
  [/dải sắp bỏ mang/, 'edit.drop_expect_mismatch'],
  [/block cần ít nhất 2 hàng/, 'edit.block_min_rows'],
  [/không tìm thấy hàng trong block/, 'edit.block_row_missing'],
  [/không xác định được thẻ <item> của một hàng trong block/, 'edit.block_item_unknown'],
  [/các hàng block nằm ở nhiều file/, 'edit.block_multi_file'],
  [/hàng đích khác file với block/, 'edit.block_target_file'],
  [/các hàng không liền kề trong file nguồn/, 'edit.block_not_contiguous'],
  [/block rỗng/, 'edit.block_empty'],
  [/vị trí thả nằm trong chính block/, 'edit.drop_inside_block'],
  [/ô trống, không có gì để xoá/, 'common.empty_delete'],
  [/hàng \{index\}: không xác định được vị trí/, 'edit.row_pos_unknown'],
  [/hàng \{index\}: \{reason\}/, 'edit.row_reason'],
  [/không xác định được chỗ khai &Name;/, 'edit.entity_ref_unknown'],
  [/dải sắp thay mang "\{refText\}"/, 'edit.entity_ref_mismatch'],
  [/còn nội dung khác.*phân giải tại chỗ/, 'edit.entity_line_has_extra'],
  [/bung ra rỗng — không có gì để chèn/, 'edit.entity_empty_resolve'],

  [/không có ô thứ \{cellIndex\}/, 'item.cell_missing'],
  [/không có ô thứ \{otherIndex\}/, 'item.other_cell_missing'],
  [/token "\{raw\}" không đọc được/, 'item.token_invalid'],
  [/ô đang có control — chọn ô trống để thêm/, 'item.cell_occupied_insert'],
  [/bên trái chỉ còn \{col\} cột trống/, 'item.left_space_short'],
  [/bên phải chỉ còn \{p0\} cột trống/, 'item.right_space_short'],
  [/đang có control — bỏ nó trước rồi mới thêm/, 'item.col_occupied_insert'],
  [/cột đích \{toCol\} không hợp lệ/, 'item.target_col_invalid'],
  [/dời tới cột \{p0\} thì control trải \{span\}/, 'item.move_overflow'],
  [/ô thứ \{cellIndex\} không có token nào để dời/, 'item.no_token_to_move'],
  [/đang có control — bỏ nó trước rồi mới dời/, 'item.col_occupied_move'],
  [/một trong hai ô không có token để đổi chỗ/, 'item.swap_no_token'],
  [/không có token nào để đặt/, 'item.no_token_to_place'],
  [/cột đích \{col\} không hợp lệ/, 'item.place_col_invalid'],
  [/span \{span\} không hợp lệ/, 'item.span_invalid'],
  [/đặt tại cột \{p0\} thì control trải \{n\} cột vượt/, 'item.place_overflow'],
  [/đang có control — bỏ nó trước rồi mới đặt/, 'item.col_occupied_place'],
  [/control cần \{length\} cột nhưng view chỉ có/, 'item.span_exceeds_view'],
  [/span tối thiểu là 1/, 'item.span_min'],
  [/ô trống không có span để đổi/, 'item.empty_no_span'],
  [/nở tới cột \{p0\} nhưng view chỉ có/, 'item.grow_overflow'],
  [/đang có control — bỏ nó trước rồi mới nở/, 'item.col_occupied_grow'],
  [/ô trống không có cạnh trái để kéo/, 'item.empty_no_left_edge'],
  [/cột bắt đầu không thể âm/, 'item.start_negative'],
  [/cạnh trái không vượt qua được cạnh phải/, 'item.left_past_right'],

  [/đang giữ hai control khác nhau/, 'columns.merge_two_controls'],
  [/không có cột \{p0\} trong list px/, 'columns.col_missing'],
  [/không phải số px nguyên/, 'columns.px_invalid'],
  [/không có cột \{p0\} để gộp vào/, 'columns.merge_no_next'],
  [/không phải số px — sửa list px trước/, 'columns.px_not_number'],

  [/kiểu control không biết/, 'field.unknown_kind'],
  [/tên field "\{name\}" không hợp lệ/, 'field.invalid_name'],

  [/không có <query event="Finding">/, 'filter.no_finding_query'],
  [/bị mã hoá — không đọc được mệnh đề join/, 'filter.finding_encrypted'],
  [/Finding không có mệnh đề join nào/, 'filter.no_joins'],
  [/không tách được join nào từ/, 'filter.parse_join_fail'],
  [/không có <field name="\{col\}"> trong file/, 'filter.field_missing'],
  [/không có DOCTYPE nội bộ/, 'filter.no_doctype'],
  [/<field name="\{col\}"> không có thẻ đóng/, 'filter.field_unclosed'],
  [/không có <\/grid>/, 'filter.no_grid_close'],

  [/cần độ dài cột \(varchar\(N\)\)/, 'addColumn.need_varchar_len'],
  [/chưa biết ánh xạ SQL cho type/, 'addColumn.unknown_sql_type'],

  [/không có khai báo — giữ nguyên/, 'entity.undeclared'],
  [/trỏ tới \{abs\} nhưng không đọc được/, 'entity.unread_system'],
  [/lồng entity quá sâu/, 'entity.nest_too_deep'],
  [/marked section không đóng/, 'entity.marked_unclosed'],
  [/chưa khai báo \(tại \{file\}\)/, 'entity.param_undeclared'],
  [/vòng lặp include/, 'entity.include_cycle'],
  [/không đọc được \{abs\} \(khai ở/, 'entity.include_unread'],
  [/bung entity quá sâu/, 'entity.expand_too_deep'],
  [/entity đệ quy/, 'entity.recursive'],

  [/không có <field name="\{name2\}"> trong <fields>/, 'grid.col_field_missing'],
  [/arrangement: không có cột/, 'grid.arr_col_missing'],
  [/arrangement: không đọc được/, 'grid.arr_unread'],
  [/arrangement: cột "\{name\}" neo vào/, 'grid.arr_anchor_missing'],
  [/không nhận được CSS nền \(baseCss\)/, 'grid.no_base_css'],

  [/category \{index\}: \{m\}/, 'render.category_warn'],
  [/token "\{raw\}": không có <field/, 'render.token_no_field'],
  [/được khai nhiều lần — chỉ lần đầu/, 'render.category_dup'],
];

function hintKey(template, domain) {
  for (const [re, key] of HINTS) {
    if (re.test(template)) return key;
  }
  // fallback: domain + short hash of template
  const hash = Buffer.from(template).toString('base64url').slice(0, 6);
  const words = template
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\{[^}]+\}/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .split('_')
    .filter(Boolean)
    .slice(0, 4)
    .join('_') || 'msg';
  const prefix = domain.startsWith('core.') ? domain.slice(5) : domain;
  return `${prefix}.${words}_${hash}`;
}

function domainOf(oldKey) {
  const parts = oldKey.split('.');
  if (parts[0] === 'core') return `core.${parts[1]}`;
  return parts[0];
}

const old = JSON.parse(fs.readFileSync(MSG_FILE, 'utf8'));

/** template → canonical new key */
const byTemplate = new Map();
/** oldKey → newKey */
const rename = {};
const neu = {};

// Keep already-short keys (dialog.*, extension.*, webview.*, fboDesigner.*) as-is,
// except drop removed config keys.
const DROP = new Set([
  'fboDesigner.autoProgramAssets.desc',
  'fboDesigner.stylesheets.desc',
  'fboDesigner.addColumnPartitionTemplate.desc',
  'fboDesigner.sqlcmdPath.desc',
  'fboDesigner.vietnamese.desc',
]);

for (const [oldKey, template] of Object.entries(old)) {
  if (DROP.has(oldKey)) continue;

  const keepShort = /^(dialog|extension|webview|fboDesigner)\./.test(oldKey)
    && !/_[a-f0-9]{6,8}$/.test(oldKey.split('.').pop());

  let newKey;
  if (keepShort) {
    newKey = oldKey;
  } else if (byTemplate.has(template)) {
    newKey = byTemplate.get(template);
  } else {
    newKey = hintKey(template, domainOf(oldKey));
    // collide? append counter
    if (neu[newKey] !== undefined && neu[newKey] !== template) {
      let n = 2;
      while (neu[`${newKey}_${n}`] !== undefined) n++;
      newKey = `${newKey}_${n}`;
    }
    byTemplate.set(template, newKey);
    neu[newKey] = template;
  }

  if (neu[newKey] === undefined) neu[newKey] = template;
  rename[oldKey] = newKey;
}

// Write new messages
const ordered = {};
for (const k of Object.keys(neu).sort()) ordered[k] = neu[k];
fs.writeFileSync(MSG_FILE, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(ROOT, '.build', 'msg-rename.json'), JSON.stringify(rename, null, 2) + '\n', 'utf8');

// Rewrite source files
const EXTS = new Set(['.js', '.mjs', '.html', '.json']);
const SKIP = new Set(['node_modules', '.build', 'dist', '.git']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

// Longest old keys first so prefixes don't collide
const pairs = Object.entries(rename).sort((a, b) => b[0].length - a[0].length);
let filesTouched = 0;
for (const file of walk(ROOT)) {
  // Don't rewrite the messages.json we just wrote via partial old keys
  if (path.resolve(file) === path.resolve(MSG_FILE)) continue;
  if (file.includes(`${path.sep}tools${path.sep}`) && /migrate|build-config|extract|merge-ui|rename-messages/.test(file)) {
    continue;
  }
  let text = fs.readFileSync(file, 'utf8');
  let next = text;
  for (const [oldKey, newKey] of pairs) {
    if (oldKey === newKey) continue;
    // replace inside quotes: 'old' or "old"
    next = next.split(`'${oldKey}'`).join(`'${newKey}'`);
    next = next.split(`"${oldKey}"`).join(`"${newKey}"`);
  }
  if (next !== text) {
    fs.writeFileSync(file, next.replace(/\r\n/g, '\n'), 'utf8');
    filesTouched++;
  }
}

const uniqueNew = new Set(Object.values(rename));
process.stdout.write(
  `keys: ${Object.keys(old).length} → ${Object.keys(ordered).length} (renames ${pairs.filter(([a, b]) => a !== b).length}, files ${filesTouched})\n`
  + `unique new keys: ${uniqueNew.size}\n`,
);
