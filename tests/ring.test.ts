import { test, expect } from 'vitest';
import { RingBuffer } from '../src/store/ring.js';

test('keeps items under cap in insertion order', () => {
  const rb = new RingBuffer<number>(3);
  rb.push(1); rb.push(2);
  expect(rb.items()).toEqual([1, 2]);
  expect(rb.size).toBe(2);
  expect(rb.dropped).toBe(0);
});

test('evicts oldest beyond cap and counts drops', () => {
  const rb = new RingBuffer<number>(3);
  [1, 2, 3, 4, 5].forEach(n => rb.push(n));
  expect(rb.items()).toEqual([3, 4, 5]);
  expect(rb.dropped).toBe(2);
});

test('setCap shrink evicts oldest immediately and counts the drops', () => {
  const rb = new RingBuffer<number>(5);
  [1, 2, 3, 4, 5].forEach(n => rb.push(n));
  rb.setCap(2);
  expect(rb.items()).toEqual([4, 5]);
  expect(rb.dropped).toBe(3);
});

test('setCap grow only raises the limit without dropping', () => {
  const rb = new RingBuffer<number>(2);
  [1, 2, 3].forEach(n => rb.push(n));
  expect(rb.dropped).toBe(1);
  rb.setCap(5);
  expect(rb.items()).toEqual([2, 3]);
  expect(rb.dropped).toBe(1);
  [4, 5, 6].forEach(n => rb.push(n));
  expect(rb.items()).toEqual([2, 3, 4, 5, 6]);
  expect(rb.dropped).toBe(1);
});

test('items() returns a copy', () => {
  const rb = new RingBuffer<number>(2);
  rb.push(1);
  rb.items().push(99);
  expect(rb.items()).toEqual([1]);
});
