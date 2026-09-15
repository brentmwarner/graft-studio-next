import { DISCLOSURE_EASE_OUT, DISCLOSURE_TRANSITION_MS } from "@synara/shared/disclosureMotion";
import { cubicBezier, useReducedMotion } from "react-native-reanimated";

const easing = cubicBezier(...DISCLOSURE_EASE_OUT);

export function useDisclosureHeightTransition() {
  const reducedMotion = useReducedMotion();
  return {
    transitionProperty: "height" as const,
    transitionDuration: reducedMotion ? 0 : DISCLOSURE_TRANSITION_MS,
    transitionTimingFunction: easing,
  };
}
