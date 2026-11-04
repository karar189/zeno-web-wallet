import type { RouteQuote } from "@/types/domain";

/** Client-side ranking placeholder until backend scoring is wired. */
export function rankRoutes(quotes: RouteQuote[]): RouteQuote[] {
  return [...quotes];
}
