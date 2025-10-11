import './init';

// Re-export partner functions from dedicated module

export {partnerProxyTest} from "./partner-proxy";
export { processDataReadyRun } from "./webhooks/partner-webhooks";

// seeding function for initial pairs document creation
export { seedPairRegistryManual } from "./webhooks/partner-webhooks";
