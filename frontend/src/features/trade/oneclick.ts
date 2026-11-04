const BASE = "https://1click.chaindefuser.com/v0";

export async function oneClick(
  path: string,
  fetcher: typeof fetch = fetch,
  body?: object,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  const key = process.env.NEAR_INTENTS_API_KEY?.trim();
  if (key) {
    if (key.includes(".")) {
      headers.Authorization = `Bearer ${key}`;
    } else {
      headers["X-API-Key"] = key;
    }
  }
  const response = await fetcher(`${BASE}/${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "1Click is rate limiting quotes. Wait and try again."
        : response.status === 401
          ? "1Click rejected the API key. Check NEAR_INTENTS_API_KEY."
          : "1Click could not complete this request. Try again.",
    );
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}
