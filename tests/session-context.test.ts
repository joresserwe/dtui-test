import { test, expect } from 'vitest';
import { registerQuit } from '../src/tui/lib/session-context.js';

test('SIGINT/SIGTERM set the conventional exit code and run the active quit', () => {
  const prevExit = process.exitCode;
  const beforeInt = new Set(process.listeners('SIGINT'));
  const beforeTerm = new Set(process.listeners('SIGTERM'));
  let quitCalls = 0;
  const unregister = registerQuit(() => { quitCalls++; });
  try {
    const intHandler = process.listeners('SIGINT').find(l => !beforeInt.has(l)) as ((s: NodeJS.Signals) => void) | undefined;
    const termHandler = process.listeners('SIGTERM').find(l => !beforeTerm.has(l)) as ((s: NodeJS.Signals) => void) | undefined;
    expect(intHandler).toBeDefined();
    expect(termHandler).toBeDefined();

    intHandler!('SIGINT');
    expect(process.exitCode).toBe(130);
    expect(quitCalls).toBe(1);

    const unregister2 = registerQuit(() => { quitCalls++; });
    termHandler!('SIGTERM');
    expect(process.exitCode).toBe(143);
    expect(quitCalls).toBe(2);
    unregister2();
  } finally {
    process.exitCode = prevExit;
    unregister();
  }
});
