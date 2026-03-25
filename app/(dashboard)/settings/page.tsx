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
  comcashApiKeySet: boolean;
  anthropicApiKeySet: boolean;
  comcashApiUrl: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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

  const handleSyncVendors = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/comcash/sync-vendors", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({
          success: true,
          message: `Synced ${data.synced} vendors (${data.created} new, ${data.updated} updated, ${data.skipped} skipped)`,
        });
        await loadSettings();
      } else {
        setSyncResult({
          success: false,
          message: data.error || "Sync failed",
        });
      }
    } catch (err) {
      setSyncResult({
        success: false,
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setSyncing(false);
    }
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
        {/* ─── Comcash POS ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              <CardTitle>Comcash POS</CardTitle>
            </div>
            <CardDescription>
              Sync vendors and inventory from your Comcash POS system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  API Connection
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
                disabled={syncing || !settings?.comcashApiKeySet}
                size="sm"
              >
                {syncing ? (
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

            {syncResult && (
              <div
                className={`rounded-md p-3 text-sm ${
                  syncResult.success
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {syncResult.success ? (
                  <CheckCircle className="inline-block h-4 w-4 mr-2" />
                ) : (
                  <XCircle className="inline-block h-4 w-4 mr-2" />
                )}
                {syncResult.message}
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Last Inventory Sync
                </Label>
                <p className="text-sm">
                  {settings?.lastInventorySync
                    ? new Date(settings.lastInventorySync).toLocaleString()
                    : "Never synced"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── PO Settings ────────────────────────────────────────────── */}
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

        {/* ─── Reorder Settings ───────────────────────────────────────── */}
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
          </CardContent>
        </Card>

        {/* ─── API Keys ───────────────────────────────────────────────── */}
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
                  Vendor and inventory sync
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
