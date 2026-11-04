import { fetchSwapStatus, validateDepositAddress } from "@/features/trade/status";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) {
    return Response.json(
      { message: "Use the trade form on this site." },
      { status: 403, headers },
    );
  }
  const url = new URL(request.url);
  let depositAddress: string;
  try {
    depositAddress = validateDepositAddress(
      url.searchParams.get("depositAddress") ?? "",
    );
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error ? error.message : "Missing deposit address.",
      },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await fetchSwapStatus(depositAddress), { headers });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "The status check timed out. Try again.",
      },
      { status: 502, headers },
    );
  }
}

function sameOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    const site = request.headers.get("sec-fetch-site");
    return site === "same-origin" || site === "same-site";
  }
  try {
    const origin = new URL(originHeader);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return (
      (origin.protocol === "https:" || origin.protocol === "http:") &&
      origin.host === host
    );
  } catch {
    return false;
  }
}
