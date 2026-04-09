"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  RefreshCw,
  Package,
  Hash,
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

// Mobile wizard steps
type WizardStep = "select-po" | "take-photo" | "review-matches" | "confirm";

// ---------- Component ----------

export default function ReceivingPage() {
  // PO selection
  const [availablePOs, setAvailablePOs] = useState<PO[]>([]);
  const [selectedPOId, setSelectedPOId] = useState("");
  const [loadingPOs, setLoadingPOs] = useState(true);

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
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

  // Mobile wizard step tracking
  const [wizardStep, setWizardStep] = useState<WizardStep>("select-po");

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);

  // Swipe state for match cards (mobile)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Load available POs (SENT or CONFIRMED)
  const loadPOs = useCallback(async () => {
    setLoadingPOs(true);
    try {
      const [sentRes, confirmedRes, partialRes] = await Promise.all([
        fetch("/api/po?status=SENT&limit=100"),
        fetch("/api/po?status=CONFIRMED&limit=100"),
        fetch("/api/po?status=PARTIALLY_RECEIVED&limit=100"),
      ]);
      const sentData = await sentRes.json();
      const confirmedData = await confirmedRes.json();
      const partialData = await partialRes.json();
      const allPOs = [
        ...(sentData.orders || []),
        ...(confirmedData.orders || []),
        ...(partialData.orders || []),
      ];
      setAvailablePOs(allPOs);
    } catch {
      console.error("Failed to load POs");
    } finally {
      setLoadingPOs(false);
    }
  }, []);

  useEffect(() => {
    loadPOs();
  }, [loadPOs]);

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

  // Pull-to-refresh handler
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPOs();
    setRefreshing(false);
  };

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
      setCurrentMatchIndex(0);

      // Initialize editable quantities from OCR results
      const qtys: EditableQty = {};
      for (const li of data.receiving.lineItems) {
        qtys[li.id] = li.ocrQty;
      }
      setEditableQtys(qtys);

      // Advance wizard to review step
      setWizardStep("review-matches");
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
      setWizardStep("confirm");
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
    setWizardStep("select-po");
    setCurrentMatchIndex(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  // Select PO and advance wizard
  const handlePOSelect = (poId: string) => {
    setSelectedPOId(poId);
    if (poId) {
      setWizardStep("take-photo");
    }
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

  // Get the selected PO object for display
  const selectedPO = availablePOs.find((po) => po.id === selectedPOId);

  // Count match stats
  const matchStats = result
    ? {
        exact: result.receiving.lineItems.filter(
          (li) => li.matchStatus === "EXACT"
        ).length,
        fuzzy: result.receiving.lineItems.filter(
          (li) => li.matchStatus === "FUZZY"
        ).length,
        unmatched: result.receiving.lineItems.filter(
          (li) => li.matchStatus === "UNMATCHED"
        ).length,
        total: result.receiving.lineItems.length,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receiving</h1>
          <p className="text-muted-foreground text-sm">
            Receive deliveries and update inventory with OCR
          </p>
        </div>
        {/* Pull-to-refresh button (visible on mobile) */}
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing}
          className="md:hidden h-10 w-10"
          aria-label="Refresh PO list"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* ========== Mobile Wizard Progress (hidden on desktop) ========== */}
      {!confirmed && (
        <div className="flex items-center gap-1 md:hidden">
          {(
            [
              { step: "select-po", label: "PO" },
              { step: "take-photo", label: "Photo" },
              { step: "review-matches", label: "Review" },
              { step: "confirm", label: "Done" },
            ] as { step: WizardStep; label: string }[]
          ).map((s, i) => {
            const steps: WizardStep[] = [
              "select-po",
              "take-photo",
              "review-matches",
              "confirm",
            ];
            const currentIdx = steps.indexOf(wizardStep);
            const stepIdx = steps.indexOf(s.step);
            const isActive = stepIdx === currentIdx;
            const isDone = stepIdx < currentIdx;
            return (
              <div key={s.step} className="flex items-center gap-1 flex-1">
                <div
                  className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0 ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isDone
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-xs ${isActive ? "font-semibold" : "text-muted-foreground"}`}
                >
                  {s.label}
                </span>
                {i < 3 && (
                  <div
                    className={`flex-1 h-0.5 ${isDone ? "bg-green-500" : "bg-muted"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ========== New Delivery Section ========== */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">New Delivery</h2>
          </div>

          {confirmed ? (
            /* ---- Confirmed State ---- */
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
              <Button
                onClick={handleReset}
                className="h-12 px-6 text-base"
              >
                Receive Another Delivery
              </Button>
            </div>
          ) : !result ? (
            <>
              {/* ---- Step 1: Select PO ---- */}
              {/* On mobile, only show current wizard step. On desktop, show all steps. */}
              <div
                className={`space-y-3 ${wizardStep !== "select-po" ? "hidden md:block" : ""}`}
              >
                <label
                  htmlFor="po-select"
                  className="text-sm font-medium leading-none flex items-center gap-2"
                >
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold md:hidden">
                    1
                  </span>
                  Select Purchase Order
                </label>

                {/* Refresh button for desktop */}
                <div className="hidden md:flex items-center gap-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="gap-1 text-xs"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                </div>

                {/* Mobile: large touch-friendly PO cards */}
                <div className="md:hidden space-y-2">
                  {loadingPOs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : availablePOs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No open purchase orders found.
                    </p>
                  ) : (
                    availablePOs.map((po) => (
                      <button
                        key={po.id}
                        onClick={() => handlePOSelect(po.id)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors active:scale-[0.98] ${
                          selectedPOId === po.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                        style={{ minHeight: "64px" }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-base">
                              {po.poNumber}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {po.vendor.name}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge
                              variant="outline"
                              className="text-xs"
                            >
                              {po.status}
                            </Badge>
                            {po._count?.lineItems && (
                              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                                <Package className="h-3 w-3" />
                                {po._count.lineItems} items
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Desktop: dropdown select */}
                <select
                  id="po-select"
                  value={selectedPOId}
                  onChange={(e) => setSelectedPOId(e.target.value)}
                  disabled={loadingPOs || processing}
                  className="hidden md:flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {loadingPOs
                      ? "Loading purchase orders..."
                      : "Choose a PO..."}
                  </option>
                  {availablePOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} -- {po.vendor.name} ({po.status}){" "}
                      {po._count?.lineItems
                        ? `[${po._count.lineItems} items]`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* ---- Step 2: Upload Photo ---- */}
              <div
                className={`space-y-3 ${wizardStep !== "take-photo" && wizardStep !== "select-po" ? "hidden md:block" : ""} ${wizardStep === "select-po" ? "hidden md:block" : ""}`}
              >
                {/* Mobile: show selected PO summary */}
                {selectedPO && (
                  <div className="md:hidden flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                    <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {selectedPO.poNumber}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {selectedPO.vendor.name}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWizardStep("select-po")}
                      className="text-xs shrink-0"
                    >
                      Change
                    </Button>
                  </div>
                )}

                <label className="text-sm font-medium leading-none flex items-center gap-2">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold md:hidden">
                    2
                  </span>
                  Delivery Slip Photo
                </label>

                {/* Hidden file inputs */}
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
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                  id="delivery-gallery"
                  disabled={processing}
                />

                {/* Mobile: large camera button */}
                <div className="md:hidden space-y-3">
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={processing}
                    className="w-full gap-3 text-base"
                    style={{ minHeight: "56px" }}
                  >
                    <Camera className="h-5 w-5" />
                    Take Photo of Delivery Slip
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={processing}
                    className="w-full gap-3 text-base"
                    style={{ minHeight: "48px" }}
                  >
                    <Upload className="h-5 w-5" />
                    Upload from Gallery
                  </Button>
                </div>

                {/* Desktop: standard buttons */}
                <div className="hidden md:flex gap-3">
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
                    onClick={() => galleryInputRef.current?.click()}
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
                      className="max-h-48 md:max-h-64 rounded-lg border object-contain w-full"
                    />
                  </div>
                )}
              </div>

              {/* Error display */}
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Process button */}
              <div className="flex flex-col md:flex-row gap-3">
                <Button
                  onClick={handleProcess}
                  disabled={!selectedPOId || !imageBase64 || processing}
                  className="gap-2 md:w-auto w-full text-base"
                  style={{ minHeight: "48px" }}
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
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="md:w-auto w-full"
                    style={{ minHeight: "48px" }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </>
          ) : (
            /* ========== Results Section ========== */
            <div className="space-y-4">
              {/* OCR Summary */}
              <div className="rounded-md bg-muted/50 p-4 space-y-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
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

                {/* Match stats summary -- prominent on mobile */}
                {matchStats && (
                  <div className="flex gap-3 pt-2">
                    <div className="flex items-center gap-1 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                      {matchStats.exact} exact
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                      {matchStats.fuzzy} fuzzy
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                      {matchStats.unmatched} unmatched
                    </div>
                    <div className="text-xs text-muted-foreground ml-auto">
                      {matchStats.total} total
                    </div>
                  </div>
                )}
              </div>

              {/* ---- Mobile: Swipeable Match Cards ---- */}
              <div className="md:hidden space-y-3">
                {result.receiving.lineItems.length > 0 && (
                  <>
                    {/* Card navigation */}
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setCurrentMatchIndex((i) => Math.max(0, i - 1))
                        }
                        disabled={currentMatchIndex === 0}
                        className="h-10 w-10"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium">
                        Item {currentMatchIndex + 1} of{" "}
                        {result.receiving.lineItems.length}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setCurrentMatchIndex((i) =>
                            Math.min(
                              result.receiving.lineItems.length - 1,
                              i + 1
                            )
                          )
                        }
                        disabled={
                          currentMatchIndex ===
                          result.receiving.lineItems.length - 1
                        }
                        className="h-10 w-10"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Current match card */}
                    {(() => {
                      const li =
                        result.receiving.lineItems[currentMatchIndex];
                      if (!li) return null;
                      const cardBg =
                        li.matchStatus === "EXACT"
                          ? "border-green-200 bg-green-50/50"
                          : li.matchStatus === "FUZZY"
                            ? "border-yellow-200 bg-yellow-50/50"
                            : "border-red-200 bg-red-50/50";

                      return (
                        <div
                          className={`rounded-xl border-2 p-4 space-y-3 ${cardBg}`}
                        >
                          {/* Match status */}
                          <div className="flex items-center justify-between">
                            {statusBadge(
                              li.matchStatus,
                              li.matchConfidence
                            )}
                          </div>

                          {/* OCR item */}
                          <div>
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Scanned Item
                            </div>
                            <div className="font-semibold text-base mt-0.5">
                              {li.ocrDescription}
                            </div>
                            {li.ocrUnitCost !== null && (
                              <div className="text-sm text-muted-foreground">
                                ${Number(li.ocrUnitCost).toFixed(2)} each
                              </div>
                            )}
                          </div>

                          {/* PO match */}
                          {li.matchedPoLineItem && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                PO Expected
                              </div>
                              <div className="font-medium text-sm mt-0.5">
                                {li.matchedPoLineItem.description}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Received: {li.matchedPoLineItem.qtyReceived}
                                /{li.matchedPoLineItem.qtyOrdered}
                              </div>
                            </div>
                          )}

                          {/* Quantity row */}
                          <div className="flex items-center gap-4 pt-1">
                            <div className="flex-1">
                              <div className="text-xs text-muted-foreground">
                                OCR Qty
                              </div>
                              <div className="font-mono text-lg font-bold">
                                {li.ocrQty}
                              </div>
                            </div>
                            {li.matchedPoLineItem && (
                              <div className="flex-1">
                                <div className="text-xs text-muted-foreground">
                                  PO Qty
                                </div>
                                <div className="font-mono text-lg font-bold">
                                  {li.matchedPoLineItem.qtyOrdered}
                                </div>
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="text-xs text-muted-foreground">
                                Accept
                              </div>
                              <Input
                                type="number"
                                min={0}
                                value={editableQtys[li.id] ?? li.ocrQty}
                                onChange={(e) =>
                                  setEditableQtys((prev) => ({
                                    ...prev,
                                    [li.id]:
                                      parseInt(e.target.value) || 0,
                                  }))
                                }
                                className="w-20 text-center text-lg font-bold h-10"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Dot indicators */}
                    <div className="flex justify-center gap-1.5">
                      {result.receiving.lineItems.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentMatchIndex(i)}
                          className={`h-2 rounded-full transition-all ${
                            i === currentMatchIndex
                              ? "w-6 bg-primary"
                              : "w-2 bg-muted-foreground/30"
                          }`}
                          aria-label={`Go to item ${i + 1}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ---- Desktop: Table View ---- */}
              <div className="hidden md:block border rounded-lg overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-sm font-medium min-w-[200px]">
                        OCR Extracted Item
                      </th>
                      <th className="text-left p-3 text-sm font-medium min-w-[200px]">
                        PO Expected Item
                      </th>
                      <th className="text-center p-3 text-sm font-medium w-[100px]">
                        Match
                      </th>
                      <th className="text-center p-3 text-sm font-medium w-[80px]">
                        OCR Qty
                      </th>
                      <th className="text-center p-3 text-sm font-medium w-[80px]">
                        PO Qty
                      </th>
                      <th className="text-center p-3 text-sm font-medium w-[100px]">
                        Accept Qty
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.receiving.lineItems.map((li) => {
                      const rowBg =
                        li.matchStatus === "EXACT"
                          ? "bg-green-50/50"
                          : li.matchStatus === "FUZZY"
                            ? "bg-yellow-50/50"
                            : "bg-red-50/50";

                      return (
                        <tr key={li.id} className={`border-b ${rowBg}`}>
                          <td className="p-3">
                            <div className="font-medium text-sm">
                              {li.ocrDescription}
                            </div>
                            {li.ocrUnitCost !== null && (
                              <div className="text-xs text-muted-foreground">
                                ${Number(li.ocrUnitCost).toFixed(2)} each
                              </div>
                            )}
                          </td>
                          <td className="p-3">
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
                          </td>
                          <td className="p-3 text-center">
                            {statusBadge(
                              li.matchStatus,
                              li.matchConfidence
                            )}
                          </td>
                          <td className="p-3 text-center font-mono text-sm">
                            {li.ocrQty}
                          </td>
                          <td className="p-3 text-center font-mono text-sm">
                            {li.matchedPoLineItem
                              ? li.matchedPoLineItem.qtyOrdered
                              : "--"}
                          </td>
                          <td className="p-3 text-center">
                            <Input
                              type="number"
                              min={0}
                              value={editableQtys[li.id] ?? li.ocrQty}
                              onChange={(e) =>
                                setEditableQtys((prev) => ({
                                  ...prev,
                                  [li.id]:
                                    parseInt(e.target.value) || 0,
                                }))
                              }
                              className="w-20 mx-auto text-center h-8 text-sm"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* ---- Confirm Actions ---- */}
              <div className="flex flex-col md:flex-row gap-3">
                {/* Big green Confirm All button */}
                <Button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white md:w-auto w-full text-base font-semibold"
                  style={{ minHeight: "56px" }}
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" />
                      Confirm All ({result.receiving.lineItems.length}{" "}
                      items)
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="md:w-auto w-full"
                  style={{ minHeight: "48px" }}
                >
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
              {/* Mobile: card list */}
              <div className="md:hidden space-y-2">
                {pastReceivings.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-3 rounded-lg border space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold">
                        {rec.purchaseOrder.poNumber}
                      </span>
                      {receivingStatusBadge(rec.matchStatus)}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{rec.purchaseOrder.vendor.name}</span>
                      <span>
                        {new Date(rec.receivedDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {rec.invoiceNumber && (
                        <span>Inv: {rec.invoiceNumber}</span>
                      )}
                      <span>{rec._count.lineItems} items</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block border rounded-lg overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-sm font-medium">
                        Date
                      </th>
                      <th className="text-left p-3 text-sm font-medium">
                        PO Number
                      </th>
                      <th className="text-left p-3 text-sm font-medium">
                        Vendor
                      </th>
                      <th className="text-left p-3 text-sm font-medium">
                        Invoice #
                      </th>
                      <th className="text-center p-3 text-sm font-medium">
                        Items
                      </th>
                      <th className="text-center p-3 text-sm font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastReceivings.map((rec) => (
                      <tr key={rec.id} className="border-b">
                        <td className="p-3 text-sm">
                          {new Date(
                            rec.receivedDate
                          ).toLocaleDateString()}
                        </td>
                        <td className="p-3 font-mono text-sm">
                          {rec.purchaseOrder.poNumber}
                        </td>
                        <td className="p-3 text-sm">
                          {rec.purchaseOrder.vendor.name}
                        </td>
                        <td className="p-3 text-sm font-mono">
                          {rec.invoiceNumber || "--"}
                        </td>
                        <td className="p-3 text-center text-sm">
                          {rec._count.lineItems}
                        </td>
                        <td className="p-3 text-center">
                          {receivingStatusBadge(rec.matchStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      className="h-9 w-9"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      {pastPage} / {pastTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pastPage >= pastTotalPages}
                      onClick={() => setPastPage((p) => p + 1)}
                      className="h-9 w-9"
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
