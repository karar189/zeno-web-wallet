import { fetchTradeQuote, validateTrade } from "@/features/trade/quote";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) {
    return Response.json(
      { message: "Use the trade form on this site." },
      { status: 403, headers },
    );
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ message: "Send JSON." }, { status: 415, headers });
  }
  const raw = await request.text();
  if (raw.length > 1024) {
    return Response.json(
      { message: "Request is too large." },
      { status: 413, headers },
    );
  }
  let input;
  try {
    input = validateTrade(JSON.parse(raw));
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Invalid request." },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await fetchTradeQuote(input), { headers });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "The quote provider timed out. Try again.",
      },
      { status: 502, headers },
    );
  }
}

function sameOrigin(request: Request): boolean {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return (
      (origin.protocol === "https:" || origin.protocol === "http:") &&
      origin.host === host
    );
  } catch {
    return false;
  }
}
