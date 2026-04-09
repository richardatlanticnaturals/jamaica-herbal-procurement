"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  ShoppingCart,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// --- Types ---

interface Vendor {
  id: string;
  name: string;
  email: string | null;
  orderMethod: string;
  _count: { items: number; purchaseOrders: number };
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  costPrice: number | string;
  vendorId: string | null;
  vendorSku: string | null;
  unitOfMeasure: string;
}

interface LineItem {
  inventoryItemId: string;
  sku: string;
  name: string;
  vendorSku: string | null;
  description: string;
  qtyOrdered: number;
  unitCost: number;
  unitOfMeasure: string;
}

// --- Component ---

export default function NewPurchaseOrderPage() {
  const router = useRouter();

  // Step tracking
  const [step, setStep] = useState<1 | 2>(1);

  // Vendor selection
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [selectedVendorId, setSelectedVendorId] = useState("");

  // Item search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);

  // PO line items
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Load vendors on mount ---
  useEffect(() => {
    const loadVendors = async () => {
      try {
        const res = await fetch("/api/vendors");
        const data = await res.json();
        setVendors(data.vendors || []);
      } catch {
        console.error("Failed to load vendors");
      } finally {
        setVendorsLoading(false);
      }
    };
    loadVendors();
  }, []);

  // --- Debounced inventory search ---
  const searchItems = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams({ q });
        if (selectedVendorId) {
          params.set("vendorId", selectedVendorId);
        }
        const res = await fetch(`/api/inventory/search?${params}`);
        const data = await res.json();
        setSearchResults(data.items || []);
      } catch {
        console.error("Search failed");
      } finally {
        setSearching(false);
      }
    },
    [selectedVendorId]
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => searchItems(value), 300);
    setSearchTimer(timer);
  };

  // --- Add item to PO ---
  const addItem = (item: InventoryItem) => {
    // Prevent duplicates
    if (lineItems.some((li) => li.inventoryItemId === item.id)) return;

    setLineItems((prev) => [
      ...prev,
      {
        inventoryItemId: item.id,
        sku: item.sku,
        name: item.name,
        vendorSku: item.vendorSku,
        description: item.name,
        qtyOrdered: 1,
        unitCost: Number(item.costPrice) || 0,
        unitOfMeasure: item.unitOfMeasure,
      },
    ]);
  };

  // --- Update line item fields ---
  const updateLineItem = (
    index: number,
    field: "qtyOrdered" | "unitCost",
    value: number
  ) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  // --- Remove line item ---
  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Calculate subtotal ---
  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.qtyOrdered * item.unitCost,
    0
  );

  // --- Submit PO ---
  const handleSubmit = async () => {
    if (!selectedVendorId || lineItems.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: selectedVendorId,
          lineItems: lineItems.map((li) => ({
            inventoryItemId: li.inventoryItemId,
            vendorSku: li.vendorSku,
            description: li.description,
            qtyOrdered: li.qtyOrdered,
            unitCost: li.unitCost,
          })),
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create PO");
      }

      const data = await res.json();
      // Redirect to the new PO detail page
      router.push(`/po/${data.po.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create purchase order");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Selected vendor info ---
  const selectedVendor = vendors.find((v) => v.id === selectedVendorId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/po">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Create Purchase Order
          </h1>
          <p className="text-muted-foreground">
            Manually create a new PO by selecting a vendor and items
          </p>
        </div>
      </div>

      {/* Step 1: Select Vendor */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge
              variant={step >= 1 ? "default" : "secondary"}
              className="rounded-full h-6 w-6 flex items-center justify-center p-0 text-xs"
            >
              1
            </Badge>
            <h2 className="text-lg font-semibold">Select Vendor</h2>
          </div>

          {vendorsLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading vendors...
            </div>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="vendor-select">Vendor</Label>
              <select
                id="vendor-select"
                value={selectedVendorId}
                onChange={(e) => {
                  setSelectedVendorId(e.target.value);
                  if (e.target.value) setStep(2);
                  // Clear search results when vendor changes
                  setSearchResults([]);
                  setSearchQuery("");
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Choose a vendor...</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}{" "}
                    ({vendor._count.items} items)
                  </option>
                ))}
              </select>

              {selectedVendor && (
                <div className="text-sm text-muted-foreground mt-2">
                  {selectedVendor.email && (
                    <span className="mr-4">
                      Email: {selectedVendor.email}
                    </span>
                  )}
                  <span>
                    Order method: {selectedVendor.orderMethod}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Add Items */}
      {step >= 2 && selectedVendorId && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Badge
                variant="default"
                className="rounded-full h-6 w-6 flex items-center justify-center p-0 text-xs"
              >
                2
              </Badge>
              <h2 className="text-lg font-semibold">Add Items</h2>
            </div>

            {/* Search bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items by name or SKU..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Search results */}
            {(searching || searchResults.length > 0) && (
              <div className="border rounded-md mb-6 max-h-64 overflow-y-auto">
                {searching ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    No items found matching "{searchQuery}"
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-center">Stock</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchResults.map((item) => {
                        const alreadyAdded = lineItems.some(
                          (li) => li.inventoryItemId === item.id
                        );
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">
                              {item.sku}
                            </TableCell>
                            <TableCell className="text-sm">
                              {item.name}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="secondary"
                                className={
                                  item.currentStock <= 0
                                    ? "bg-red-100 text-red-700"
                                    : item.currentStock <= 5
                                    ? "bg-yellow-100 text-yellow-700"
                                    : ""
                                }
                              >
                                {item.currentStock}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              ${Number(item.costPrice).toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => addItem(item)}
                                disabled={alreadyAdded}
                                className="h-8 w-8 p-0"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}

            {/* Selected line items table */}
            {lineItems.length > 0 ? (
              <div className="border rounded-md">
                {/* Desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="w-28">Qty</TableHead>
                        <TableHead className="w-32">Unit Cost</TableHead>
                        <TableHead className="text-right w-28">
                          Line Total
                        </TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item, index) => (
                        <TableRow key={item.inventoryItemId}>
                          <TableCell>
                            <div>
                              <span className="font-medium text-sm">
                                {item.name}
                              </span>
                              <span className="block text-xs text-muted-foreground font-mono">
                                {item.sku}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              value={item.qtyOrdered}
                              onChange={(e) =>
                                updateLineItem(
                                  index,
                                  "qtyOrdered",
                                  Math.max(1, parseInt(e.target.value) || 1)
                                )
                              }
                              className="h-8 w-20"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.unitCost}
                              onChange={(e) =>
                                updateLineItem(
                                  index,
                                  "unitCost",
                                  Math.max(0, parseFloat(e.target.value) || 0)
                                )
                              }
                              className="h-8 w-24"
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            ${(item.qtyOrdered * item.unitCost).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLineItem(index)}
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card layout */}
                <div className="md:hidden divide-y">
                  {lineItems.map((item, index) => (
                    <div
                      key={item.inventoryItemId}
                      className="p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-medium text-sm">
                            {item.name}
                          </span>
                          <span className="block text-xs text-muted-foreground font-mono">
                            {item.sku}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLineItem(index)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground">
                            Qty
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            value={item.qtyOrdered}
                            onChange={(e) =>
                              updateLineItem(
                                index,
                                "qtyOrdered",
                                Math.max(1, parseInt(e.target.value) || 1)
                              )
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground">
                            Unit Cost
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.unitCost}
                            onChange={(e) =>
                              updateLineItem(
                                index,
                                "unitCost",
                                Math.max(0, parseFloat(e.target.value) || 0)
                              )
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="text-right pt-4">
                          <span className="font-medium text-sm">
                            ${(item.qtyOrdered * item.unitCost).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Subtotal */}
                <div className="border-t px-4 py-3 flex items-center justify-between bg-muted/30">
                  <span className="font-medium">
                    Subtotal ({lineItems.length}{" "}
                    {lineItems.length === 1 ? "item" : "items"})
                  </span>
                  <span className="text-lg font-bold">
                    ${subtotal.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ShoppingCart className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Search above and click + to add items to this PO
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Notes and Submit */}
      {step >= 2 && selectedVendorId && lineItems.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label htmlFor="po-notes">Notes (optional)</Label>
              <Textarea
                id="po-notes"
                placeholder="Add any special instructions or notes for this order..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1.5"
              />
            </div>

            {error && (
              <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={submitting || lineItems.length === 0}
                className="flex-1 sm:flex-none"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Draft PO
                  </>
                )}
              </Button>
              <Link href="/po">
                <Button variant="outline" className="w-full sm:w-auto">
                  Cancel
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
