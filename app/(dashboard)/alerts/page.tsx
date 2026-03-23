import { Card, CardContent } from "@/components/ui/card";
import { Bell } from "lucide-react";

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground">
          Out-of-stock notices and alternative product suggestions
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Bell className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Coming in Phase 5</h3>
          <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
            AI-powered out-of-stock detection with smart alternative product suggestions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
