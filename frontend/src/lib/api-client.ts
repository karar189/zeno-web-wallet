import { ApiError } from "@/lib/errors";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000";

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function apiPost<TResponse, TBody extends object>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await parseJson<{ message?: string | string[] }>(response);
    const message = Array.isArray(payload.message)
      ? payload.message.join(", ")
      : (payload.message ?? response.statusText);
    throw new ApiError(message, response.status);
  }

  return parseJson<TResponse>(response);
}

export function getApiBaseUrl(): string {
  return API_BASE;
}
