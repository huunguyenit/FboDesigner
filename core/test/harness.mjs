// harness.mjs — bộ đếm PASS/FAIL tối giản, cùng lối với `tests/` của hub 4AI.
// Không dùng node:test: output phẳng, đọc được trong terminal, chạy được bằng node trần.

let failures = 0;
let total = 0;

export function ok(label, cond, detail) {
  total++;
  if (!cond) failures++;
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
}

export function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, a === e ? undefined : `nhận ${a}, chờ ${e}`);
}

export function section(name) {
  process.stdout.write(`\n--- ${name}\n`);
}

export function summary() {
  process.stdout.write(`\n${total - failures}/${total} pass\n`);
  process.exit(failures === 0 ? 0 : 1);
}
