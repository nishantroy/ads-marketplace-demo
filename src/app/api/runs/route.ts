import { respond } from "@/lib/server/http";
import { simulator } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return respond(() => simulator.runs()); }
