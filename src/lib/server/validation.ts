import type { ApiErrorCode } from "../contracts";
import type { RequestQuery } from "./live-demo-store";

export class ApiFailure extends Error {
  constructor(public code: ApiErrorCode, message: string, public status: number) { super(message); }
}

export function parseRequestQuery(params: URLSearchParams): RequestQuery {
  for (const key of params.keys()) {
    if (!["cursor", "limit", "beforeMs"].includes(key) || params.getAll(key).length !== 1) {
      throw new ApiFailure("bad_request", `Unknown or repeated query parameter: ${key}.`, 400);
    }
  }
  const integer = (key: string, fallback?: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new ApiFailure("bad_request", `${key} must be a non-negative safe integer.`, 400);
    }
    return Number(value);
  };
  const limit = integer("limit", 50)!;
  if (limit < 1 || limit > 200) throw new ApiFailure("bad_request", "limit must be between 1 and 200.", 400);
  return { cursor: integer("cursor", 0)!, limit, beforeMs: integer("beforeMs") };
}
