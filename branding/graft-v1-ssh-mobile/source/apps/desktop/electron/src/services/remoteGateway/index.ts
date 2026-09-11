export { createRemoteGateway, type RemoteGateway } from "./createRemoteGateway.js";
export { createEventJournal, type EventJournal } from "./eventJournal.js";
export { createPairingService, type PairingService } from "./pairingService.js";
export {
  createDesktopRemoteAdapters,
  mapDesktopApprovalDecision,
  mapPartEventToTimelineEvent,
  mapPartsToTimelineEvents,
} from "./desktopRemoteAdapters.js";
export {
  createPrStateResolver,
  type PrStateResolver,
} from "./prStateResolver.js";
export {
  createRemoteGatewayController,
  type RemoteGatewayController,
  type RemoteGatewayStatus,
} from "./remoteGatewayController.js";
export {
  configureRemoteGatewayHandlers,
  currentRemoteGatewayCursor,
  notifyRemoteGatewaySignedOut,
  publishRemoteGatewayEvent,
  registerRemoteGatewayIpc,
  stopRemoteGatewayController,
} from "./registerRemoteGatewayIpc.js";
export {
  createStubRemoteGatewayHandlers,
  type IssuedPairingCredential,
  type RemoteGatewayConfig,
  type RemoteGatewayEndpoint,
  type RemoteGatewayHandlers,
} from "./types.js";
export {
  wireDesktopRemoteGateway,
  type DesktopRemoteGatewayPorts,
} from "./wireDesktopRemoteGateway.js";
