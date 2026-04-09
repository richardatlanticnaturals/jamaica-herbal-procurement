"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Check,
  Send,
  Clock,
  Download,
  Mail,
  Trash2,
  Pencil,
  X,
  Plus,
  Search,
  Save,
  Loader2,
} from "lucide-react";

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SENT: "bg-purple-100 text-purple-700",
  CONFIRMED: "bg-green-100 text-green-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  RECEIVED: "bg-green-200 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

// Editable line item shape (includes both existing and new items)
interface EditableLineItem {
  id?: string; // undefined for newly added items
  inventoryItemId: string;
  vendorSku: string | null;
  description: string;
  qtyOrdered: number;
  unitCost: number;
  inventoryItem?: { id: string; name: string; sku: string; currentStock: number } | null;
}

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const [po, setPo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [emailPreview, setEmailPreview] = useState<any>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editLineItems, setEditLineItems] = useState<EditableLineItem[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add-item search state
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [itemSearchResults, setItemSearchResults] = useState<any[]>([]);
  const [itemSearching, setItemSearching] = useState(false);
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);

  const loadPO = useCallback(async () => {
    try {
      const res = await fetch(`/api/po/${params.id}`);
      const data = await res.json();
      setPo(data.po);
    } catch (err) {
      console.error("Failed to load PO:", err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadPO();
  }, [loadPO]);

  // --- Enter edit mode ---
  const startEditing = () => {
    if (!po) return;
    setEditLineItems(
      po.lineItems.map((li: any) => ({
        id: li.id,
        inventoryItemId: li.inventoryItemId || li.inventoryItem?.id,
        vendorSku: li.vendorSku,
        description: li.description,
        qtyOrdered: li.qtyOrdered,
        unitCost: Number(li.unitCost),
        inventoryItem: li.inventoryItem,
      }))
    );
    setEditNotes(po.notes || "");
    setEditError(null);
    setEditing(true);
    setShowAddItem(false);
    setItemSearch("");
    setItemSearchResults([]);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditLineItems([]);
    setEditError(null);
    setShowAddItem(false);
  };

  // --- Edit helpers ---
  const updateEditQty = (index: number, qty: number) => {
    setEditLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, qtyOrdered: Math.max(1, qty) } : li))
    );
  };

  const updateEditUnitCost = (index: number, cost: number) => {
    setEditLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, unitCost: Math.max(0, cost) } : li))
    );
  };

  const removeEditItem = (index: number) => {
    setEditLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Add item search (debounced) ---
  const doItemSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setItemSearchResults([]);
        return;
      }
      setItemSearching(true);
      try {
        const searchParams = new URLSearchParams({ q });
        if (po?.vendorId) searchParams.set("vendorId", po.vendorId);
        const res = await fetch(`/api/inventory/search?${searchParams}`);
        const data = await res.json();
        setItemSearchResults(data.items || []);
      } catch {
        console.error("Search failed");
      } finally {
        setItemSearching(false);
      }
    },
    [po?.vendorId]
  );

  const handleItemSearchChange = (value: string) => {
    setItemSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => doItemSearch(value), 300);
    setSearchTimer(timer);
  };

  const addItemToEdit = (item: any) => {
    // Prevent duplicates
    if (editLineItems.some((li) => li.inventoryItemId === item.id)) return;
    // Default qty = maxStockLevel - currentStock
    const defaultQty = Math.max(1, (item.reorderPoint + item.reorderQty) - item.currentStock);
    setEditLineItems((prev) => [
      ...prev,
      {
        inventoryItemId: item.id,
        vendorSku: item.vendorSku,
        description: item.name,
        qtyOrdered: defaultQty,
        unitCost: Number(item.costPrice) || 0,
        inventoryItem: { id: item.id, name: item.name, sku: item.sku, currentStock: item.currentStock },
      },
    ]);
  };

  // --- Save edits ---
  const saveEdits = async () => {
    if (editLineItems.length === 0) {
      setEditError("Cannot save a PO with no line items.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/po/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: editLineItems.map((li) => ({
            id: li.id || undefined,
            inventoryItemId: li.inventoryItemId,
            vendorSku: li.vendorSku,
            description: li.description,
            qtyOrdered: li.qtyOrdered,
            unitCost: li.unitCost,
          })),
          notes: editNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save changes");
      }

      const data = await res.json();
      setPo(data.po);
      setEditing(false);
      setEditLineItems([]);
      setShowAddItem(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  // --- Calculated edit subtotal ---
  const editSubtotal = editLineItems.reduce(
    (sum, li) => sum + li.qtyOrdered * li.unitCost,
    0
  );

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/po/${params.id}/approve`, { method: "POST" });
      if (res.ok) {
        loadPO();
      }
    } catch (err) {
      console.error("Failed to approve:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSend = async () => {
    setActionLoading(true);
    setSendStatus(null);
    try {
      const emailRes = await fetch(`/api/po/${params.id}/email`, { method: "POST" });
      if (!emailRes.ok) throw new Error("Failed to generate email");
      const { emailData } = await emailRes.json();
      setEmailPreview(emailData);
    } catch (err) {
      console.error("Failed to prepare email:", err);
      setSendStatus("Failed to prepare email");
    } finally {
      setActionLoading(false);
    }
  };

  const confirmSend = async () => {
    if (!emailPreview) return;
    setActionLoading(true);
    setSendStatus("Sending...");
    try {
      const res = await fetch(`/api/po/${params.id}/send`, { method: "POST" });
      if (res.ok) {
        setSendStatus(`Email ready for ${emailPreview.to}. PO marked as sent.`);
        setEmailPreview(null);
        loadPO();
      }
    } catch {
      setSendStatus("Failed to send");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete PO ${po?.poNumber}? This cannot be undone.`)) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/po/${params.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/po");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete PO");
    } finally {
      setActionLoading(false);
    }
  };

  const canEdit = po && ["DRAFT", "APPROVED"].includes(po.status);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading purchase order...
      </div>
    );
  }

  if (!po) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <h3 className="text-lg font-semibold">Purchase order not found</h3>
        <Link href="/po" className="mt-4 text-sm text-blue-600 hover:underline">
          Back to Purchase Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/po">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-mono">{po.poNumber}</h1>
            <p className="text-muted-foreground">
              {po.vendor?.name} &middot; Created {new Date(po.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`text-sm px-3 py-1 ${statusColors[po.status] || ""}`}>
            {po.status.replace(/_/g, " ")}
          </Badge>
          <a href={`/api/po/${params.id}/pdf`} target="_blank" rel="noopener">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </a>
          {canEdit && !editing && (
            <Button size="sm" variant="outline" onClick={startEditing} disabled={actionLoading}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          {po.status === "DRAFT" && !editing && (
            <Button size="sm" onClick={handleApprove} disabled={actionLoading}>
              <Check className="mr-2 h-4 w-4" />
              Approve
            </Button>
          )}
          {po.status === "APPROVED" && !editing && (
            <Button size="sm" onClick={handleSend} disabled={actionLoading}>
              <Send className="mr-2 h-4 w-4" />
              Send to Vendor
            </Button>
          )}
          {po.status === "SENT" && po.vendor?.email && (
            <Button size="sm" variant="outline" onClick={handleSend} disabled={actionLoading}>
              <Mail className="mr-2 h-4 w-4" />
              Resend Email
            </Button>
          )}
          {["DRAFT", "APPROVED", "CANCELLED"].includes(po.status) && !editing && (
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Vendor</p>
            <p className="text-lg font-semibold">{po.vendor?.name}</p>
            {po.vendor?.email && (
              <p className="text-sm text-muted-foreground">{po.vendor.email}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Items</p>
            <p className="text-lg font-semibold">
              {editing ? editLineItems.length : (po.lineItems?.length || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">
              ${editing ? editSubtotal.toFixed(2) : Number(po.total).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Order Method</p>
            <p className="text-lg font-semibold">{po.orderMethod}</p>
          </CardContent>
        </Card>
      </div>

      {/* Line Items -- Edit Mode */}
      {editing ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Edit Line Items</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddItem(!showAddItem)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-0">
            {/* Add Item Search Panel */}
            {showAddItem && (
              <div className="mx-6 mb-4 p-4 border rounded-md bg-muted/30">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search items by name or SKU..."
                    value={itemSearch}
                    onChange={(e) => handleItemSearchChange(e.target.value)}
                    className="pl-10"
                    autoFocus
                  />
                </div>
                {(itemSearching || itemSearchResults.length > 0) && (
                  <div className="border rounded-md max-h-48 overflow-y-auto bg-background">
                    {itemSearching ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </div>
                    ) : (
                      itemSearchResults.map((item) => {
                        const alreadyAdded = editLineItems.some(
                          (li) => li.inventoryItemId === item.id
                        );
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 text-sm"
                          >
                            <div>
                              <span className="font-medium">{item.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground font-mono">
                                {item.sku}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                Stock: {item.currentStock}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => addItemToEdit(item)}
                              disabled={alreadyAdded}
                              className="h-7 px-2"
                            >
                              {alreadyAdded ? "Added" : <Plus className="h-4 w-4" />}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Editable line items table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead className="w-28">Qty</TableHead>
                  <TableHead className="w-32">Unit Cost</TableHead>
                  <TableHead className="text-right w-28">Line Total</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editLineItems.map((item, index) => (
                  <TableRow key={item.id || `new-${item.inventoryItemId}`}>
                    <TableCell className="font-mono text-xs">
                      {item.inventoryItem?.sku || "--"}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{item.description}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">
                        {item.inventoryItem?.currentStock ?? "--"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={item.qtyOrdered}
                        onChange={(e) =>
                          updateEditQty(index, parseInt(e.target.value) || 1)
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
                          updateEditUnitCost(index, parseFloat(e.target.value) || 0)
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
                        onClick={() => removeEditItem(index)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {editLineItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                      No items. Click "Add Item" to search and add inventory items.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="border-t px-4 py-3 text-right">
              <span className="text-sm text-muted-foreground mr-4">Subtotal:</span>
              <span className="text-lg font-bold">${editSubtotal.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Line Items -- View Mode */
        <Card>
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Current Stock</TableHead>
                  <TableHead className="text-center">Qty Ordered</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lineItems?.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.inventoryItem?.sku || "--"}
                    </TableCell>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={item.inventoryItem?.currentStock <= 0 ? "destructive" : "secondary"}>
                        {item.inventoryItem?.currentStock ?? "--"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">{item.qtyOrdered}</TableCell>
                    <TableCell className="text-right">${Number(item.unitCost).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">
                      ${Number(item.lineTotal).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-t px-4 py-3 text-right">
              <span className="text-sm text-muted-foreground mr-4">Subtotal:</span>
              <span className="text-lg font-bold">${Number(po.subtotal).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit-mode Notes + Save/Cancel */}
      {editing && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Add any special instructions or notes..."
                className="mt-1.5"
              />
            </div>

            {editError && (
              <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700">
                {editError}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={saveEdits} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status History */}
      {po.statusHistory?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Status History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {po.statusHistory.map((entry: any) => (
                <div key={entry.id} className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm">
                      {entry.fromStatus && (
                        <span className="text-muted-foreground">{entry.fromStatus} &rarr; </span>
                      )}
                      <Badge className={statusColors[entry.toStatus] || ""} variant="secondary">
                        {entry.toStatus.replace(/_/g, " ")}
                      </Badge>
                    </p>
                    {entry.note && (
                      <p className="text-xs text-muted-foreground">{entry.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()} &middot; {entry.triggeredBy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes (view mode) */}
      {!editing && po.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{po.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Send Status */}
      {sendStatus && (
        <div className={`rounded-lg px-4 py-3 text-sm ${sendStatus.includes("Failed") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {sendStatus}
        </div>
      )}

      {/* Email Preview Modal */}
      {emailPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Send Purchase Order Email
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <span className="font-medium text-muted-foreground w-16">To:</span>
                  <span>{emailPreview.to}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium text-muted-foreground w-16">Subject:</span>
                  <span>{emailPreview.subject}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium text-muted-foreground w-16">From:</span>
                  <span>jamaicanherbal@gmail.com</span>
                </div>
              </div>

              <div className="rounded border bg-muted/30 p-3 text-xs max-h-48 overflow-y-auto">
                <p className="text-muted-foreground">
                  PO {emailPreview.poNumber} for {emailPreview.vendorName} with line items table and Jamaica Herbal branding.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEmailPreview(null); setSendStatus(null); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={confirmSend}
                  disabled={actionLoading}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {actionLoading ? "Sending..." : "Confirm & Send"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
