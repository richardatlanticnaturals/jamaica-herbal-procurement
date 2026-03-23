"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Upload, Search, RefreshCw } from "lucide-react";

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.items) {
        setItems(data.items);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, []);

  const getStockBadge = (current: number, reorderPoint: number) => {
    if (current <= 0) return <Badge variant="destructive">Out of Stock</Badge>;
    if (current <= reorderPoint) return <Badge className="bg-orange-500">Low Stock</Badge>;
    return <Badge className="bg-green-600">In Stock</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Manage your product inventory and stock levels
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync Comcash
          </Button>
          <label className="cursor-pointer inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-primary text-primary-foreground text-sm font-medium h-7 gap-1 px-2.5 hover:bg-primary/80 transition-all">
            <Upload className="h-3.5 w-3.5 mr-1" />
            {uploading ? "Uploading..." : "Import CSV"}
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

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{items.length} items</Badge>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">No inventory data</h3>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
                Import your Comcash inventory CSV to get started. You can also add items manually.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-center">Stock (LL)</TableHead>
                  <TableHead className="text-center">Stock (NL)</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">Reorder Pt</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items
                  .filter(
                    (item) =>
                      !search ||
                      item.name?.toLowerCase().includes(search.toLowerCase()) ||
                      item.sku?.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.vendor?.name || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        ${Number(item.costPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">{item.locationLL}</TableCell>
                      <TableCell className="text-center">{item.locationNL}</TableCell>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
