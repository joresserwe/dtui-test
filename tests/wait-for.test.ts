import { test, expect } from 'vitest';
import { waitForFrame } from './helpers/wait-for.js';

test('resolves once the frame contains the text', async () => {
  let frame = 'loading';
  setTimeout(() => { frame = 'ready: hello'; }, 40);
  await waitForFrame(() => frame, 'hello');
  expect(frame).toContain('hello');
});

test('rejects with the last frame on timeout', async () => {
  await expect(waitForFrame(() => 'never', 'missing', 60)).rejects.toThrow(/timed out.*never/s);
});
