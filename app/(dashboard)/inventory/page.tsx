"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Search, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

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

  const loadItems = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "50" });
      if (s) params.set("search", s);
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
  }, []);

  useEffect(() => {
    loadItems(page, search);
  }, [page, search, loadItems]);

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
        loadItems(1, "");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            {total > 0 ? `${total} products in inventory` : "Manage your product inventory"}
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* Search */}
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {item.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.category || "—"}
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
    </div>
  );
}
