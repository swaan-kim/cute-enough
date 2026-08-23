import { SafeArea } from '@apps-in-toss/web-framework';

type Insets = { top: number; right: number; bottom: number; left: number };

function applyInsets(insets: Insets) {
  const root = document.documentElement.style;
  root.setProperty('--ait-safe-top', `${Math.max(0, insets.top)}px`);
  root.setProperty('--ait-safe-right', `${Math.max(0, insets.right)}px`);
  root.setProperty('--ait-safe-bottom', `${Math.max(0, insets.bottom)}px`);
  root.setProperty('--ait-safe-left', `${Math.max(0, insets.left)}px`);
}

export function subscribeSafeArea(): () => void {
  try {
    applyInsets(SafeArea.get());
    return SafeArea.subscribe({ onEvent: applyInsets });
  } catch {
    return () => undefined;
  }
}
