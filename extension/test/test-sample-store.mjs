// test-sample-store.mjs — kho dữ liệu mẫu và cơ chế bảo bề mặt vẽ lại.
//
// Kho này nhỏ nhưng đứng ở chỗ dễ rò: nó cầm DỮ LIỆU THẬT của khách, và nó giữ closure `render`
// của những panel có thể đã đóng. Hai điều đáng kiểm nhất vì thế không phải là «đặt rồi lấy có
// ra không», mà là:
//
//   1. Gỡ đăng ký có THẬT SỰ gỡ không — closure của một panel đã đóng còn nằm lại là một lần
//      gọi vào webview đã chết cho mỗi lần đổi dữ liệu.
//   2. Một bề mặt ném có kéo theo bề mặt còn lại không — chúng độc lập, và một panel hỏng không
//      được làm panel kia thôi cập nhật.

import { ok, eq, section } from '../../core/test/harness.mjs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const store = require_('../src/sample-store.js');

const A = 'C:/P/App_Data/Controllers/Grid/A.xml';
const B = 'C:/P/App_Data/Controllers/Grid/B.xml';

section('kho dữ liệu mẫu — đặt, lấy, bỏ');
store.clearAll();

eq('chưa đặt thì không có gì', store.getSample(A), null);
store.setSample(A, { rows: [{ x: '1' }], masked: true });
eq('đặt rồi thì lấy ra được', store.getSample(A).rows.length, 1);
// Đường dẫn Windows không phân biệt hoa thường — tra bằng chữ hoa phải ra cùng một chỗ.
eq('tra không phân biệt hoa thường', store.getSample(A.toUpperCase())?.rows.length, 1);
eq('file khác thì không dính', store.getSample(B), null);

ok('bỏ thì báo là có bỏ', store.clearSample(A) === true);
eq('bỏ rồi thì trống', store.getSample(A), null);
ok('bỏ cái không có thì báo không', store.clearSample(A) === false);

section('kho dữ liệu mẫu — báo cho bề mặt vẽ lại');
store.clearAll();

let demA = 0;
let demB = 0;
const goA = store.onRefresh(A, () => { demA += 1; });
store.onRefresh(B, () => { demB += 1; });

store.setSample(A, { rows: [] });
eq('đặt dữ liệu thì bề mặt của ĐÚNG file được gọi', demA, 1);
eq('bề mặt của file khác KHÔNG bị gọi', demB, 0);

store.clearSample(A);
eq('bỏ dữ liệu cũng báo, vì lưới phải quay về bản giữ chỗ', demA, 2);

// Bỏ một file KHÔNG có dữ liệu thì không báo: không có gì đổi, và một lượt vẽ lại thừa trên một
// controller lớn là một khoảng khựng người dùng nhìn thấy.
store.clearSample(A);
eq('bỏ cái không có thì không báo gì', demA, 2);

section('kho dữ liệu mẫu — gỡ đăng ký phải THẬT SỰ gỡ');
goA();
store.setSample(A, { rows: [] });
eq('đã gỡ thì không còn được gọi', demA, 2);
// Và bề mặt còn lại vẫn hoạt động bình thường.
store.setSample(B, { rows: [] });
eq('bề mặt kia không bị ảnh hưởng', demB, 1);

section('kho dữ liệu mẫu — một bề mặt ném không kéo bề mặt kia theo');
store.clearAll();
let lanh = 0;
store.onRefresh(A, () => { throw new Error('panel này đã chết'); });
store.onRefresh(A, () => { lanh += 1; });
store.setSample(A, { rows: [] });
// Nếu `requestRefresh` không bọc từng lời gọi thì bề mặt thứ hai không bao giờ được gọi, và nó
// đứng yên với dữ liệu cũ mà không có dấu hiệu gì.
eq('bề mặt lành vẫn được gọi', lanh, 1);

section('kho dữ liệu mẫu — nhiều bề mặt cùng một file');
store.clearAll();
let hai = 0;
store.onRefresh(A, () => { hai += 1; });
store.onRefresh(A, () => { hai += 1; });
store.setSample(A, { rows: [] });
// Mở cùng một lưới ở cả preview panel lẫn custom editor là chuyện thường; cả hai phải cùng đổi.
eq('cả hai cùng được gọi', hai, 2);

section('kho dữ liệu mẫu — clearAll quên sạch');
store.clearAll();
eq('dữ liệu bị quên', store.getSample(A), null);
let sauKhiXoa = 0;
store.onRefresh(A, () => { sauKhiXoa += 1; });
store.clearAll();
store.setSample(A, { rows: [] });
// `clearAll` chạy lúc deactivate: đăng ký cũ phải đi cùng, không thì lần bật lại sẽ gọi vào
// closure của phiên trước.
eq('đăng ký cũ cũng bị quên', sauKhiXoa, 0);
store.clearAll();
