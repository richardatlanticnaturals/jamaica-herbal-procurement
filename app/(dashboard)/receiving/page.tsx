"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PackageCheck,
  Camera,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ---------- Types ----------

interface PO {
  id: string;
  poNumber: string;
  status: string;
  vendor: { id: string; name: string };
  _count?: { lineItems: number };
}

interface MatchedLineItem {
  id: string;
  ocrDescription: string;
  ocrQty: number;
  ocrUnitCost: number | null;
  matchedToPoLine: boolean;
  matchConfidence: number | null;
  matchStatus: "EXACT" | "FUZZY" | "UNMATCHED";
  matchedPoLineItem: {
    id: string;
    description: string;
    qtyOrdered: number;
    qtyReceived: number;
    inventoryItemId: string;
  } | null;
  inventoryItemId: string | null;
  inventoryItem?: { id: string; name: string; sku: string } | null;
}

interface ReceivingResult {
  receiving: {
    id: string;
    invoiceNumber: string | null;
    matchStatus: string;
    lineItems: MatchedLineItem[];
    purchaseOrder: {
      id: string;
      poNumber: string;
      status: string;
      vendor: { id: string; name: string };
      lineItems: any[];
    };
  };
  ocrResult: {
    vendorName: string | null;
    invoiceNumber: string | null;
    date: string | null;
    items: any[];
  };
}

interface PastReceiving {
  id: string;
  receivedDate: string;
  invoiceNumber: string | null;
  matchStatus: string;
  purchaseOrder: {
    poNumber: string;
    vendor: { name: string };
  };
  _count: { lineItems: number };
}

// Editable qty state per line item
interface EditableQty {
  [receivingLineItemId: string]: number;
}

// ---------- Component ----------

export default function ReceivingPage() {
  // PO selection
  const [availablePOs, setAvailablePOs] = useState<PO[]>([]);
  const [selectedPOId, setSelectedPOId] = useState("");
  const [loadingPOs, setLoadingPOs] = useState(true);

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Results
  const [result, setResult] = useState<ReceivingResult | null>(null);
  const [editableQtys, setEditableQtys] = useState<EditableQty>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Past receivings
  const [pastReceivings, setPastReceivings] = useState<PastReceiving[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [pastPage, setPastPage] = useState(1);
  const [pastTotalPages, setPastTotalPages] = useState(1);
  const [loadingPast, setLoadingPast] = useState(true);

  // Load available POs (SENT or CONFIRMED)
  useEffect(() => {
    async function loadPOs() {
      setLoadingPOs(true);
      try {
        const [sentRes, confirmedRes] = await Promise.all([
          fetch("/api/po?status=SENT&limit=100"),
          fetch("/api/po?status=CONFIRMED&limit=100"),
        ]);
        const sentData = await sentRes.json();
        const confirmedData = await confirmedRes.json();
        const allPOs = [
          ...(sentData.orders || []),
          ...(confirmedData.orders || []),
        ];
        // Also include PARTIALLY_RECEIVED
        const partialRes = await fetch(
          "/api/po?status=PARTIALLY_RECEIVED&limit=100"
        );
        const partialData = await partialRes.json();
        allPOs.push(...(partialData.orders || []));
        setAvailablePOs(allPOs);
      } catch {
        console.error("Failed to load POs");
      } finally {
        setLoadingPOs(false);
      }
    }
    loadPOs();
  }, []);

  // Load past receivings
  const loadPastReceivings = useCallback(async (p: number) => {
    setLoadingPast(true);
    try {
      const res = await fetch(`/api/receiving?page=${p}&limit=10`);
      const data = await res.json();
      setPastReceivings(data.receivings || []);
      setPastTotal(data.total || 0);
      setPastTotalPages(data.totalPages || 1);
    } catch {
      console.error("Failed to load past receivings");
    } finally {
      setLoadingPast(false);
    }
  }, []);

  useEffect(() => {
    loadPastReceivings(pastPage);
  }, [pastPage, loadPastReceivings]);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setConfirmed(false);

    // Preview
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);

    // Base64
    const reader = new FileReader();
    reader.onload = () => {
      setImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Process the delivery slip
  const handleProcess = async () => {
    if (!selectedPOId || !imageBase64) return;

    setProcessing(true);
    setError(null);
    setResult(null);
    setConfirmed(false);
    setProcessingStep("Sending image to OCR...");

    try {
      setProcessingStep("Extracting items with AI vision...");
      const res = await fetch("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: selectedPOId,
          image: imageBase64,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to process delivery slip");
      }

      setProcessingStep("Matching items to PO...");
      const data = await res.json();
      setResult(data);

      // Initialize editable quantities from OCR results
      const qtys: EditableQty = {};
      for (const li of data.receiving.lineItems) {
        qtys[li.id] = li.ocrQty;
      }
      setEditableQtys(qtys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
      setProcessingStep("");
    }
  };

  // Confirm receiving
  const handleConfirm = async () => {
    if (!result) return;

    setConfirming(true);
    setError(null);

    try {
      const lineItems = result.receiving.lineItems.map((li) => ({
        receivingLineItemId: li.id,
        qtyReceived: editableQtys[li.id] ?? li.ocrQty,
        matchStatus: li.matchStatus,
      }));

      const res = await fetch(
        `/api/receiving/${result.receiving.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineItems }),
        }
      );

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to confirm receiving");
      }

      setConfirmed(true);
      // Reload past receivings
      loadPastReceivings(1);
      setPastPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setConfirming(false);
    }
  };

  // Reset for new delivery
  const handleReset = () => {
    setSelectedPOId("");
    setImagePreview(null);
    setImageBase64(null);
    setResult(null);
    setEditableQtys({});
    setConfirmed(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Helper: match status badge
  const statusBadge = (status: string, confidence: number | null) => {
    const pct = confidence !== null ? Math.round(confidence * 100) : 0;
    switch (status) {
      case "EXACT":
        return (
          <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Exact {pct}%
          </Badge>
        );
      case "FUZZY":
        return (
          <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Fuzzy {pct}%
          </Badge>
        );
      case "UNMATCHED":
        return (
          <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
            <XCircle className="h-3 w-3" />
            Unmatched
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const receivingStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: "bg-gray-100 text-gray-700",
      MATCHED: "bg-green-100 text-green-700",
      PARTIAL_MATCH: "bg-yellow-100 text-yellow-700",
      MISMATCH: "bg-red-100 text-red-700",
      MANUAL_REVIEW: "bg-orange-100 text-orange-700",
    };
    return (
      <Badge className={map[status] || "bg-gray-100 text-gray-700"}>
        {status.replace(/_/g, " ")}
      </Badge>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receiving</h1>
        <p className="text-muted-foreground">
          Receive deliveries and update inventory with OCR
        </p>
      </div>

      {/* ========== New Delivery Section ========== */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">New Delivery</h2>
          </div>

          {confirmed ? (
            <div className="flex flex-col items-center py-10 space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-green-700">
                Delivery Confirmed
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Inventory has been updated and the PO status has been changed.
              </p>
              <Button onClick={handleReset}>Receive Another Delivery</Button>
            </div>
          ) : !result ? (
            <>
              {/* Step 1: Select PO */}
              <div className="space-y-2">
                <label
                  htmlFor="po-select"
                  className="text-sm font-medium leading-none"
                >
                  Select Purchase Order
                </label>
                <select
                  id="po-select"
                  value={selectedPOId}
                  onChange={(e) => setSelectedPOId(e.target.value)}
                  disabled={loadingPOs || processing}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {loadingPOs
                      ? "Loading purchase orders..."
                      : "Choose a PO..."}
                  </option>
                  {availablePOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} — {po.vendor.name} ({po.status})
                    </option>
                  ))}
                </select>
                {!loadingPOs && availablePOs.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No open purchase orders found (SENT, CONFIRMED, or
                    PARTIALLY_RECEIVED).
                  </p>
                )}
              </div>

              {/* Step 2: Upload Photo */}
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  Delivery Slip Photo
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageSelect}
                    className="hidden"
                    id="delivery-photo"
                    disabled={processing}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={processing}
                    className="gap-2"
                  >
                    <Camera className="h-4 w-4" />
                    Take Photo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      // Create a file input without capture for gallery
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (e) => {
                        const target = e.target as HTMLInputElement;
                        const file = target.files?.[0];
                        if (file) {
                          setError(null);
                          setResult(null);
                          setConfirmed(false);
                          const previewUrl = URL.createObjectURL(file);
                          setImagePreview(previewUrl);
                          const reader = new FileReader();
                          reader.onload = () =>
                            setImageBase64(reader.result as string);
                          reader.readAsDataURL(file);
                        }
                      };
                      input.click();
                    }}
                    disabled={processing}
                    className="gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Upload File
                  </Button>
                </div>

                {imagePreview && (
                  <div className="mt-3 relative">
                    <img
                      src={imagePreview}
                      alt="Delivery slip preview"
                      className="max-h-64 rounded-lg border object-contain"
                    />
                  </div>
                )}
              </div>

              {/* Step 3: Process */}
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handleProcess}
                  disabled={!selectedPOId || !imageBase64 || processing}
                  className="gap-2"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {processingStep}
                    </>
                  ) : (
                    <>
                      <PackageCheck className="h-4 w-4" />
                      Process Delivery Slip
                    </>
                  )}
                </Button>
                {(imagePreview || selectedPOId) && !processing && (
                  <Button variant="outline" onClick={handleReset}>
                    Reset
                  </Button>
                )}
              </div>
            </>
          ) : (
            /* ========== Results Section ========== */
            <div className="space-y-6">
              {/* OCR Summary */}
              <div className="rounded-md bg-muted/50 p-4 space-y-1">
                <div className="flex flex-wrap gap-4 text-sm">
                  {result.ocrResult.vendorName && (
                    <div>
                      <span className="font-medium">Vendor:</span>{" "}
                      {result.ocrResult.vendorName}
                    </div>
                  )}
                  {result.ocrResult.invoiceNumber && (
                    <div>
                      <span className="font-medium">Invoice #:</span>{" "}
                      {result.ocrResult.invoiceNumber}
                    </div>
                  )}
                  {result.ocrResult.date && (
                    <div>
                      <span className="font-medium">Date:</span>{" "}
                      {result.ocrResult.date}
                    </div>
                  )}
                  <div>
                    <span className="font-medium">PO:</span>{" "}
                    {result.receiving.purchaseOrder.poNumber}
                  </div>
                </div>
              </div>

              {/* Match Table */}
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">
                        OCR Extracted Item
                      </TableHead>
                      <TableHead className="min-w-[200px]">
                        PO Expected Item
                      </TableHead>
                      <TableHead className="text-center w-[100px]">
                        Match
                      </TableHead>
                      <TableHead className="text-center w-[80px]">
                        OCR Qty
                      </TableHead>
                      <TableHead className="text-center w-[80px]">
                        PO Qty
                      </TableHead>
                      <TableHead className="text-center w-[100px]">
                        Accept Qty
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.receiving.lineItems.map((li) => {
                      const rowBg =
                        li.matchStatus === "EXACT"
                          ? "bg-green-50/50"
                          : li.matchStatus === "FUZZY"
                            ? "bg-yellow-50/50"
                            : "bg-red-50/50";

                      return (
                        <TableRow key={li.id} className={rowBg}>
                          <TableCell>
                            <div className="font-medium text-sm">
                              {li.ocrDescription}
                            </div>
                            {li.ocrUnitCost !== null && (
                              <div className="text-xs text-muted-foreground">
                                ${Number(li.ocrUnitCost).toFixed(2)} each
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {li.matchedPoLineItem ? (
                              <div>
                                <div className="font-medium text-sm">
                                  {li.matchedPoLineItem.description}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Already received:{" "}
                                  {li.matchedPoLineItem.qtyReceived}/
                                  {li.matchedPoLineItem.qtyOrdered}
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">
                                No match found
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {statusBadge(
                              li.matchStatus,
                              li.matchConfidence
                            )}
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm">
                            {li.ocrQty}
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm">
                            {li.matchedPoLineItem
                              ? li.matchedPoLineItem.qtyOrdered
                              : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              min={0}
                              value={editableQtys[li.id] ?? li.ocrQty}
                              onChange={(e) =>
                                setEditableQtys((prev) => ({
                                  ...prev,
                                  [li.id]: parseInt(e.target.value) || 0,
                                }))
                              }
                              className="w-20 mx-auto text-center h-8 text-sm"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="gap-2"
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm Receiving
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== Past Receivings Section ========== */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">Past Receivings</h2>

          {loadingPast ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pastReceivings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No past receivings found.
            </p>
          ) : (
            <>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead className="text-center">Items</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastReceivings.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell className="text-sm">
                          {new Date(rec.receivedDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {rec.purchaseOrder.poNumber}
                        </TableCell>
                        <TableCell className="text-sm">
                          {rec.purchaseOrder.vendor.name}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {rec.invoiceNumber || "—"}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {rec._count.lineItems}
                        </TableCell>
                        <TableCell className="text-center">
                          {receivingStatusBadge(rec.matchStatus)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {pastTotalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {pastTotal} total receivings
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pastPage <= 1}
                      onClick={() => setPastPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Page {pastPage} of {pastTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pastPage >= pastTotalPages}
                      onClick={() => setPastPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
