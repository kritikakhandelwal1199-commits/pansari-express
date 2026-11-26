/**
 * Global function options. Imported FIRST by index.ts: ES module imports (and `export … from`)
 * are evaluated before index.ts's own body, so calling setGlobalOptions there was too late for
 * functions defined in other files — they silently defaulted to us-central1.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

export const REGION = 'asia-south1';
setGlobalOptions({ region: REGION, maxInstances: 10 });
