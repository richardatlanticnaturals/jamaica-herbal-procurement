"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Database,
  ArrowUpFromLine,
  Undo2,
  Loader2,
  Download,
} from "lucide-react";

// ============================================
// Inline Editable Cell — auto-saves on blur with debounce
// ============================================
function InlineEditableCell({
  value,
  itemId,
  field,
  type = "text",
  onSave,
  prefix = "",
  suffix = "",
  className = "",
  format,
}: {
  value: string | number | null;
  itemId: string;
  field: string;
  type?: "text" | "number" | "price";
  onSave: (itemId: string, field: string, value: string, oldValue: string) => void;
  prefix?: string;
  suffix?: string;
  className?: string;
  format?: (v: any) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = format
    ? format(value)
    : type === "price"
      ? `${prefix}${Number(value).toFixed(2)}`
      : `${prefix}${value ?? ""}${suffix}`;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const raw =
      type === "price" ? Number(value).toFixed(2) : String(value ?? "");
    setEditValue(raw);
    setEditing(true);
  };

  const commitEdit = () => {
    const oldRaw =
      type === "price" ? Number(value).toFixed(2) : String(value ?? "");
    if (editValue !== oldRaw) {
      onSave(itemId, field, editValue, oldRaw);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type === "text" ? "text" : "number"}
        step={type === "price" ? "0.01" : "1"}
        min={0}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        className="h-9 w-full min-w-[50px] rounded border border-primary bg-white px-2 text-base sm:text-sm outline-none focus:ring-1 focus:ring-primary"
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className={`cursor-pointer rounded px-1 py-0.5 hover:bg-muted transition-all ${
        flash ? "bg-green-100" : ""
      } ${className}`}
      title="Click to edit"
    >
      {displayValue}
    </span>
  );
}

// ============================================
// Inline Category Dropdown
// ============================================
function InlineCategoryCell({
  value,
  itemId,
  categories,
  onSave,
}: {
  value: string | null;
  itemId: string;
  categories: string[];
  onSave: (itemId: string, field: string, value: string, oldValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState(false);

  const handleChange = (newVal: string) => {
    const old = value || "";
    if (newVal !== old) {
      onSave(itemId, "category", newVal, old);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        value={value || ""}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setEditing(false)}
        className="h-7 rounded border border-primary bg-white px-1 text-xs outline-none min-w-[100px]"
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`cursor-pointer rounded px-1 py-0.5 hover:bg-muted transition-all text-sm ${
        flash ? "bg-green-100" : ""
      } ${!value ? "text-muted-foreground italic" : "text-muted-foreground"}`}
      title="Click to change category"
    >
      {value || "\u2014"}
    </span>
  );
}

// ============================================
// Undo history type
// ============================================
interface UndoEntry {
  itemId: string;
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
}

// ============================================
// Main Inventory Page
// ============================================
export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [vendorFilter, setVendorFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  // Edit dialog state (for full edit, kept as fallback)
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);

  // Edit form fields
  const [editCurrentStock, setEditCurrentStock] = useState(0);
  const [editReorderPoint, setEditReorderPoint] = useState(0);
  const [editReorderQty, setEditReorderQty] = useState(0);
  const [editCostPrice, setEditCostPrice] = useState("");
  const [editRetailPrice, setEditRetailPrice] = useState("");
  const [editVendorId, setEditVendorId] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // Stock refresh state
  const [stockRefreshing, setStockRefreshing] = useState(false);
  const [pushingToComcash, setPushingToComcash] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [lastStockSync, setLastStockSync] = useState<string | null>(null);

  // Inline edit: saving indicator + undo stack
  const [inlineSaving, setInlineSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<{ id: string; field: string; value: string }[]>([]);

  // ---- Data Loading ----

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (vendorFilter) params.set("vendorId", vendorFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (stockFilter) params.set("filter", stockFilter);
      const res = await fetch(`/api/inventory?${params}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error("Failed to load inventory:", err);
    } finally {
      setLoading(false);
    }
  }, [page, search, vendorFilter, categoryFilter, stockFilter]);

  const loadVendors = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      setVendors(data.vendors || []);
    } catch (err) {
      console.error("Failed to load vendors:", err);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const fetchLastStockSync = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const settings = await res.json();
        setLastStockSync(settings.lastStockSync || null);
      }
    } catch {
      // ignore
    }
  }, []);

  // Fast stock-only refresh from Comcash POS
  const handleRefreshStock = useCallback(async () => {
    setStockRefreshing(true);
    try {
      const res = await fetch("/api/comcash/refresh-stock", { method: "POST" });
      if (res.ok) {
        loadItems();
        fetchLastStockSync();
      }
    } catch (err) {
      console.error("Stock refresh failed:", err);
    } finally {
      setStockRefreshing(false);
    }
  }, [loadItems, fetchLastStockSync]);

  // Push stock levels to Comcash POS
  const handlePushToComcash = useCallback(async () => {
    setPushingToComcash(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/comcash/push-inventory", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setPushResult(`Pushed ${data.synced || 0} items to Comcash POS`);
      } else {
        setPushResult(`Error: ${data.error || "Failed to push"}`);
      }
    } catch {
      setPushResult("Failed to push to Comcash");
    } finally {
      setPushingToComcash(false);
      setTimeout(() => setPushResult(null), 5000);
    }
  }, []);

  useEffect(() => {
    loadVendors();
    fetchLastStockSync();
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.categories) {
          setCategories(
            data.categories.map((c: any) => c.name).filter(Boolean)
          );
        }
      })
      .catch(() => {});
  }, [loadVendors, fetchLastStockSync]);

  // ---- Search ----

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  // ---- CSV Upload ----

  const handleCsvUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setImportResult(null);
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/inventory/import", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          setImportResult(data.message);
          setPage(1);
          setSearch("");
          setSearchInput("");
          loadItems();
        } else {
          setImportResult(`Error: ${data.error}`);
        }
      } catch {
        setImportResult("Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [loadItems]
  );

  // ---- Inline Edit with debounced batch save ----

  const flushPendingUpdates = useCallback(async () => {
    const updates = [...pendingUpdatesRef.current];
    if (updates.length === 0) return;
    pendingUpdatesRef.current = [];
    setInlineSaving(true);

    try {
      await fetch("/api/inventory/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    } catch (err) {
      console.error("Batch update failed:", err);
    } finally {
      setInlineSaving(false);
    }
  }, []);

  const handleInlineEdit = useCallback(
    (itemId: string, field: string, newValue: string, oldValue: string) => {
      // Optimistic local update
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          const updated = { ...item };
          if (
            field === "currentStock" ||
            field === "reorderPoint" ||
            field === "reorderQty"
          ) {
            updated[field] = Number(newValue) || 0;
          } else if (field === "costPrice" || field === "retailPrice") {
            updated[field] = newValue;
          } else {
            updated[field] = newValue || null;
          }
          return updated;
        })
      );

      // Push to undo stack
      setUndoStack((prev) => [
        ...prev,
        { itemId, field, oldValue, newValue, timestamp: Date.now() },
      ]);

      // Queue the update
      pendingUpdatesRef.current.push({ id: itemId, field, value: newValue });

      // Debounce: flush after 500ms of inactivity
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushPendingUpdates, 500);
    },
    [flushPendingUpdates]
  );

  // ---- Undo ----

  const handleUndo = useCallback(() => {
    const lastChange = undoStack[undoStack.length - 1];
    if (!lastChange) return;

    // Remove from undo stack
    setUndoStack((prev) => prev.slice(0, -1));

    // Revert local state
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== lastChange.itemId) return item;
        const updated = { ...item };
        if (
          lastChange.field === "currentStock" ||
          lastChange.field === "reorderPoint" ||
          lastChange.field === "reorderQty"
        ) {
          updated[lastChange.field] = Number(lastChange.oldValue) || 0;
        } else if (
          lastChange.field === "costPrice" ||
          lastChange.field === "retailPrice"
        ) {
          updated[lastChange.field] = lastChange.oldValue;
        } else {
          updated[lastChange.field] = lastChange.oldValue || null;
        }
        return updated;
      })
    );

    // Send the revert to the server
    pendingUpdatesRef.current.push({
      id: lastChange.itemId,
      field: lastChange.field,
      value: lastChange.oldValue,
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushPendingUpdates, 300);
  }, [undoStack, flushPendingUpdates]);

  // Keyboard shortcut: Ctrl+Z for undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo]);

  // ---- Stock Badge ----

  const getStockBadge = (current: number, reorderPoint: number) => {
    if (current <= 0)
      return <Badge variant="destructive">Out of Stock</Badge>;
    if (current <= reorderPoint)
      return (
        <Badge className="bg-orange-500 text-white">Low Stock</Badge>
      );
    return <Badge className="bg-green-600 text-white">In Stock</Badge>;
  };

  // ---- Dialog Edit (full edit fallback) ----

  const openEditDialog = (item: any) => {
    setEditItem(item);
    setEditCurrentStock(item.currentStock);
    setEditReorderPoint(item.reorderPoint);
    setEditReorderQty(item.reorderQty);
    setEditCostPrice(Number(item.costPrice).toFixed(2));
    setEditRetailPrice(Number(item.retailPrice).toFixed(2));
    setEditVendorId(item.vendorId || "none");
    setEditCategory(item.category || "");
    setEditIsActive(item.isActive);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setDialogSaving(true);
    try {
      const res = await fetch(`/api/inventory/${editItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStock: editCurrentStock,
          reorderPoint: editReorderPoint,
          reorderQty: editReorderQty,
          costPrice: parseFloat(editCostPrice),
          retailPrice: parseFloat(editRetailPrice),
          vendorId: editVendorId === "none" ? null : editVendorId,
          category: editCategory || null,
          isActive: editIsActive,
        }),
      });
      if (res.ok) {
        setEditOpen(false);
        setEditItem(null);
        loadItems();
      } else {
        const data = await res.json();
        console.error("Save failed:", data.error);
      }
    } catch (err) {
      console.error("Failed to save item:", err);
    } finally {
      setDialogSaving(false);
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            {total > 0
              ? `${total} products in inventory`
              : "Manage your product inventory"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastStockSync && (
            <span className="text-xs text-muted-foreground">
              Stock synced:{" "}
              {(() => {
                const seconds = Math.floor(
                  (Date.now() - new Date(lastStockSync).getTime()) / 1000
                );
                if (seconds < 60) return "just now";
                const minutes = Math.floor(seconds / 60);
                if (minutes < 60) return `${minutes}m ago`;
                const hours = Math.floor(minutes / 60);
                if (hours < 24) return `${hours}h ago`;
                return `${Math.floor(hours / 24)}d ago`;
              })()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshStock}
            disabled={stockRefreshing}
            className="h-7"
          >
            <Database
              className={`h-3.5 w-3.5 mr-1 ${
                stockRefreshing ? "animate-spin" : ""
              }`}
            />
            {stockRefreshing ? "Syncing..." : "Refresh Stock"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePushToComcash}
            disabled={pushingToComcash}
            className="h-7"
          >
            <ArrowUpFromLine
              className={`h-3.5 w-3.5 mr-1 ${
                pushingToComcash ? "animate-spin" : ""
              }`}
            />
            {pushingToComcash ? "Pushing..." : "Push to Comcash"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => {
              window.open("/api/export?type=inventory", "_blank");
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export CSV
          </Button>
          <label className="cursor-pointer inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-primary text-primary-foreground text-sm font-medium h-7 gap-1 px-2.5 hover:bg-primary/80 transition-all">
            <Upload className="h-3.5 w-3.5 mr-1" />
            {uploading ? "Importing..." : "Import CSV"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsvUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Status Banners */}
      {importResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            importResult.startsWith("Error")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {importResult}
        </div>
      )}
      {pushResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            pushResult.startsWith("Error")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {pushResult}
        </div>
      )}

      {/* Inline saving indicator + undo */}
      {(inlineSaving || undoStack.length > 0) && (
        <div className="flex items-center gap-3">
          {inlineSaving && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving...
            </div>
          )}
          {undoStack.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUndo}
              className="h-7 gap-1 text-xs"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo ({undoStack.length})
            </Button>
          )}
        </div>
      )}

      {/* Search and Filters */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
          <Badge variant="secondary">{total} items</Badge>
        </form>

        {/* Filter Row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-base sm:text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[140px] sm:min-w-[160px]"
            >
              <option value="">All Categories</option>
              <option value="__uncategorized">Uncategorized</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Vendor
            </label>
            <select
              value={vendorFilter}
              onChange={(e) => {
                setVendorFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-base sm:text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[140px] sm:min-w-[160px]"
            >
              <option value="">All Vendors</option>
              {vendors.map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Stock Status
            </label>
            <select
              value={stockFilter}
              onChange={(e) => {
                setStockFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-base sm:text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[130px]"
            >
              <option value="">All Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="out-of-stock">Out of Stock</option>
            </select>
          </div>

          {(categoryFilter || vendorFilter || stockFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCategoryFilter("");
                setVendorFilter("");
                setStockFilter("");
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Inventory Table with Inline Editing */}
      <Card>
        <CardContent className="p-0">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              Loading inventory...
            </div>
          ) : total === 0 && !search ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">No inventory data</h3>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
                Import your Comcash inventory CSV to get started.
              </p>
              <label className="mt-4 cursor-pointer inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-primary text-primary-foreground text-sm font-medium h-7 gap-1 px-2.5 hover:bg-primary/80 transition-all">
                <Upload className="h-3.5 w-3.5 mr-1" />
                Import CSV
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-center">Reorder Pt</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className="group">
                      <TableCell className="font-mono text-xs">
                        {item.sku}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {item.name}
                      </TableCell>
                      <TableCell>
                        <InlineCategoryCell
                          value={item.category}
                          itemId={item.id}
                          categories={categories}
                          onSave={handleInlineEdit}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineEditableCell
                          value={item.costPrice}
                          itemId={item.id}
                          field="costPrice"
                          type="price"
                          prefix="$"
                          onSave={handleInlineEdit}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineEditableCell
                          value={item.retailPrice}
                          itemId={item.id}
                          field="retailPrice"
                          type="price"
                          prefix="$"
                          onSave={handleInlineEdit}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <InlineEditableCell
                          value={item.currentStock}
                          itemId={item.id}
                          field="currentStock"
                          type="number"
                          onSave={handleInlineEdit}
                          className="font-medium"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <InlineEditableCell
                          value={item.reorderPoint}
                          itemId={item.id}
                          field="reorderPoint"
                          type="number"
                          onSave={handleInlineEdit}
                        />
                      </TableCell>
                      <TableCell>
                        {getStockBadge(
                          item.currentStock,
                          item.reorderPoint
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => openEditDialog(item)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Full edit"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Full Edit Item Dialog (fallback for vendor assignment, active toggle, etc.) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              {editItem?.name} ({editItem?.sku})
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-currentStock">Current Stock</Label>
              <Input
                id="edit-currentStock"
                type="number"
                min={0}
                value={editCurrentStock}
                onChange={(e) => setEditCurrentStock(Number(e.target.value))}
                className="text-base sm:text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-reorderPoint">Reorder Point</Label>
                <Input
                  id="edit-reorderPoint"
                  type="number"
                  min={0}
                  value={editReorderPoint}
                  onChange={(e) =>
                    setEditReorderPoint(Number(e.target.value))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-reorderQty">Reorder Qty</Label>
                <Input
                  id="edit-reorderQty"
                  type="number"
                  min={0}
                  value={editReorderQty}
                  onChange={(e) =>
                    setEditReorderQty(Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-costPrice">Cost Price ($)</Label>
                <Input
                  id="edit-costPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editCostPrice}
                  onChange={(e) => setEditCostPrice(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-retailPrice">Retail Price ($)</Label>
                <Input
                  id="edit-retailPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editRetailPrice}
                  onChange={(e) => setEditRetailPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Vendor</Label>
              <select
                value={editVendorId}
                onChange={(e) => setEditVendorId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="none">No vendor</option>
                {vendors.map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="edit-isActive" className="cursor-pointer">
                Active
              </Label>
              <button
                id="edit-isActive"
                type="button"
                role="switch"
                aria-checked={editIsActive}
                onClick={() => setEditIsActive(!editIsActive)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                  editIsActive ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    editIsActive ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm text-muted-foreground">
                {editIsActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={dialogSaving}
              onClick={handleSaveEdit}
            >
              {dialogSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
