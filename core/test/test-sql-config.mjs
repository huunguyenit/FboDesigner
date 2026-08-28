// test-sql-config.mjs — parse connection string, giải %Database/%UserID, sinh SQL đọc sys.columns.
//
// Chuỗi kết nối lấy NGUYÊN VĂN từ `Web.config` gốc của FBISP24 (Data Source, Uid, Pwd đã đổi để
// không chép thật vào repo test — hình dạng chuỗi giữ nguyên).

import { ok, eq, section } from './harness.mjs';
import {
  parseConnectionString,
  resolvePlaceholders,
  existingColumnsSql,
  stringColumnLengthSql,
  ENTITY_APP_DATABASE_SQL,
} from '../src/sql-config.mjs';

const APP_CS = 'Data Source=10.0.0.1\\SQL2008;Initial Catalog=%Database;Application Name=%UserID;Uid=demo;Pwd=demo123;';
const SYS_CS = 'Data Source=10.0.0.1\\SQL2008;Initial Catalog=DEMO_SYS;Uid=demo;Pwd=demo123;';

section('sql-config — parseConnectionString');
const appParsed = parseConnectionString(APP_CS);
eq('server (Data Source, giữ nguyên "\\")', appParsed.server, '10.0.0.1\\SQL2008');
eq('database còn placeholder', appParsed.database, '%Database');
eq('uid', appParsed.uid, 'demo');
eq('pwd', appParsed.pwd, 'demo123');

eq('Server= tương đương Data Source=', parseConnectionString('Server=x;Database=y;').server, 'x');
eq('Database= tương đương Initial Catalog=', parseConnectionString('Server=x;Database=y;').database, 'y');
eq('User ID= tương đương Uid=', parseConnectionString('User ID=z;').uid, 'z');
eq('Password= tương đương Pwd=', parseConnectionString('Password=w;').pwd, 'w');
eq('không có gì → toàn null', parseConnectionString('').server, null);
eq('khoá trùng lấy giá trị ĐẦU', parseConnectionString('Uid=a;Uid=b;').uid, 'a');

section('sql-config — resolvePlaceholders');
eq(
  'thay %Database, giữ nguyên phần còn lại',
  resolvePlaceholders(APP_CS, { database: 'OTONLM_FBISP24' }),
  'Data Source=10.0.0.1\\SQL2008;Initial Catalog=OTONLM_FBISP24;Application Name=%UserID;Uid=demo;Pwd=demo123;',
);
eq(
  'thay cả hai',
  resolvePlaceholders(APP_CS, { database: 'D1', userId: 'huunguyena6' }),
  'Data Source=10.0.0.1\\SQL2008;Initial Catalog=D1;Application Name=huunguyena6;Uid=demo;Pwd=demo123;',
);
eq('bỏ trống database → giữ nguyên %Database', resolvePlaceholders(APP_CS, {}), APP_CS);
ok('không phân biệt hoa/thường', resolvePlaceholders('a=%DATABASE;', { database: 'x' }) === 'a=x;');

section('sql-config — existingColumnsSql / stringColumnLengthSql: chỉ nhận identifier hợp lệ');
ok('bảng hợp lệ (có $)', existingColumnsSql('m81$000000').includes("OBJECT_ID('m81$000000')"));
ok('field hợp lệ', stringColumnLengthSql('ma_kh').includes("c.name = 'ma_kh'"));
ok('chỉ dò varchar/char', stringColumnLengthSql('ma_kh').includes("t.name IN ('varchar', 'char')"));

let threwTable = false;
try { existingColumnsSql("m81$000000'); DROP TABLE x; --"); } catch { threwTable = true; }
ok('bảng chứa ký tự lạ → ném lỗi, không lọt vào SQL', threwTable);

let threwField = false;
try { stringColumnLengthSql("ma_kh' OR '1'='1"); } catch { threwField = true; }
ok('field chứa ký tự lạ → ném lỗi, không lọt vào SQL', threwField);

section('sql-config — ENTITY_APP_DATABASE_SQL');
ok('đọc bảng entity, cột cdata', ENTITY_APP_DATABASE_SQL.includes('FROM entity') && ENTITY_APP_DATABASE_SQL.includes('cdata'));
ok('sắp theo code — dòng đầu là mặc định', ENTITY_APP_DATABASE_SQL.includes('ORDER BY code'));
