import {
  parseResolveNetwork,
  resolveZcashName,
} from "@/features/zns/resolve-server";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  const network = parseResolveNetwork(url.searchParams.get("network"));

  if (!network) {
    return Response.json(
      { message: "Network must be testnet or mainnet." },
      { status: 400, headers },
    );
  }
  if (name.trim().length === 0) {
    return Response.json(
      { message: "Provide a Zcash name to resolve." },
      { status: 400, headers },
    );
  }
  if (name.length > 80) {
    return Response.json(
      { message: "Name is too long." },
      { status: 413, headers },
    );
  }

  try {
    const result = await resolveZcashName({
      query: name,
      network,
      signal: request.signal,
    });
    if (!result.ok) {
      return Response.json(
        { message: result.reason },
        { status: 400, headers },
      );
    }
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499, headers });
    }
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "The Zcash Names indexer timed out.",
      },
      { status: 502, headers },
    );
  }
}
