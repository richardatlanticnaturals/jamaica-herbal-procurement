"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tags,
  Search,
  RefreshCw,
  Pencil,
  Check,
  X,
  Package,
  ArrowLeft,
  FolderOpen,
  Download,
} from "lucide-react";

interface CategoryInfo {
  name: string;
  itemCount: number;
  isUncategorized: boolean;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  currentStock: number;
  costPrice: string;
  retailPrice: string;
  vendor?: { id: string; name: string } | null;
}

export default function CategoriesPage() {
  // --- State ---
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Category detail view
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  // Inline rename
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Reassign item dialog
  const [reassignItem, setReassignItem] = useState<InventoryItem | null>(null);
  const [reassignTarget, setReassignTarget] = useState("");
  const [reassigning, setReassigning] = useState(false);

  // --- Data loading ---
  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/categories");
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error("Failed to load categories:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategoryItems = useCallback(async (categoryName: string) => {
    try {
      setLoadingItems(true);
      const res = await fetch(
        `/api/categories/${encodeURIComponent(categoryName)}`
      );
      const data = await res.json();
      setCategoryItems(data.items || []);
    } catch (err) {
      console.error("Failed to load category items:", err);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (selectedCategory) {
      loadCategoryItems(selectedCategory);
    }
  }, [selectedCategory, loadCategoryItems]);

  // --- Actions ---
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/comcash/sync-categories", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setSyncResult(data.message);
        await loadCategories();
        if (selectedCategory) {
          await loadCategoryItems(selectedCategory);
        }
      } else {
        setSyncResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setSyncResult("Sync failed. Check console for details.");
      console.error("Category sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleRename = async (oldName: string) => {
    if (!editValue.trim() || editValue.trim() === oldName) {
      setEditingCategory(null);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(
        `/api/categories/${encodeURIComponent(oldName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: editValue.trim() }),
        }
      );
      const data = await res.json();
      if (data.success) {
        setEditingCategory(null);
        await loadCategories();
        // If we were viewing the renamed category, update the selection
        if (selectedCategory === oldName) {
          setSelectedCategory(editValue.trim());
        }
      }
    } catch (err) {
      console.error("Failed to rename category:", err);
    } finally {
      setRenaming(false);
    }
  };

  const handleReassignItem = async () => {
    if (!reassignItem || !reassignTarget) return;
    setReassigning(true);
    try {
      // Update a single item's category via the inventory API
      const res = await fetch(`/api/inventory/${reassignItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: reassignTarget === "__uncategorized__" ? null : reassignTarget }),
      });
      if (res.ok) {
        setReassignItem(null);
        setReassignTarget("");
        await loadCategories();
        if (selectedCategory) {
          await loadCategoryItems(selectedCategory);
        }
      }
    } catch (err) {
      console.error("Failed to reassign item:", err);
    } finally {
      setReassigning(false);
    }
  };

  // --- Filtering ---
  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredItems = categoryItems.filter(
    (item) =>
      item.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
      item.sku.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const totalItems = categories.reduce((sum, c) => sum + c.itemCount, 0);

  // --- Render: Category detail view ---
  if (selectedCategory) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedCategory(null);
              setCategoryItems([]);
              setItemSearch("");
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {selectedCategory}
            </h1>
            <p className="text-muted-foreground text-sm">
              {categoryItems.length} items in this category
            </p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items by name or SKU..."
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Items table */}
        <Card>
          <CardContent className="p-0">
            {loadingItems ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading items...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No items found.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Retail</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {item.sku}
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.vendor?.name || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.currentStock}
                      </TableCell>
                      <TableCell className="text-right">
                        ${Number(item.costPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${Number(item.retailPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReassignItem(item);
                            setReassignTarget("");
                          }}
                        >
                          Move
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reassign dialog */}
        <Dialog
          open={!!reassignItem}
          onOpenChange={(open) => {
            if (!open) {
              setReassignItem(null);
              setReassignTarget("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move Item to Another Category</DialogTitle>
              <DialogDescription>
                Reassign &quot;{reassignItem?.name}&quot; to a different
                category.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Target Category</Label>
                <Select
                  value={reassignTarget}
                  onValueChange={(val) => setReassignTarget(val ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__uncategorized__">
                      Uncategorized
                    </SelectItem>
                    {categories
                      .filter(
                        (c) =>
                          !c.isUncategorized && c.name !== selectedCategory
                      )
                      .map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.name} ({c.itemCount})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setReassignItem(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleReassignItem}
                disabled={!reassignTarget || reassigning}
              >
                {reassigning ? "Moving..." : "Move Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // --- Render: Category list view ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-muted-foreground text-sm">
            {categories.length} categories, {totalItems} total items
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.open("/api/export?type=categories", "_blank");
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync from Comcash"}
          </Button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <Card
          className={
            syncResult.startsWith("Error")
              ? "border-red-200 bg-red-50"
              : "border-green-200 bg-green-50"
          }
        >
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <p className="text-sm">{syncResult}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSyncResult(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Categories grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-5 w-32 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-4 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredCategories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No categories found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click &quot;Sync from Comcash&quot; to import categories from your
              POS system.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCategories.map((cat) => (
            <Card
              key={cat.name}
              className="cursor-pointer hover:shadow-md transition-shadow"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  {editingCategory === cat.name ? (
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(cat.name);
                          if (e.key === "Escape") setEditingCategory(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleRename(cat.name)}
                        disabled={renaming}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditingCategory(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CardTitle
                        className="text-base leading-tight"
                        onClick={() => setSelectedCategory(cat.name)}
                      >
                        <span className="flex items-center gap-2">
                          {cat.isUncategorized ? (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Tags className="h-4 w-4 text-muted-foreground" />
                          )}
                          {cat.name}
                        </span>
                      </CardTitle>
                      {!cat.isUncategorized && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategory(cat.name);
                            setEditValue(cat.name);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent onClick={() => setSelectedCategory(cat.name)}>
                <Badge variant="secondary">
                  {cat.itemCount} {cat.itemCount === 1 ? "item" : "items"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
