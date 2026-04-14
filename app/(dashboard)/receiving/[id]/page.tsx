"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  PackageCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";

// -- Types --

interface ReceivingLineItem {
  id: string;
  ocrDescription: string;
  ocrQty: number;
  ocrUnitCost: number | null;
  matchedToPoLine: boolean;
  matchConfidence: number | null;
  qtyAccepted: number;
  notes: string | null;
  inventoryItemId: string | null;
  inventoryItem: {
    id: string;
    name: string;
    sku: string;
    currentStock: number;
  } | null;
}

interface ReceivingDetail {
  id: string;
  receivedDate: string;
  receivedBy: string | null;
  invoiceNumber: string | null;
  invoiceImageUrl: string | null;
  ocrRawText: string | null;
  ocrParsedData: any;
  matchStatus: string;
  locationCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: ReceivingLineItem[];
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
    vendor: { id: string; name: string };
  } | null;
}

// -- Match status helpers --

/* Determine per-line match status from the data */
function getLineMatchStatus(li: ReceivingLineItem): string {
  if (!li.matchedToPoLine && !li.inventoryItemId) return "UNMATCHED";
  if (li.matchConfidence !== null && li.matchConfidence >= 0.9) return "EXACT";
  if (li.matchConfidence !== null && li.matchConfidence >= 0.5) return "FUZZY";
  if (li.inventoryItemId && !li.matchedToPoLine) return "MANUAL";
  if (li.matchedToPoLine) return "FUZZY";
  return "UNMATCHED";
}

const matchStatusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  EXACT: { label: "Exact", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  FUZZY: { label: "Fuzzy", color: "bg-yellow-100 text-yellow-700", icon: AlertTriangle },
  UNMATCHED: { label: "Unmatched", color: "bg-red-100 text-red-700", icon: XCircle },
  MANUAL: { label: "Manual", color: "bg-blue-100 text-blue-700", icon: HelpCircle },
};

const receivingStatusColors: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  MATCHED: "bg-green-100 text-green-700",
  PARTIAL_MATCH: "bg-yellow-100 text-yellow-700",
  MISMATCH: "bg-red-100 text-red-700",
  MANUAL_REVIEW: "bg-orange-100 text-orange-700",
};

// -- Component --

export default function ReceivingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receiving, setReceiving] = useState<ReceivingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocrExpanded, setOcrExpanded] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/receiving/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load receiving");
        return res.json();
      })
      .then((data) => setReceiving(data.receiving))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !receiving) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/receiving")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Receiving
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error || "Receiving not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -- Computed data --

  const lineStatuses = receiving.lineItems.map((li) => getLineMatchStatus(li));
  const matchCounts = {
    EXACT: lineStatuses.filter((s) => s === "EXACT").length,
    FUZZY: lineStatuses.filter((s) => s === "FUZZY").length,
    UNMATCHED: lineStatuses.filter((s) => s === "UNMATCHED").length,
    MANUAL: lineStatuses.filter((s) => s === "MANUAL").length,
  };

  const vendorName = receiving.purchaseOrder
    ? receiving.purchaseOrder.vendor.name
    : receiving.locationCode === "LL"
    ? "Lauderdale Lakes"
    : receiving.locationCode === "NL"
    ? "North Lauderdale"
    : "--";

  const isQuickReceive = !receiving.purchaseOrder;
  const formattedDate = new Date(receiving.receivedDate).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Attempt to parse OCR raw text for display
  let ocrDisplayText = receiving.ocrRawText || "";
  try {
    const parsed = JSON.parse(ocrDisplayText);
    ocrDisplayText = JSON.stringify(parsed, null, 2);
  } catch {
    // already plain text, leave as-is
  }

  // Row bg colors based on match status
  function rowBgColor(status: string): string {
    switch (status) {
      case "EXACT": return "bg-green-50";
      case "FUZZY": return "bg-yellow-50";
      case "UNMATCHED": return "bg-red-50";
      case "MANUAL": return "bg-blue-50";
      default: return "";
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">

      {/* -- Back Button -- */}
      <Button variant="ghost" size="sm" onClick={() => router.push("/receiving")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Receiving
      </Button>

      {/* -- Header -- */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Receiving Detail</h1>
            <Badge className={receivingStatusColors[receiving.matchStatus] || "bg-gray-100 text-gray-700"}>
              {receiving.matchStatus.replace(/_/g, " ")}
            </Badge>
            {isQuickReceive ? (
              <Badge variant="outline">Quick Receive</Badge>
            ) : (
              <Link href={`/po/${receiving.purchaseOrder!.id}`}>
                <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                  {receiving.purchaseOrder!.poNumber}
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Badge>
              </Link>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {formattedDate}
            {receiving.receivedBy && <> &middot; Received by {receiving.receivedBy}</>}
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{vendorName}</span>
          {receiving.invoiceNumber && (
            <span className="ml-3">Invoice: <span className="font-mono">{receiving.invoiceNumber}</span></span>
          )}
        </div>
      </div>

      {/* -- Summary Cards -- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{receiving.lineItems.length}</p>
            <p className="text-xs text-muted-foreground">Total Items</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-green-600">{matchCounts.EXACT}</p>
            <p className="text-xs text-muted-foreground">Exact</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-yellow-600">{matchCounts.FUZZY}</p>
            <p className="text-xs text-muted-foreground">Fuzzy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-red-600">{matchCounts.UNMATCHED}</p>
            <p className="text-xs text-muted-foreground">Unmatched</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{matchCounts.MANUAL}</p>
            <p className="text-xs text-muted-foreground">Manual</p>
          </CardContent>
        </Card>
      </div>

      {/* -- Line Items Table -- */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Line Items
          </h2>

          {receiving.lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No line items recorded.</p>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="md:hidden space-y-2">
                {receiving.lineItems.map((li, idx) => {
                  const status = lineStatuses[idx];
                  const cfg = matchStatusConfig[status] || matchStatusConfig.UNMATCHED;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={li.id}
                      className={`p-3 rounded-lg border space-y-2 ${rowBgColor(status)}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{li.ocrDescription}</p>
                          {li.inventoryItem && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Matched: {li.inventoryItem.name} ({li.inventoryItem.sku})
                            </p>
                          )}
                        </div>
                        <Badge className={`${cfg.color} shrink-0`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {cfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Qty: <span className="font-medium text-foreground">{li.ocrQty}</span></span>
                        {li.ocrUnitCost !== null && (
                          <span>Unit: <span className="font-medium text-foreground">${Number(li.ocrUnitCost).toFixed(2)}</span></span>
                        )}
                        {li.matchConfidence !== null && (
                          <span>Conf: {Math.round(li.matchConfidence * 100)}%</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block border rounded-lg overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-sm font-medium">OCR Description</th>
                      <th className="text-left p-3 text-sm font-medium">Matched Product</th>
                      <th className="text-center p-3 text-sm font-medium">Qty Received</th>
                      <th className="text-right p-3 text-sm font-medium">Unit Cost</th>
                      <th className="text-center p-3 text-sm font-medium">Confidence</th>
                      <th className="text-center p-3 text-sm font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiving.lineItems.map((li, idx) => {
                      const status = lineStatuses[idx];
                      const cfg = matchStatusConfig[status] || matchStatusConfig.UNMATCHED;
                      const Icon = cfg.icon;
                      return (
                        <tr key={li.id} className={`border-b ${rowBgColor(status)}`}>
                          <td className="p-3 text-sm max-w-[200px]">
                            <p className="truncate" title={li.ocrDescription}>
                              {li.ocrDescription}
                            </p>
                          </td>
                          <td className="p-3 text-sm">
                            {li.inventoryItem ? (
                              <div>
                                <p className="font-medium">{li.inventoryItem.name}</p>
                                <p className="text-xs text-muted-foreground font-mono">{li.inventoryItem.sku}</p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </td>
                          <td className="p-3 text-center text-sm font-medium">
                            {li.ocrQty}
                          </td>
                          <td className="p-3 text-right text-sm font-mono">
                            {li.ocrUnitCost !== null ? `$${Number(li.ocrUnitCost).toFixed(2)}` : "--"}
                          </td>
                          <td className="p-3 text-center text-sm">
                            {li.matchConfidence !== null ? (
                              <span className={
                                li.matchConfidence >= 0.9 ? "text-green-600 font-medium" :
                                li.matchConfidence >= 0.5 ? "text-yellow-600 font-medium" :
                                "text-red-600 font-medium"
                              }>
                                {Math.round(li.matchConfidence * 100)}%
                              </span>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <Badge className={cfg.color}>
                              <Icon className="h-3 w-3 mr-1" />
                              {cfg.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* -- OCR Raw Data (Collapsible) -- */}
      {ocrDisplayText && (
        <Card>
          <CardContent className="pt-6">
            <button
              onClick={() => setOcrExpanded(!ocrExpanded)}
              className="flex items-center gap-2 text-lg font-semibold w-full text-left"
            >
              <FileText className="h-5 w-5" />
              OCR Raw Data
              {ocrExpanded ? (
                <ChevronUp className="h-4 w-4 ml-auto" />
              ) : (
                <ChevronDown className="h-4 w-4 ml-auto" />
              )}
            </button>
            {ocrExpanded && (
              <pre className="mt-4 p-4 bg-muted rounded-lg text-xs overflow-auto max-h-96 whitespace-pre-wrap break-words">
                {ocrDisplayText}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* -- Notes -- */}
      {receiving.notes && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-2">Notes</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{receiving.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* -- Related PO Link -- */}
      {receiving.purchaseOrder && (
        <div className="flex justify-end">
          <Link href={`/po/${receiving.purchaseOrder.id}`}>
            <Button variant="outline" size="sm">
              View Purchase Order ({receiving.purchaseOrder.poNumber})
              <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
