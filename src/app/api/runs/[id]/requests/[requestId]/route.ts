import { respond } from "@/lib/server/http";
import { simulator } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_request: Request, context: { params: Promise<{ id: string; requestId: string }> }) {
  return respond(async () => {
    const { id, requestId } = await context.params;
    return simulator.trace(id, requestId);
  });
}
