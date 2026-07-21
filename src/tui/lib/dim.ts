import React from 'react';

const DIM = '[2m';

// SGR 22 (bold-off) also cancels dim, so dim must be re-applied after every
// bold-off emitted by nested <Text bold> spans.
export const dimLine = (line: string): string => DIM + line.replaceAll('[22m', '[22m' + DIM);

export interface DimmedProps {
  children: React.ReactNode;
}

// Ink's <Transform> renders an ink-text node, which cannot contain Boxes.
// A raw ink-box accepts internal_transform, and Ink applies it to every
// descendant text write, so a whole Box subtree can be dimmed.
export function Dimmed({ children }: DimmedProps): React.JSX.Element {
  return React.createElement(
    'ink-box' as unknown as React.ElementType,
    {
      style: { flexWrap: 'nowrap', flexDirection: 'row', flexGrow: 0, flexShrink: 1, overflowX: 'visible', overflowY: 'visible' },
      internal_transform: dimLine,
    },
    children,
  );
}
