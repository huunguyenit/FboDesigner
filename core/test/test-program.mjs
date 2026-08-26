// test-program.mjs — file đang mở phải tự nói ra program của nó.
// Đường dẫn thật lấy từ máy khách: UNC, có dấu chấm trong tên máy, có khoảng trắng ở nơi khác.

import { ok, eq, section } from './harness.mjs';
import { resolveProgramPaths } from '../src/program.mjs';

section('UNC — ca thật của FBISP2421');
const unc = resolveProgramPaths(String.raw`\\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421\App_Data\Controllers\Dir\Site.xml`);
eq('program root', unc.programRoot, String.raw`\\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421`);
eq('css', unc.cssDir, String.raw`\\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421\Css`);
eq('images', unc.imagesDir, String.raw`\\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421\Images`);
eq('clientScript', unc.clientScriptDir, String.raw`\\172.168.5.14\CustomerPro\FBI\HOATP\FBISP2421\ClientScript`);
eq('folder', unc.folder, 'Dir');
eq('controller bỏ đuôi', unc.controller, 'Site');

section('ổ đĩa cục bộ');
const local = resolveProgramPaths(String.raw`D:\Fast Source\FBISP24\App_Data\Controllers\Filter\SVTran.f`);
eq('program root', local.programRoot, String.raw`D:\Fast Source\FBISP24`);
eq('folder', local.folder, 'Filter');
eq('đuôi .f cũng bỏ', local.controller, 'SVTran');

section('dấu gạch xuôi');
const posix = resolveProgramPaths('//srv/share/Prog/App_Data/Controllers/Grid/List.xml');
eq('giữ nguyên kiểu gạch của đầu vào', posix.cssDir, '//srv/share/Prog/Css');

section('không suy được thì trả null, không đoán');
ok('không có App_Data', resolveProgramPaths(String.raw`D:\linh tinh\Site.xml`) === null);
ok('App_Data là phần tử đầu', resolveProgramPaths('App_Data/Controllers/Dir/Site.xml') === null);
ok('rỗng', resolveProgramPaths('') === null);

section('App_Data lồng nhau thì lấy cái NGOÀI CÙNG bên phải');
eq('program là cái gần file nhất',
  resolveProgramPaths(String.raw`D:\App_Data\backup\Prog\App_Data\Controllers\Dir\A.xml`).programRoot,
  String.raw`D:\App_Data\backup\Prog`);
