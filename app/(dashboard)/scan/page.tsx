"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ScanLine,
  Loader2,
  Package,
  DollarSign,
  TrendingUp,
  Truck,
  Tags,
  AlertTriangle,
  X,
  Zap,
  Eye,
  PenSquare,
  FileText,
  Flashlight,
  FlashlightOff,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

// ---------- Types ----------

interface ProductResult {
  source: "local" | "comcash";
  product: {
    id: string | null;
    comcashId?: number;
    sku: string;
    vendorSku?: string;
    name: string;
    category: string | null;
    currentStock: number | null;
    reorderPoint?: number;
    reorderQty?: number;
    costPrice: number | null;
    retailPrice: number | null;
    unitOfMeasure?: string;
    locationLL?: number;
    locationNL?: number;
    vendor: { id: string | null; name: string } | null;
  };
  sales: {
    totalQtySold: number;
    totalRevenue: number;
    periods: {
      start: string;
      end: string;
      qtySold: number;
      revenue: number;
    }[];
  } | null;
}

// ---------- Component ----------

export default function ScanPage() {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  // Barcode result
  const [barcode, setBarcode] = useState<string>("");
  const [manualCode, setManualCode] = useState("");

  // Product lookup
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit stock dialog
  const [editingStock, setEditingStock] = useState(false);
  const [newStock, setNewStock] = useState("");
  const [savingStock, setSavingStock] = useState(false);

  // Ref to always call the latest handleBarcodeScan without stale closures
  const handleBarcodeScanRef = useRef<(code: string) => void>(() => {});

  // Initialize scanner
  const startScanner = useCallback(async () => {
    if (!scannerRef.current || html5QrCodeRef.current) return;

    try {
      // Dynamic import to avoid SSR issues with html5-qrcode
      const { Html5Qrcode } = await import("html5-qrcode");

      const scanner = new Html5Qrcode("barcode-scanner");
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          aspectRatio: 1.0,
        },
        (decodedText: string) => {
          // Use ref to avoid stale closure over barcode/product state
          handleBarcodeScanRef.current(decodedText);
        },
        () => {
          // QR code scan error (expected while scanning -- ignore)
        }
      );

      setScanning(true);
      setScannerReady(true);
    } catch (err) {
      console.error("Failed to start scanner:", err);
      setError(
        "Camera access denied or not available. Use manual entry below."
      );
    }
  }, []);

  // Stop scanner
  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
      } catch {
        // Already stopped
      }
      try {
        html5QrCodeRef.current.clear();
      } catch {
        // Already cleared
      }
      html5QrCodeRef.current = null;
    }
    setScanning(false);
    setScannerReady(false);
    setFlashOn(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.stop();
        } catch {
          // Ignore
        }
        try {
          html5QrCodeRef.current.clear();
        } catch {
          // Ignore
        }
        html5QrCodeRef.current = null;
      }
    };
  }, []);

  // Handle barcode scan result
  // Keep ref updated so scanner callback always calls latest version
  const handleBarcodeScan = async (code: string) => {
    // Prevent duplicate lookups
    if (code === barcode && product) return;

    setBarcode(code);
    setManualCode(code);
    setError(null);
    setProduct(null);
    setLoading(true);

    try {
      const res = await fetch(
        `/api/inventory/barcode?code=${encodeURIComponent(code)}`
      );

      if (res.status === 404) {
        setError(`No product found for barcode: ${code}`);
        setProduct(null);
        return;
      }

      if (!res.ok) {
        throw new Error("Barcode lookup failed");
      }

      const data = await res.json();
      setProduct(data);

      // Pause scanner after successful scan to show results
      await stopScanner();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  // Keep ref updated so scanner callback always uses latest closure
  handleBarcodeScanRef.current = handleBarcodeScan;

  // Manual barcode entry
  const handleManualLookup = () => {
    if (manualCode.trim()) {
      handleBarcodeScan(manualCode.trim());
    }
  };

  // Toggle flash
  const toggleFlash = async () => {
    if (!html5QrCodeRef.current) return;
    try {
      const track = html5QrCodeRef.current
        .getRunningTrackSettings?.()
        ?.getCapabilities?.();
      // html5-qrcode does not expose flash directly, so we try via the video track
      const videoElement = document.querySelector(
        "#barcode-scanner video"
      ) as HTMLVideoElement;
      if (videoElement?.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities() as any;
          if (capabilities?.torch) {
            await videoTrack.applyConstraints({
              advanced: [{ torch: !flashOn } as any],
            });
            setFlashOn(!flashOn);
          }
        }
      }
    } catch {
      // Flash not supported
    }
  };

  // Save stock edit
  const handleSaveStock = async () => {
    if (!product?.product.id || newStock === "") return;

    setSavingStock(true);
    try {
      const res = await fetch(`/api/inventory/${product.product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStock: parseInt(newStock) }),
      });

      if (!res.ok) throw new Error("Failed to update stock");

      // Update local state
      setProduct((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          product: {
            ...prev.product,
            currentStock: parseInt(newStock),
          },
        };
      });
      setEditingStock(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingStock(false);
    }
  };

  // Scan again
  const handleScanAgain = () => {
    setProduct(null);
    setError(null);
    setBarcode("");
    setManualCode("");
    startScanner();
  };

  // Stock status helper
  const stockStatus = (stock: number | null, reorderPoint?: number) => {
    if (stock === null || stock === undefined) return null;
    if (stock <= 0) {
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200">
          Out of Stock
        </Badge>
      );
    }
    if (reorderPoint && stock <= reorderPoint) {
      return (
        <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">
          Low Stock
        </Badge>
      );
    }
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200">
        In Stock
      </Badge>
    );
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Barcode Scanner</h1>
        <p className="text-muted-foreground text-sm">
          Scan a barcode to look up product details
        </p>
      </div>

      {/* Scanner View */}
      {!product && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Camera viewport */}
            <div className="relative bg-black">
              <div
                id="barcode-scanner"
                ref={scannerRef}
                className="w-full"
                style={{ minHeight: scanning ? "300px" : "0px" }}
              />

              {!scanning && !loading && (
                <div className="flex flex-col items-center justify-center py-12 px-6 bg-muted/50">
                  <ScanLine className="h-12 w-12 text-muted-foreground mb-4" />
                  <Button
                    onClick={startScanner}
                    className="gap-2 text-base w-full max-w-xs"
                    style={{ minHeight: "56px" }}
                  >
                    <ScanLine className="h-5 w-5" />
                    Start Camera Scanner
                  </Button>
                </div>
              )}

              {/* Scanner overlay controls */}
              {scanning && (
                <div className="absolute bottom-3 left-3 right-3 flex justify-between">
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={toggleFlash}
                    className="h-10 w-10 bg-black/50 hover:bg-black/70 text-white border-0"
                    aria-label="Toggle flash"
                  >
                    {flashOn ? (
                      <FlashlightOff className="h-5 w-5" />
                    ) : (
                      <Flashlight className="h-5 w-5" />
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={stopScanner}
                    className="h-10 w-10 bg-black/50 hover:bg-black/70 text-white border-0"
                    aria-label="Stop scanner"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Manual entry */}
            <div className="p-4 space-y-3 border-t">
              <label className="text-sm font-medium">
                Or enter barcode manually
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter UPC, EAN, or SKU..."
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleManualLookup();
                  }}
                  className="flex-1"
                  style={{ minHeight: "48px", fontSize: "16px" }}
                />
                <Button
                  onClick={handleManualLookup}
                  disabled={!manualCode.trim() || loading}
                  style={{ minHeight: "48px" }}
                  className="px-6"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Look Up"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">
              Looking up barcode: {barcode}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center py-6 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-7 w-7 text-red-600" />
              </div>
              <p className="text-sm text-center text-red-700">{error}</p>
              <Button
                onClick={handleScanAgain}
                className="gap-2"
                style={{ minHeight: "48px" }}
              >
                <RotateCcw className="h-4 w-4" />
                Scan Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product Details */}
      {product && !loading && (
        <div className="space-y-4">
          {/* Product header card */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Source badge */}
              <div className="flex items-center justify-between">
                <Badge
                  variant="outline"
                  className="text-xs"
                >
                  {product.source === "local"
                    ? "Local Inventory"
                    : "Comcash POS"}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {barcode}
                </span>
              </div>

              {/* Product name and SKU */}
              <div>
                <h2 className="text-xl font-bold">{product.product.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                  <span className="font-mono">SKU: {product.product.sku}</span>
                  {product.product.vendorSku && (
                    <span className="font-mono">
                      Vendor SKU: {product.product.vendorSku}
                    </span>
                  )}
                </div>
              </div>

              {/* Stock status */}
              <div className="flex items-center gap-3">
                {stockStatus(
                  product.product.currentStock,
                  product.product.reorderPoint
                )}
                {product.product.currentStock !== null && (
                  <span className="text-2xl font-bold">
                    {product.product.currentStock}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      {product.product.unitOfMeasure || "units"}
                    </span>
                  </span>
                )}
              </div>

              {/* Stock by location */}
              {(product.product.locationLL !== undefined ||
                product.product.locationNL !== undefined) && (
                <div className="flex gap-4 text-sm">
                  {product.product.locationLL !== undefined && (
                    <div className="flex-1 p-2 rounded bg-muted/50 text-center">
                      <div className="text-xs text-muted-foreground">
                        Lauderdale Lakes
                      </div>
                      <div className="font-bold">
                        {product.product.locationLL}
                      </div>
                    </div>
                  )}
                  {product.product.locationNL !== undefined && (
                    <div className="flex-1 p-2 rounded bg-muted/50 text-center">
                      <div className="text-xs text-muted-foreground">
                        North Lauderdale
                      </div>
                      <div className="font-bold">
                        {product.product.locationNL}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Cost */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">Cost</span>
                </div>
                <div className="text-lg font-bold">
                  {product.product.costPrice !== null
                    ? `$${product.product.costPrice.toFixed(2)}`
                    : "--"}
                </div>
              </CardContent>
            </Card>

            {/* Retail */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">Retail</span>
                </div>
                <div className="text-lg font-bold">
                  {product.product.retailPrice !== null
                    ? `$${product.product.retailPrice.toFixed(2)}`
                    : "--"}
                </div>
              </CardContent>
            </Card>

            {/* Vendor */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Truck className="h-4 w-4" />
                  <span className="text-xs font-medium">Vendor</span>
                </div>
                <div className="text-sm font-semibold truncate">
                  {product.product.vendor?.name || "Unknown"}
                </div>
              </CardContent>
            </Card>

            {/* Category */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tags className="h-4 w-4" />
                  <span className="text-xs font-medium">Category</span>
                </div>
                <div className="text-sm font-semibold truncate">
                  {product.product.category || "Uncategorized"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sales data (4 months) */}
          {product.sales && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">
                    Sales (Last 4 Months)
                  </span>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1 p-3 rounded bg-muted/50 text-center">
                    <div className="text-2xl font-bold">
                      {product.sales.totalQtySold}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Units Sold
                    </div>
                  </div>
                  <div className="flex-1 p-3 rounded bg-muted/50 text-center">
                    <div className="text-2xl font-bold">
                      ${product.sales.totalRevenue.toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Revenue
                    </div>
                  </div>
                </div>
                {product.sales.periods.length > 0 && (
                  <div className="space-y-1">
                    {product.sales.periods.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-muted-foreground">
                          {new Date(p.start).toLocaleDateString(undefined, {
                            month: "short",
                          })}{" "}
                          -{" "}
                          {new Date(p.end).toLocaleDateString(undefined, {
                            month: "short",
                            year: "2-digit",
                          })}
                        </span>
                        <span className="font-mono">
                          {p.qtySold} sold / ${p.revenue.toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Actions
              </div>
              <div className="grid grid-cols-1 gap-2">
                {/* Edit Stock */}
                {product.product.id && !editingStock && (
                  <Button
                    variant="outline"
                    className="justify-start gap-3 w-full text-left"
                    style={{ minHeight: "48px" }}
                    onClick={() => {
                      setEditingStock(true);
                      setNewStock(
                        String(product.product.currentStock ?? 0)
                      );
                    }}
                  >
                    <PenSquare className="h-4 w-4" />
                    Edit Stock
                  </Button>
                )}

                {/* Inline stock edit form */}
                {editingStock && (
                  <div className="flex gap-2 items-center p-2 border rounded-lg">
                    <Input
                      type="number"
                      min={0}
                      value={newStock}
                      onChange={(e) => setNewStock(e.target.value)}
                      className="flex-1"
                      style={{ minHeight: "44px", fontSize: "16px" }}
                      autoFocus
                    />
                    <Button
                      onClick={handleSaveStock}
                      disabled={savingStock}
                      className="bg-green-600 hover:bg-green-700 text-white"
                      style={{ minHeight: "44px" }}
                    >
                      {savingStock ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingStock(false)}
                      className="h-11 w-11"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* View in Inventory */}
                {product.product.id && (
                  <Link href={`/inventory?search=${product.product.sku}`}>
                    <Button
                      variant="outline"
                      className="justify-start gap-3 w-full text-left"
                      style={{ minHeight: "48px" }}
                    >
                      <Eye className="h-4 w-4" />
                      View in Inventory
                    </Button>
                  </Link>
                )}

                {/* Add to PO */}
                <Link
                  href={`/po/new?addSku=${product.product.sku}${product.product.vendor?.id ? `&vendorId=${product.product.vendor.id}` : ""}`}
                >
                  <Button
                    variant="outline"
                    className="justify-start gap-3 w-full text-left"
                    style={{ minHeight: "48px" }}
                  >
                    <FileText className="h-4 w-4" />
                    Add to Purchase Order
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Scan Again */}
          <Button
            onClick={handleScanAgain}
            className="w-full gap-2 text-base"
            style={{ minHeight: "56px" }}
          >
            <RotateCcw className="h-5 w-5" />
            Scan Another Barcode
          </Button>
        </div>
      )}
    </div>
  );
}
