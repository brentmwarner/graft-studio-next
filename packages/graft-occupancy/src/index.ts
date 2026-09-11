export { OccupancyStore } from "./occupancyStore";
export type {
  OccupancyCommandReservation,
  OccupancyEnrollment,
  OccupancyIdentity,
  OccupancyReplayResult,
  OccupancyStoreOptions,
  OccupancyStoredEvent,
  OccupancyStoredReceipt,
} from "./occupancyStore";
export {
  OccupancyCommandError,
  OccupancyProtocol,
  authorizeDesktopOccupancyCommand,
} from "./occupancyProtocol";
export type {
  OccupancyAuthorizationDecision,
  OccupancyAuthorizationInput,
  OccupancyConnection,
  OccupancyOpenResult,
  OccupancyProtocolOptions,
} from "./occupancyProtocol";
export {
  LINUX_X64_GLIBC_PLATFORM,
  diagnoseHostPlatform,
  requireSupportedHostPlatform,
} from "./hostPlatform";
export type { HostPlatformDiagnostic } from "./hostPlatform";
export { HEADLESS_HOST_CAPABILITIES } from "./capabilities";
