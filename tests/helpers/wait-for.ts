export async function waitForFrame(lastFrame: () => string | undefined, text: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((lastFrame() ?? '').includes(text)) return;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error(`waitForFrame timed out waiting for ${JSON.stringify(text)}; last frame:\n${lastFrame() ?? '<none>'}`);
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitUntil timed out');
}
