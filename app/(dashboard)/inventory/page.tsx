"use client";

import { useState, useCallback, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Search, ChevronLeft, ChevronRight, Pencil, Database } from "lucide-react";

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

  // Edit dialog state
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);

  // Stock refresh state
  const [stockRefreshing, setStockRefreshing] = useState(false);
  const [lastStockSync, setLastStockSync] = useState<string | null>(null);

  // Edit form fields
  const [editReorderPoint, setEditReorderPoint] = useState(0);
  const [editReorderQty, setEditReorderQty] = useState(0);
  const [editCostPrice, setEditCostPrice] = useState("");
  const [editRetailPrice, setEditRetailPrice] = useState("");
  const [editVendorId, setEditVendorId] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

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

  // Load vendors once for the dropdown
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

  // Fetch last stock sync timestamp
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

  useEffect(() => {
    loadVendors();
    fetchLastStockSync();
    // Load distinct categories
    fetch("/api/categories").then(r => r.json()).then(data => {
      if (data.categories) {
        setCategories(data.categories.map((c: any) => c.name).filter(Boolean));
      }
    }).catch(() => {});
  }, [loadVendors, fetchLastStockSync]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      } else {
        setImportResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setImportResult("Upload failed");
    } finally {
      setUploading(false);
    }
  }, [loadItems]);

  const getStockBadge = (current: number, reorderPoint: number) => {
    if (current <= 0) return <Badge variant="destructive">Out of Stock</Badge>;
    if (current <= reorderPoint) return <Badge className="bg-orange-500 text-white">Low Stock</Badge>;
    return <Badge className="bg-green-600 text-white">In Stock</Badge>;
  };

  // Open edit dialog and populate form fields from item
  const openEditDialog = (item: any) => {
    setEditItem(item);
    setEditReorderPoint(item.reorderPoint);
    setEditReorderQty(item.reorderQty);
    setEditCostPrice(Number(item.costPrice).toFixed(2));
    setEditRetailPrice(Number(item.retailPrice).toFixed(2));
    setEditVendorId(item.vendorId || "none");
    setEditCategory(item.category || "");
    setEditIsActive(item.isActive);
    setEditOpen(true);
  };

  // Save edited item via PUT /api/inventory/[id]
  const handleSaveEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${editItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        // Refresh data
        loadItems();
      } else {
        const data = await res.json();
        console.error("Save failed:", data.error);
      }
    } catch (err) {
      console.error("Failed to save item:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            {total > 0 ? `${total} products in inventory` : "Manage your product inventory"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastStockSync && (
            <span className="text-xs text-muted-foreground">
              Stock synced: {(() => {
                const seconds = Math.floor((Date.now() - new Date(lastStockSync).getTime()) / 1000);
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
            <Database className={`h-3.5 w-3.5 mr-1 ${stockRefreshing ? "animate-spin" : ""}`} />
            {stockRefreshing ? "Syncing..." : "Refresh Stock"}
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

      {importResult && (
        <div className={`rounded-lg px-4 py-3 text-sm ${importResult.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {importResult}
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
          <Button type="submit" variant="outline" size="sm">Search</Button>
          <Badge variant="secondary">{total} items</Badge>
        </form>

        {/* Filter Row */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Category Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[160px]"
            >
              <option value="">All Categories</option>
              <option value="__uncategorized">Uncategorized</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Vendor Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Vendor</label>
            <select
              value={vendorFilter}
              onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[160px]"
            >
              <option value="">All Vendors</option>
              {vendors.map((v: any) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Stock Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Stock Status</label>
            <select
              value={stockFilter}
              onChange={(e) => { setStockFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-w-[130px]"
            >
              <option value="">All Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="out-of-stock">Out of Stock</option>
            </select>
          </div>

          {/* Clear Filters */}
          {(categoryFilter || vendorFilter || stockFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setCategoryFilter(""); setVendorFilter(""); setStockFilter(""); setPage(1); }}
            >
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Inventory Table */}
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
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openEditDialog(item)}
                    >
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {item.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.category || "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        ${Number(item.costPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${Number(item.retailPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {item.currentStock}
                      </TableCell>
                      <TableCell className="text-center">{item.reorderPoint}</TableCell>
                      <TableCell>
                        {getStockBadge(item.currentStock, item.reorderPoint)}
                      </TableCell>
                      <TableCell>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

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

      {/* Edit Item Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              {editItem?.name} ({editItem?.sku})
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-reorderPoint">Reorder Point</Label>
                <Input
                  id="edit-reorderPoint"
                  type="number"
                  min={0}
                  value={editReorderPoint}
                  onChange={(e) => setEditReorderPoint(Number(e.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-reorderQty">Reorder Qty</Label>
                <Input
                  id="edit-reorderQty"
                  type="number"
                  min={0}
                  value={editReorderQty}
                  onChange={(e) => setEditReorderQty(Number(e.target.value))}
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
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Vendor</Label>
              <Select value={editVendorId} onValueChange={(v) => setEditVendorId(v || "none")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No vendor</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="edit-isActive" className="cursor-pointer">Active</Label>
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
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={handleSaveEdit}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
