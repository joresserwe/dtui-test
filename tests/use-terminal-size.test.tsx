import { test, expect } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useTerminalSize } from '../src/tui/hooks/use-terminal-size.js';

function Probe() {
  const { columns, rows } = useTerminalSize();
  return <Text>{columns}x{rows}</Text>;
}

test('useTerminalSize renders a size without crashing', () => {
  const { lastFrame } = render(<Probe />);
  expect(lastFrame()).toMatch(/^\d+x\d+$/);
});
