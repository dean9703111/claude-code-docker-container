// 後端保護的純邏輯測試（不連網）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquire, MAX_PER_WINDOW, MAX_CONCURRENT, WINDOW_MS } from './limit.js';

const NOW = 1_800_000_000_000;

test('同一來源同時只能有一個任務，釋放後才能再開', () => {
  const first = acquire('a', NOW);
  assert.equal(first.ok, true);

  const second = acquire('a', NOW);
  assert.equal(second.ok, false);
  assert.match(second.reason, /已經有一個任務進行中/);

  first.release();
  const third = acquire('a', NOW);
  assert.equal(third.ok, true);
  third.release();
});

test('全站同時進行的任務數有上限', () => {
  const held = [];
  for (let i = 0; i < MAX_CONCURRENT; i += 1) {
    const slot = acquire(`busy-${i}`, NOW);
    assert.equal(slot.ok, true);
    held.push(slot);
  }
  const overflow = acquire('late', NOW);
  assert.equal(overflow.ok, false);
  assert.match(overflow.reason, /稍後再試/);

  held.pop().release();
  const after = acquire('late2', NOW);
  assert.equal(after.ok, true);
  after.release();
  for (const slot of held) slot.release();
});

test('每分鐘的請求數有上限，過了時間窗才恢復', () => {
  for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
    const slot = acquire('flood', NOW);
    assert.equal(slot.ok, true, `第 ${i + 1} 次就被擋下`);
    slot.release();
  }
  const blocked = acquire('flood', NOW);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /太頻繁/);

  // 被擋下的請求也算進頻率，但換一個來源不受影響
  const other = acquire('calm', NOW);
  assert.equal(other.ok, true);
  other.release();

  const later = acquire('flood', NOW + WINDOW_MS + 1);
  assert.equal(later.ok, true);
  later.release();
});
