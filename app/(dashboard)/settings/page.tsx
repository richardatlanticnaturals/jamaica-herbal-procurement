"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  Database,
  Mail,
  ShoppingBag,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  Sparkles,
  Package,
  Upload,
  ArrowDownToLine,
  BarChart3,
  Zap,
  Store,
} from "lucide-react";

interface AppSettings {
  id: string;
  poNumberPrefix: string;
  defaultLeadTimeDays: number;
  defaultReorderPoint: number;
  defaultReorderQty: number;
  autoGeneratePOs: boolean;
  autoSendPOs: boolean;
  poApprovalRequired: boolean;
  syncIntervalMinutes: number;
  lastInventorySync: string | null;
  lastVendorSync: string | null;
  lastProductSync: string | null;
  comcashApiKeySet: boolean;
  anthropicApiKeySet: boolean;
  comcashApiUrl: string | null;
}

interface SyncResult {
  success: boolean;
  message: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Comcash sync states
  const [syncingVendors, setSyncingVendors] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [pushingInventory, setPushingInventory] = useState(false);
  const [vendorSyncResult, setVendorSyncResult] = useState<SyncResult | null>(
    null
  );
  const [productSyncResult, setProductSyncResult] =
    useState<SyncResult | null>(null);
  const [pushResult, setPushResult] = useState<SyncResult | null>(null);

  // Sales sync states
  const [syncingSales, setSyncingSales] = useState(false);
  const [salesSyncResult, setSalesSyncResult] = useState<SyncResult | null>(null);

  // Auto-tune reorder points states
  const [autoTuning, setAutoTuning] = useState(false);
  const [autoTuneResult, setAutoTuneResult] = useState<any>(null);
  const [applyingAutoTune, setApplyingAutoTune] = useState(false);

  // Shopify order sync states
  const [syncingShopifyOrders, setSyncingShopifyOrders] = useState(false);
  const [shopifyOrderResult, setShopifyOrderResult] = useState<SyncResult | null>(null);

  // Editable fields
  const [poPrefix, setPoPrefix] = useState("PO");
  const [leadTime, setLeadTime] = useState("3");
  const [reorderPoint, setReorderPoint] = useState("5");
  const [reorderQty, setReorderQty] = useState("12");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      const data: AppSettings = await res.json();
      setSettings(data);
      setPoPrefix(data.poNumberPrefix || "PO");
      setLeadTime(String(data.defaultLeadTimeDays || 3));
      setReorderPoint(String(data.defaultReorderPoint || 5));
      setReorderQty(String(data.defaultReorderQty || 12));
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNumberPrefix: poPrefix,
          defaultLeadTimeDays: parseInt(leadTime, 10) || 3,
          defaultReorderPoint: parseInt(reorderPoint, 10) || 5,
          defaultReorderQty: parseInt(reorderQty, 10) || 12,
        }),
      });
      if (res.ok) {
        setSaveMessage("Settings saved successfully");
        await loadSettings();
      } else {
        setSaveMessage("Failed to save settings");
      }
    } catch {
      setSaveMessage("Failed to save settings");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  // --- Comcash Sync Handlers ---

  const handleSyncVendors = async () => {
    setSyncingVendors(true);
    setVendorSyncResult(null);
    try {
      const res = await fetch("/api/comcash/sync-vendors", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setVendorSyncResult({
          success: true,
          message: `Synced ${data.synced || data.total || 0} vendors (${data.created} new, ${data.updated} updated, ${data.skipped} skipped)`,
        });
        await loadSettings();
      } else {
        setVendorSyncResult({
          success: false,
          message: data.error || "Vendor sync failed",
        });
      }
    } catch (err) {
      setVendorSyncResult({
        success: false,
        message: err instanceof Error ? err.message : "Vendor sync failed",
      });
    } finally {
      setSyncingVendors(false);
    }
  };

  const handleSyncProducts = async () => {
    setSyncingProducts(true);
    setProductSyncResult(null);
    try {
      const res = await fetch("/api/comcash/sync-products", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setProductSyncResult({
          success: true,
          message: data.message || `Synced ${data.total} products`,
        });
        await loadSettings();
      } else {
        setProductSyncResult({
          success: false,
          message: data.error || "Product sync failed",
        });
      }
    } catch (err) {
      setProductSyncResult({
        success: false,
        message: err instanceof Error ? err.message : "Product sync failed",
      });
    } finally {
      setSyncingProducts(false);
    }
  };

  const handlePushInventory = async () => {
    setPushingInventory(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/comcash/push-inventory", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setPushResult({
          success: true,
          message:
            data.message ||
            `Pushed ${data.updated} items to Comcash`,
        });
        await loadSettings();
      } else {
        setPushResult({
          success: false,
          message: data.error || "Push failed",
        });
      }
    } catch (err) {
      setPushResult({
        success: false,
        message: err instanceof Error ? err.message : "Push failed",
      });
    } finally {
      setPushingInventory(false);
    }
  };

  const handleSyncSales = async () => {
    setSyncingSales(true);
    setSalesSyncResult(null);
    try {
      const res = await fetch("/api/comcash/sync-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: 4 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSalesSyncResult({
          success: true,
          message: data.message || `Synced ${data.upserted} products from ${data.totalSalesProcessed} sales`,
        });
      } else {
        setSalesSyncResult({
          success: false,
          message: data.error || "Sales sync failed",
        });
      }
    } catch (err) {
      setSalesSyncResult({
        success: false,
        message: err instanceof Error ? err.message : "Sales sync failed",
      });
    } finally {
      setSyncingSales(false);
    }
  };

  // --- Auto-Tune Reorder Points ---
  const handleAutoTunePreview = async () => {
    setAutoTuning(true);
    setAutoTuneResult(null);
    try {
      const res = await fetch("/api/inventory/auto-tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoTuneResult(data);
      } else {
        setAutoTuneResult({ error: data.error || "Auto-tune failed" });
      }
    } catch (err) {
      setAutoTuneResult({
        error: err instanceof Error ? err.message : "Auto-tune failed",
      });
    } finally {
      setAutoTuning(false);
    }
  };

  const handleAutoTuneApply = async () => {
    setApplyingAutoTune(true);
    try {
      const res = await fetch("/api/inventory/auto-tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoTuneResult({
          ...data,
          applied: true,
          _message: `Applied ${data.appliedCount} reorder point changes`,
        });
      } else {
        setAutoTuneResult({ error: data.error || "Apply failed" });
      }
    } catch (err) {
      setAutoTuneResult({
        error: err instanceof Error ? err.message : "Apply failed",
      });
    } finally {
      setApplyingAutoTune(false);
    }
  };

  // --- Shopify Order Sync ---
  const handleSyncShopifyOrders = async () => {
    setSyncingShopifyOrders(true);
    setShopifyOrderResult(null);
    try {
      const res = await fetch("/api/shopify/sync-orders", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setShopifyOrderResult({
          success: true,
          message: data.message || `Synced ${data.ordersProcessed} orders, updated ${data.itemsUpdated} items`,
        });
      } else {
        setShopifyOrderResult({
          success: false,
          message: data.error || "Shopify order sync failed",
        });
      }
    } catch (err) {
      setShopifyOrderResult({
        success: false,
        message: err instanceof Error ? err.message : "Shopify order sync failed",
      });
    } finally {
      setSyncingShopifyOrders(false);
    }
  };

  // Helper to render sync result alerts
  const renderSyncAlert = (result: SyncResult | null) => {
    if (!result) return null;
    return (
      <div
        className={`rounded-md p-3 text-sm ${
          result.success
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}
      >
        {result.success ? (
          <CheckCircle className="inline-block h-4 w-4 mr-2" />
        ) : (
          <XCircle className="inline-block h-4 w-4 mr-2" />
        )}
        {result.message}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure integrations and preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* --- Comcash POS Integration --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              <CardTitle>Comcash POS</CardTitle>
            </div>
            <CardDescription>
              Sync vendors, products, and inventory with your Comcash POS system
              via the Employee API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Connection Status */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Employee API Connection
                </Label>
                <div className="flex items-center gap-2">
                  {settings?.comcashApiKeySet ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">
                        Connected
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium text-red-600">
                        Not connected
                      </span>
                    </>
                  )}
                  {settings?.comcashApiUrl && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({settings.comcashApiUrl})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Sync Vendors */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Last Vendor Sync
                </Label>
                <p className="text-sm">
                  {settings?.lastVendorSync
                    ? new Date(settings.lastVendorSync).toLocaleString()
                    : "Never synced"}
                </p>
              </div>
              <Button
                onClick={handleSyncVendors}
                disabled={syncingVendors || !settings?.comcashApiKeySet}
                size="sm"
                variant="outline"
              >
                {syncingVendors ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Vendors
                  </>
                )}
              </Button>
            </div>
            {renderSyncAlert(vendorSyncResult)}

            {/* Sync Products */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Last Product Sync
                </Label>
                <p className="text-sm">
                  {settings?.lastProductSync
                    ? new Date(settings.lastProductSync).toLocaleString()
                    : "Never synced"}
                </p>
              </div>
              <Button
                onClick={handleSyncProducts}
                disabled={syncingProducts || !settings?.comcashApiKeySet}
                size="sm"
                variant="outline"
              >
                {syncingProducts ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    Sync Products
                  </>
                )}
              </Button>
            </div>
            {renderSyncAlert(productSyncResult)}

            {/* Push Inventory */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Last Inventory Push
                </Label>
                <p className="text-sm">
                  {settings?.lastInventorySync
                    ? new Date(settings.lastInventorySync).toLocaleString()
                    : "Never pushed"}
                </p>
              </div>
              <Button
                onClick={handlePushInventory}
                disabled={pushingInventory || !settings?.comcashApiKeySet}
                size="sm"
                variant="outline"
              >
                {pushingInventory ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Push Inventory
                  </>
                )}
              </Button>
            </div>
            {renderSyncAlert(pushResult)}

            {/* Sync Sales Data */}
            <div className="flex items-center gap-4 pt-3 border-t">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Sales Data Cache
                </Label>
                <p className="text-sm">
                  Aggregates 4 months of sales by product for fast slow-mover and top-seller queries
                </p>
              </div>
              <Button
                onClick={handleSyncSales}
                disabled={syncingSales || !settings?.comcashApiKeySet}
                size="sm"
                variant="outline"
              >
                {syncingSales ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing Sales...
                  </>
                ) : (
                  <>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Sync Sales Data
                  </>
                )}
              </Button>
            </div>
            {renderSyncAlert(salesSyncResult)}
          </CardContent>
        </Card>

        {/* --- PO Settings --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              <CardTitle>Purchase Order Settings</CardTitle>
            </div>
            <CardDescription>
              Configure PO numbering and default values
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="poPrefix">PO Number Prefix</Label>
                <Input
                  id="poPrefix"
                  value={poPrefix}
                  onChange={(e) => setPoPrefix(e.target.value)}
                  placeholder="PO"
                />
                <p className="text-xs text-muted-foreground">
                  Prefix used when generating PO numbers (e.g., PO-00042)
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="leadTime">Default Lead Time (days)</Label>
                <Input
                  id="leadTime"
                  type="number"
                  min="1"
                  max="90"
                  value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Default lead time for new vendors
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* --- Reorder Settings --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <CardTitle>Reorder Settings</CardTitle>
            </div>
            <CardDescription>
              Default thresholds for automatic reorder suggestions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="reorderPoint">Default Reorder Point</Label>
                <Input
                  id="reorderPoint"
                  type="number"
                  min="0"
                  value={reorderPoint}
                  onChange={(e) => setReorderPoint(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stock level that triggers a reorder alert
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reorderQty">Default Reorder Quantity</Label>
                <Input
                  id="reorderQty"
                  type="number"
                  min="1"
                  value={reorderQty}
                  onChange={(e) => setReorderQty(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Default quantity to order when restocking
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Settings
                  </>
                )}
              </Button>
              {saveMessage && (
                <span
                  className={`text-sm ${
                    saveMessage.includes("success")
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {saveMessage}
                </span>
              )}
            </div>

            {/* Auto-Tune Section */}
            <div className="pt-4 border-t space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Auto-Tune Reorder Points</Label>
                  <p className="text-xs text-muted-foreground">
                    Calculate optimal reorder points based on 90-day sales velocity and vendor lead times (1.25x safety factor)
                  </p>
                </div>
                <Button
                  onClick={handleAutoTunePreview}
                  disabled={autoTuning}
                  size="sm"
                  variant="outline"
                >
                  {autoTuning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4" />
                      Preview Changes
                    </>
                  )}
                </Button>
              </div>

              {autoTuneResult && !autoTuneResult.error && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {autoTuneResult.itemsWithChanges} items would change
                      <span className="text-muted-foreground font-normal ml-1">
                        (of {autoTuneResult.totalItemsAnalyzed} analyzed)
                      </span>
                    </span>
                    {autoTuneResult.applied ? (
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Applied {autoTuneResult.appliedCount} changes
                      </Badge>
                    ) : (
                      <Button
                        onClick={handleAutoTuneApply}
                        disabled={applyingAutoTune || autoTuneResult.itemsWithChanges === 0}
                        size="sm"
                      >
                        {applyingAutoTune ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Apply Changes
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {autoTuneResult.preview && autoTuneResult.preview.length > 0 && (
                    <div className="max-h-48 overflow-y-auto text-xs">
                      <table className="w-full">
                        <thead>
                          <tr className="text-muted-foreground border-b">
                            <th className="text-left py-1">Item</th>
                            <th className="text-right py-1">Current</th>
                            <th className="text-right py-1">Suggested</th>
                            <th className="text-right py-1">Avg/Day</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoTuneResult.preview.slice(0, 20).map((p: any) => (
                            <tr key={p.itemId} className="border-b border-muted/50">
                              <td className="py-1 truncate max-w-[200px]">{p.name}</td>
                              <td className="text-right py-1">{p.currentReorderPoint}</td>
                              <td className="text-right py-1 font-medium">{p.suggestedReorderPoint}</td>
                              <td className="text-right py-1">{p.avgDailySales}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {autoTuneResult.preview.length > 20 && (
                        <p className="text-muted-foreground mt-1">
                          ...and {autoTuneResult.preview.length - 20} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {autoTuneResult?.error && (
                <div className="rounded-md p-3 text-sm bg-red-50 text-red-700 border border-red-200">
                  <XCircle className="inline-block h-4 w-4 mr-2" />
                  {autoTuneResult.error}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* --- Shopify Integration --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              <CardTitle>Shopify Integration</CardTitle>
            </div>
            <CardDescription>
              Sync orders from Shopify to deduct sold quantities from inventory
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Sync Shopify Orders
                </Label>
                <p className="text-sm">
                  Pulls recent paid orders and deducts sold quantities by SKU match
                </p>
              </div>
              <Button
                onClick={handleSyncShopifyOrders}
                disabled={syncingShopifyOrders}
                size="sm"
                variant="outline"
              >
                {syncingShopifyOrders ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    Sync Shopify Orders
                  </>
                )}
              </Button>
            </div>
            {renderSyncAlert(shopifyOrderResult)}
          </CardContent>
        </Card>

        {/* --- API Keys --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <CardTitle>API Integrations</CardTitle>
            </div>
            <CardDescription>
              Status of external API connections
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Anthropic (Claude AI)</p>
                <p className="text-xs text-muted-foreground">
                  Powers OOS alternative suggestions
                </p>
              </div>
              {settings?.anthropicApiKeySet ? (
                <Badge className="bg-green-100 text-green-700">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" />
                  Not set
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Comcash POS</p>
                <p className="text-xs text-muted-foreground">
                  Employee API - vendor, product, and inventory sync
                </p>
              </div>
              {settings?.comcashApiKeySet ? (
                <Badge className="bg-green-100 text-green-700">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" />
                  Not set
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Gmail</p>
                <p className="text-xs text-muted-foreground">
                  Send POs and read vendor replies
                </p>
              </div>
              <Badge variant="secondary">
                <Mail className="mr-1 h-3 w-3" />
                Configured
              </Badge>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Shopify</p>
                <p className="text-xs text-muted-foreground">
                  Inventory level sync
                </p>
              </div>
              <Badge variant="secondary">
                <ShoppingBag className="mr-1 h-3 w-3" />
                Pre-configured
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground pt-2 border-t">
              API keys are managed through environment variables. Contact your
              administrator to update them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
