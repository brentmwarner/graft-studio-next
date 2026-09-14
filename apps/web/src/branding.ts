import { GRAFT_PRODUCT_NAME, SYNARA_CANARY_DESKTOP_SCHEME } from "@synara/shared/desktopIdentity";

export const APP_BASE_NAME = GRAFT_PRODUCT_NAME;
const isCanaryDesktop =
  typeof window !== "undefined" && window.location?.protocol === `${SYNARA_CANARY_DESKTOP_SCHEME}:`;
export const APP_DISPLAY_NAME = isCanaryDesktop
  ? `${APP_BASE_NAME} Canary`
  : import.meta.env.DEV
    ? `${APP_BASE_NAME} (Dev)`
    : APP_BASE_NAME;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
