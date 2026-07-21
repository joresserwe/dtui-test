import { useRef, useState } from 'react';

export function useCloseArm(whenNotEditing: (fn: () => void) => void) {
  const [closeArm, setCloseArm] = useState<string | null>(null);
  const closeArmTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  const armClose = (token: string) => {
    setCloseArm(token);
    if (closeArmTimer.current) clearTimeout(closeArmTimer.current);
    closeArmTimer.current = setTimeout(() => whenNotEditing(() => setCloseArm(null)), 3000);
    closeArmTimer.current.unref?.();
  };

  return { closeArm, setCloseArm, armClose };
}
