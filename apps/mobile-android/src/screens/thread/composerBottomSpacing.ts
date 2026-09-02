const RESTING_COMPOSER_GAP = 10;
const KEYBOARD_COMPOSER_GAP = 10;

export function composerBottomPadding(
  safeAreaBottom: number,
  keyboardVisible: boolean,
): number {
  return keyboardVisible
    ? KEYBOARD_COMPOSER_GAP
    : safeAreaBottom + RESTING_COMPOSER_GAP;
}
