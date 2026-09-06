import type { ApiError } from "../contracts";
import { ApiFailure } from "./validation";

/** Consistent envelopes and no browser/proxy caching of the replaceable live results. */
export async function respond<T>(action: () => T | Promise<T>, status = 200): Promise<Response> {
  try {
    return Response.json(await action(), { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : new ApiFailure("internal", "Unable to process the demo request.", 500);
    if (!(error instanceof ApiFailure)) console.error("Demo API failed", error);
    const body: ApiError = { error: { code: failure.code, message: failure.message } };
    return Response.json(body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function jsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiFailure("bad_request", "Content-Type must be application/json.", 400);
  }
  try { return await request.json(); }
  catch { throw new ApiFailure("bad_request", "Request body must be valid JSON.", 400); }
}
