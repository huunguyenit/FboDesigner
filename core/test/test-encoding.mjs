// test-encoding.mjs — Windows-1258 lưu tiếng Việt kiểu LAI: nguyên âm dựng sẵn, thanh điệu tổ hợp.
// Bài test này là lưới an toàn cho câu hỏi P0 số 1: ghi lại file mà không phá encoding.

import { ok, eq, section } from './harness.mjs';
import { encodeWindows1258, decodeSource } from '../src/encoding.mjs';

const hex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');

section('encode — nguyên âm dựng sẵn, thanh điệu tổ hợp');
eq('"ê" là MỘT byte dựng sẵn (0xEA)', hex(encodeWindows1258('ê')), 'ea');
eq('"ề" là HAI byte: ê + huyền tổ hợp', hex(encodeWindows1258('ề')), 'ea cc');
eq('"ố" là ô + sắc tổ hợp', hex(encodeWindows1258('ố')), 'f4 ec');
eq('"ả" là a + hỏi tổ hợp', hex(encodeWindows1258('ả')), '61 d2');
eq('"ư" dựng sẵn', hex(encodeWindows1258('ư')), 'fd');
eq('"đ" dựng sẵn', hex(encodeWindows1258('đ')), 'f0');
eq('ASCII đi thẳng', hex(encodeWindows1258('ab1')), '61 62 31');

section('round-trip');
const sample = 'Mã khách hàng — Số tài khoản ngân hàng, đơn vị tính: cái/chiếc';
eq('encode rồi decode ra đúng chuỗi cũ', decodeSource(encodeWindows1258(sample)).text.normalize('NFC'), sample.normalize('NFC'));

section('ký tự ngoài bảng thì NÉM, không thay bằng "?" âm thầm');
let threw = null;
try { encodeWindows1258('日本'); } catch (e) { threw = e; }
ok('ký tự Nhật không encode được', threw !== null);
ok('lỗi nêu rõ code point', threw !== null && /U\+65E5/.test(threw.message));

section('decodeSource — nhận diện nguồn');
const declared = Buffer.concat([
  Buffer.from('<?xml version="1.0" encoding="windows-1258"?>\r\n<dir>', 'latin1'),
  encodeWindows1258('Mã khách'),
  Buffer.from('</dir>\r\n', 'latin1'),
]);
const got = decodeSource(declared);
eq('khai báo trong XML declaration được ưu tiên', got.encoding, 'windows-1258');
eq('newline CRLF', got.newline, 'crlf');

// BẪY: text decode từ 1258 mang dấu ở dạng TỔ HỢP, nên `includes('Mã khách')` (NFC) TRẬT.
// Không normalize trong decodeSource — decode phải trung thành với byte. Chỗ nào so chuỗi
// hoặc tìm kiếm thì tự normalize ở đó.
ok('decode ra dạng tổ hợp, KHÔNG phải NFC', got.text.includes('Mã khách') === false);
ok('normalize rồi mới so được', got.text.normalize('NFC').includes('Mã khách'));

const utf8 = Buffer.from('﻿<?xml version="1.0"?>\n<dir>Mã khách</dir>\n', 'utf8');
const gotUtf8 = decodeSource(utf8);
eq('UTF-8 có BOM', [gotUtf8.encoding, gotUtf8.bom, gotUtf8.newline], ['utf-8', true, 'lf']);
