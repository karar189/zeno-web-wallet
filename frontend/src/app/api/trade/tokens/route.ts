import { loadTradeListings } from "@/features/trade/quote";

export async function GET() {
  const tokens = await loadTradeListings();
  return Response.json(
    { tokens },
    { headers: { "Cache-Control": "no-store" } },
  );
}
