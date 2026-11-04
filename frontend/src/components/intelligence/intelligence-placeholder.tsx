import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function IntelligencePlaceholder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Zeno Wallet Intelligence</CardTitle>
        <CardDescription>
          AI-assisted liquidity and route dependency insights will live here.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        Scaffold only — not wired in this prototype yet.
      </CardContent>
    </Card>
  );
}
