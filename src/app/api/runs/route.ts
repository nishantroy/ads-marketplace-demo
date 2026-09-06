import { jsonBody, respond } from "@/lib/server/http";
import { simulator } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return respond(() => simulator.runs()); }
export function POST(request: Request) {
  return respond(async () => simulator.createRun(await jsonBody(request)), 201);
}
