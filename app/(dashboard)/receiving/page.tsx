import { Card, CardContent } from "@/components/ui/card";
import { PackageCheck } from "lucide-react";

export default function ReceivingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receiving</h1>
        <p className="text-muted-foreground">
          Receive deliveries and update inventory with OCR
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <PackageCheck className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Coming in Phase 4</h3>
          <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
            Take a photo of delivery slips, OCR reads the items, and matches them against your purchase orders.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
