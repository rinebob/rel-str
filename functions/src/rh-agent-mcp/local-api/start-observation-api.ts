import { startRobinhoodObservationApi } from './robinhood-observation-api';

startRobinhoodObservationApi().catch((error) => {
  console.error('Failed to start Robinhood observation API:', error);
  process.exit(1);
});
