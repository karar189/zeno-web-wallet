import { apiPost } from "@/lib/api-client";
import type { PrivacyReport } from "@/types/domain";

export async function analyzeRoute(routeId: string): Promise<PrivacyReport> {
  return apiPost<PrivacyReport, { routeId: string }>("/analyze", { routeId });
}
