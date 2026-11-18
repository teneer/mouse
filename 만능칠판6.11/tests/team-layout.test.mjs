import test from 'node:test';
import assert from 'node:assert/strict';
import { measureTeamLayout } from '../score/team-layout.js';

const measure = options => measureTeamLayout({
  width: 560, height: 560, count: 6, ratio: 4 / 3, gap: 10, ...options,
});

test('automatic layout compares the available width and height', () => {
  assert.equal(measure({ width: 182 }).columns, 1);
  assert.deepEqual(measure(), { columns: 2, cardWidth: 220 });
  assert.equal(measure({ height: 100 }).columns, 6);
  assert.equal(measure({ height: 350 }).columns, 3);
  assert.equal(measure({ height: 350, ratio: 16 / 9 }).columns, 2);
});

test('automatic layout fits all cards when readable and never uses more than six columns', () => {
  for (const width of [172, 556, 940]) {
    for (const count of [4, 6, 8, 10]) {
      for (const ratio of [4 / 3, 16 / 9]) {
        const height = 620;
        const gap = 10;
        const { columns, cardWidth } = measure({ width, height, count, ratio, gap });
        const rows = Math.ceil(count / columns);
        assert.ok(columns >= 1 && columns <= Math.min(6, count));
        assert.ok(columns * cardWidth + (columns - 1) * gap <= width + 0.01);
        assert.ok(rows * cardWidth / ratio + (rows - 1) * gap <= height + 0.01);
      }
    }
  }
});

test('card width stays capped on a large score panel even with very few teams', () => {
  for (const count of [1, 2]) {
    assert.equal(measure({ width: 1400, height: 900, count }).cardWidth, 220);
    assert.equal(measure({ width: 1400, height: 900, count, fixedColumns: 1 }).cardWidth, 220);
  }
});

test('fixed columns remain exact and preserve a readable width when scrolling is required', () => {
  assert.deepEqual(measure({ width: 175, fixedColumns: 6 }), { columns: 6, cardWidth: 72 });
  assert.deepEqual(measure({ width: 500, count: 2, fixedColumns: 5 }), { columns: 2, cardWidth: 220 });
});

test('a narrow panel with many teams scrolls when fitting would make cards unreadable', () => {
  assert.deepEqual(measure({ width: 172, height: 620, count: 24 }), { columns: 2, cardWidth: 72 });
});

test('small changes at the column boundary retain the previous arrangement', () => {
  const settings = { width: 430, count: 4, height: 157 };
  assert.equal(measure(settings).columns, 4);
  assert.equal(measure({ ...settings, previousColumns: 2 }).columns, 2);
  assert.equal(measure({ ...settings, height: 155, previousColumns: 2 }).columns, 4);
});

test('three teams do not leave unused columns when the panel is widened', () => {
  const settings = { width: 1526, count: 3 };
  assert.deepEqual(measure({ ...settings, fixedColumns: 4 }), { columns: 3, cardWidth: 220 });
  assert.deepEqual(measure({ ...settings, fixedColumns: 4, count: 4 }), { columns: 4, cardWidth: 220 });
  assert.ok(measure(settings).columns <= 3);
});
