export function formatDataSourceLabel(source: "live" | "mock"): string {
  return source === "live" ? "Live" : "Mock / demo";
}
