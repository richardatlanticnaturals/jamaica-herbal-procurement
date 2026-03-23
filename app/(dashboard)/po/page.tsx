import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function PurchaseOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
        <p className="text-muted-foreground">
          Create, manage, and track purchase orders
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Coming in Phase 2</h3>
          <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
            Auto-generate purchase orders from low stock items, approve and email them to vendors.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
