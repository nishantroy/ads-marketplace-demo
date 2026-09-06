import "server-only";
import { engineAdapter } from "./engine-adapter";
import { LiveDemoStore } from "./live-demo-store";
import { SimulatorService } from "./service";

// Share the two slots across route modules and local dev reloads, not across processes/instances.
const globalDemo = globalThis as typeof globalThis & { __adsLiveDemoV1?: LiveDemoStore };
const store = globalDemo.__adsLiveDemoV1 ??= new LiveDemoStore();
export const simulator = new SimulatorService(store, engineAdapter);
