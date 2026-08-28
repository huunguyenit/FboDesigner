// test-add-column.mjs — sinh script ADD COLUMN cho field bảng chính chưa có cột trên database.
//
// Ba fixture, cả ba dòng <partition> đều CHÉP NGUYÊN VĂN từ FBISP24 (không bịa):
//   PLAIN     — <dir table="dmkh"> không có <partition>, tức bảng thường thấy nhất.
//   ROTATING  — dòng thật của ARTran/HD1: `prime="m21$" increase="dateadd(month, 1, {0})"`.
//   STATIC    — dòng thật của AdjustmentIssueTran.f: `prime="pxdc"` (không có `$` cuối) —
//               có thẻ <partition> nhưng KHÔNG chia kỳ, phải chạy script THƯỜNG.

import { ok, eq, section } from './harness.mjs';
import { scanFields } from '../src/spans.mjs';
import {
  mainTableExclusionReason,
  sqlTypeOf,
  isRotatingPartition,
  planAddColumns,
  buildColumnDefs,
  renderAddColumnSql,
  DEFAULT_PARTITION_TEMPLATE,
} from '../src/add-column.mjs';

const PLAIN = [
  '<dir table="dmkh" code="ma_kh" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh" aliasName="a"><header v="Mã khách" e="Code"/></field>',
  '    <field name="dien_giai"><header v="Diễn giải" e="Description"/></field>',
  '    <field name="ngay_ct" type="DateTime" aliasName="a"><header v="Ngày" e="Date"/></field>',
  '    <field name="t_tien" type="Decimal" aliasName="a"><header v="Tiền" e="Amount"/></field>',
  '    <field name="kh_yn" type="Boolean" aliasName="a"><header v="Khoá" e="Locked"/></field>',
  '    <field name="ten_kh%l" external="true" aliasName="b"><header v="Tên khách" e="Name"/></field>',
  '    <field name="nam" aliasName="Year"><header v="Năm" e="Year"/></field>',
  '  </fields>',
  '</dir>',
].join('\n');

const ROTATING = [
  '<grid table="c21$000000" code="stt_rec" type="Voucher" xmlns="urn:schemas-fast-com:data-grid">',
  '  <partition table="c21$000000" prime="m21$" inquiry="i21$" field="ngay_ct"',
  '    expression="convert(char(6), {0}, 112)" increase="dateadd(month, 1, {0})" default="000000"/>',
  '  <fields>',
  '    <field name="loai_hd" aliasName="a"><header v="Loại HĐ" e="Type"/></field>',
  '  </fields>',
  '</grid>',
].join('\n');

const STATIC_PARTITION_TAG = [
  '<dir table="pxdc" code="stt_rec" type="Voucher" xmlns="urn:schemas-fast-com:data-dir">',
  '  <partition table="pxdc" prime="pxdc" inquiry="ipxdc" field="ngay_ct" expression="\'\'"',
  '    increase="{0}" default=""/>',
  '  <fields>',
  '    <field name="ghi_chu" aliasName="a"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '</dir>',
].join('\n');

section('add-column — field cần tạo cột (external / aliasName)');
const plainFields = scanFields(PLAIN);
const byName = Object.fromEntries(plainFields.map((f) => [f.name, f]));
eq('aliasName="a" là cột bảng chính', mainTableExclusionReason(byName.ma_kh), null);
eq('field trần (không aliasName) là cột bảng chính', mainTableExclusionReason(byName.dien_giai), null);
ok('external="true" bị loại', mainTableExclusionReason(byName['ten_kh%l']) !== null);
ok('aliasName khác "a" bị loại', mainTableExclusionReason(byName.nam) !== null);

section('add-column — bảng ánh xạ kiểu FBO → SQL');
eq('DateTime → smalldatetime', sqlTypeOf(byName.ngay_ct).sql, 'smalldatetime');
eq('Decimal → numeric(19,4)', sqlTypeOf(byName.t_tien).sql, 'numeric(19,4)');
eq('Boolean → bit', sqlTypeOf(byName.kh_yn).sql, 'bit');
ok('string thiếu length → ok:false', sqlTypeOf(byName.dien_giai).ok === false);
eq('string có length → varchar(N)', sqlTypeOf(byName.dien_giai, { stringLength: 100 }).sql, 'varchar(100)');

section('add-column — bảng chia kỳ THẬT vs thẻ <partition> trên bảng tĩnh');
ok('không có <partition> → không chia kỳ', !isRotatingPartition(null));
ok('prime="m21$" + increase → chia kỳ thật', isRotatingPartition(planAddColumns(ROTATING).partition));
ok('prime="pxdc" (không "$") → KHÔNG chia kỳ dù có thẻ <partition>', !isRotatingPartition(planAddColumns(STATIC_PARTITION_TAG).partition));

section('add-column — planAddColumns: dò field ứng viên, lọc theo existingColumns');
const planPlain = planAddColumns(PLAIN);
eq('table đọc từ root@table', planPlain.table, 'dmkh');
eq('5 field bảng chính', planPlain.mainTableFields.length, 5);
eq('2 field bị loại (external + aliasName khác)', planPlain.excluded.length, 2);
const filtered = planAddColumns(PLAIN, { existingColumns: ['ma_kh', 'NGAY_CT'] });
eq('existingColumns lọc bớt (không phân biệt hoa/thường)', filtered.candidates.length, 3);

section('add-column — renderAddColumnSql: bảng thường');
const defsPlain = buildColumnDefs([byName.ngay_ct, byName.kh_yn], {});
const sqlPlain = renderAddColumnSql(defsPlain, { table: 'dmkh' });
ok('có IF NOT EXISTS cho ngay_ct', sqlPlain.includes("name = 'ngay_ct'"));
ok('ALTER TABLE dmkh ADD ngay_ct smalldatetime', sqlPlain.includes('ALTER TABLE dmkh ADD ngay_ct smalldatetime;'));
ok('ALTER TABLE dmkh ADD kh_yn bit', sqlPlain.includes('ALTER TABLE dmkh ADD kh_yn bit;'));

section('add-column — renderAddColumnSql: thẻ <partition> nhưng bảng tĩnh → vẫn script thường');
const staticPlan = planAddColumns(STATIC_PARTITION_TAG);
const staticDefs = buildColumnDefs(staticPlan.candidates, { stringLengths: { ghi_chu: 50 } });
const sqlStatic = renderAddColumnSql(staticDefs, { table: staticPlan.table, partition: staticPlan.partition });
ok('dùng partition@table (pxdc), không lặp FastBusiness$Partition$Execute', sqlStatic.includes('ALTER TABLE pxdc ADD ghi_chu varchar(50);'));
ok('không có FastBusiness$Partition$Execute', !sqlStatic.includes('FastBusiness$Partition$Execute'));

section('add-column — renderAddColumnSql: bảng chia kỳ thật, đủ ba loại backfill');
const rotatingPlan = planAddColumns(ROTATING);
const rotatingDefs = buildColumnDefs(
  [...rotatingPlan.candidates, byName.ngay_ct, byName.t_tien, byName.dien_giai],
  { stringLengths: { loai_hd: 2, dien_giai: 200 } },
);
const sqlRotating = renderAddColumnSql(rotatingDefs, { partition: rotatingPlan.partition });
ok('bảng master m21$000000', sqlRotating.includes("name = 'm21$000000') AND name = 'loai_hd'"));
ok('%Partition placeholder', sqlRotating.includes("alter table m21$%Partition add loai_hd"));
ok('field kỳ ngay_ct đúng từ partition@field', sqlRotating.includes("'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1"));
ok('cột chữ backfill rỗng', sqlRotating.includes("set dien_giai = '' where"));
ok('cột số backfill 0', sqlRotating.includes('set t_tien = 0 where'));
ok('cột ngày KHÔNG backfill (NULL)', sqlRotating.includes('set ngay_ct = NULL where'));

section('add-column — renderAddColumnSql: ném lỗi khi còn cột chưa xác định kiểu');
let threw = false;
try {
  renderAddColumnSql(buildColumnDefs([byName.dien_giai], {}), { table: 'dmkh' });
} catch (err) {
  threw = /chưa xác định được kiểu/.test(err.message);
}
ok('ném lỗi rõ ràng, không sinh script thiếu kiểu', threw);

ok('DEFAULT_PARTITION_TEMPLATE có đủ placeholder', [
  '{{primeMaster}}', '{{primePattern}}', '{{partitionField}}', '{{column}}', '{{sqlType}}', '{{backfill}}',
].every((p) => DEFAULT_PARTITION_TEMPLATE.includes(p)));
