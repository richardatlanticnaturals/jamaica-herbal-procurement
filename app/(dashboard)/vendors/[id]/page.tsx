"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Mail,
  Globe,
  Phone,
  Truck,
  Pencil,
  X,
  Check,
  Package,
  FileText,
  DollarSign,
} from "lucide-react";

const orderMethodIcons: Record<string, typeof Mail> = {
  EMAIL: Mail,
  PORTAL: Globe,
  PHONE: Phone,
  API: Truck,
};

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-purple-100 text-purple-800",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-800",
  RECEIVED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  CLOSED: "bg-gray-200 text-gray-600",
};

export default function VendorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const vendorId = params.id as string;

  const [vendor, setVendor] = useState<any>(null);
  const [stats, setStats] = useState({ totalPOs: 0, totalItems: 0, totalSpent: 0 });
  const [pos, setPos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable vendor fields
  const [editName, setEditName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editOrderMethod, setEditOrderMethod] = useState("EMAIL");
  const [editLeadTimeDays, setEditLeadTimeDays] = useState(3);
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const loadVendor = useCallback(async () => {
    try {
      const res = await fetch(`/api/vendors/${vendorId}`);
      const data = await res.json();
      if (res.ok) {
        setVendor(data.vendor);
        setStats(data.stats);
        populateEditFields(data.vendor);
      }
    } catch (err) {
      console.error("Failed to load vendor:", err);
    }
  }, [vendorId]);

  const loadPOs = useCallback(async () => {
    try {
      const res = await fetch(`/api/po?vendorId=${vendorId}&limit=50`);
      const data = await res.json();
      setPos(data.orders || []);
    } catch (err) {
      console.error("Failed to load POs:", err);
    }
  }, [vendorId]);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory?vendorId=${vendorId}&limit=100`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to load items:", err);
    }
  }, [vendorId]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadVendor(), loadPOs(), loadItems()]);
      setLoading(false);
    }
    init();
  }, [loadVendor, loadPOs, loadItems]);

  const populateEditFields = (v: any) => {
    setEditName(v.name || "");
    setEditContactName(v.contactName || "");
    setEditEmail(v.email || "");
    setEditPhone(v.phone || "");
    setEditWebsite(v.website || "");
    setEditOrderMethod(v.orderMethod || "EMAIL");
    setEditLeadTimeDays(v.leadTimeDays || 3);
    setEditPaymentTerms(v.paymentTerms || "");
    setEditNotes(v.notes || "");
  };

  const handleCancelEdit = () => {
    if (vendor) populateEditFields(vendor);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          contactName: editContactName,
          email: editEmail,
          phone: editPhone,
          website: editWebsite,
          orderMethod: editOrderMethod,
          leadTimeDays: editLeadTimeDays,
          paymentTerms: editPaymentTerms,
          notes: editNotes,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setVendor(data.vendor);
        setEditing(false);
      }
    } catch (err) {
      console.error("Failed to save vendor:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading vendor...
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground">Vendor not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/vendors")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vendors
        </Button>
      </div>
    );
  }

  const Icon = orderMethodIcons[vendor.orderMethod] || Mail;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/vendors")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
        </div>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-4 w-4" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelEdit}>
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={handleSave}>
              <Check className="mr-1 h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Purchase Orders</p>
              <p className="text-xl font-bold">{stats.totalPOs}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
              <Package className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Products Supplied</p>
              <p className="text-xl font-bold">{stats.totalItems}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Spent</p>
              <p className="text-xl font-bold">${stats.totalSpent.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vendor Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor Details</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-name">Company Name</Label>
                  <Input
                    id="v-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-contact">Contact Name</Label>
                  <Input
                    id="v-contact"
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-email">Email</Label>
                  <Input
                    id="v-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-phone">Phone</Label>
                  <Input
                    id="v-phone"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-website">Website</Label>
                  <Input
                    id="v-website"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Order Method</Label>
                  <Select value={editOrderMethod} onValueChange={(v) => setEditOrderMethod(v || "EMAIL")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMAIL">Email</SelectItem>
                      <SelectItem value="PORTAL">Web Portal</SelectItem>
                      <SelectItem value="PHONE">Phone</SelectItem>
                      <SelectItem value="API">API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-lead">Lead Time (days)</Label>
                  <Input
                    id="v-lead"
                    type="number"
                    value={editLeadTimeDays}
                    onChange={(e) => setEditLeadTimeDays(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-terms">Payment Terms</Label>
                  <Input
                    id="v-terms"
                    value={editPaymentTerms}
                    onChange={(e) => setEditPaymentTerms(e.target.value)}
                    placeholder="e.g., Net 30, COD"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="v-notes">Notes</Label>
                <Textarea
                  id="v-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {vendor.contactName && (
                  <div>
                    <span className="text-muted-foreground">Contact:</span>{" "}
                    <span className="font-medium">{vendor.contactName}</span>
                  </div>
                )}
                {vendor.email && (
                  <div>
                    <span className="text-muted-foreground">Email:</span>{" "}
                    <span className="font-medium">{vendor.email}</span>
                  </div>
                )}
                {vendor.phone && (
                  <div>
                    <span className="text-muted-foreground">Phone:</span>{" "}
                    <span className="font-medium">{vendor.phone}</span>
                  </div>
                )}
                {vendor.website && (
                  <div>
                    <span className="text-muted-foreground">Website:</span>{" "}
                    <span className="font-medium">{vendor.website}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Order Method:</span>{" "}
                  <Badge variant="outline" className="text-xs ml-1">
                    <Icon className="mr-1 h-3 w-3" />
                    {vendor.orderMethod}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Lead Time:</span>{" "}
                  <span className="font-medium">{vendor.leadTimeDays} days</span>
                </div>
                {vendor.paymentTerms && (
                  <div>
                    <span className="text-muted-foreground">Payment Terms:</span>{" "}
                    <span className="font-medium">{vendor.paymentTerms}</span>
                  </div>
                )}
              </div>
              {vendor.notes && (
                <div className="border-t pt-3 mt-1">
                  <span className="text-muted-foreground">Notes:</span>{" "}
                  <span>{vendor.notes}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purchase Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase Orders ({pos.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pos.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No purchase orders for this vendor yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {po.poNumber}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${statusColors[po.status] || "bg-gray-100 text-gray-800"}`}
                      >
                        {po.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(po.total).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      {po._count?.lineItems || 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(po.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inventory Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inventory Items ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No inventory items linked to this vendor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead className="text-center">Reorder Pt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {item.name}
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
