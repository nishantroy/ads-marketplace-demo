import { respond } from "@/lib/server/http";
import { simulator } from "@/lib/server/runtime";
import { parseRequestQuery } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return respond(async () => simulator.requests((await context.params).id, parseRequestQuery(new URL(request.url).searchParams)));
}
