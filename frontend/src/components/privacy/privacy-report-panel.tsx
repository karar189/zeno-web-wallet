import type { PrivacyReport } from "@/types/domain";

type PrivacyReportPanelProps = {
  report: PrivacyReport | null;
};

export function PrivacyReportPanel({ report }: PrivacyReportPanelProps) {
  if (!report) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a route to view privacy findings.
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p>
        Route <span className="font-mono">{report.routeId}</span> · assessed{" "}
        {new Date(report.assessedAt).toLocaleString()}
      </p>
      {report.limitations.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}
