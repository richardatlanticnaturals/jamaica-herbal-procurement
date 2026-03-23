"use client";

import { useState, useEffect } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Mail, Globe, Phone, Truck } from "lucide-react";

const orderMethodIcons: Record<string, typeof Mail> = {
  EMAIL: Mail,
  PORTAL: Globe,
  PHONE: Phone,
  API: Truck,
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadVendors = async () => {
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      setVendors(data.vendors || []);
    } catch (err) {
      console.error("Failed to load vendors:", err);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const handleCreateVendor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get("name"),
      contactName: form.get("contactName"),
      email: form.get("email"),
      phone: form.get("phone"),
      website: form.get("website"),
      orderMethod: form.get("orderMethod"),
      paymentTerms: form.get("paymentTerms"),
      leadTimeDays: Number(form.get("leadTimeDays")) || 3,
      notes: form.get("notes"),
    };

    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        loadVendors();
      }
    } catch (err) {
      console.error("Failed to create vendor:", err);
    } finally {
      setSaving(false);
    }
  };

  const filtered = vendors.filter(
    (v) =>
      !search ||
      v.name?.toLowerCase().includes(search.toLowerCase()) ||
      v.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground">
            Manage your product suppliers and ordering preferences
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger>
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <form onSubmit={handleCreateVendor}>
              <DialogHeader>
                <DialogTitle>Add New Vendor</DialogTitle>
                <DialogDescription>
                  Add a supplier to your vendor list
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Company Name *</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="contactName">Contact Name</Label>
                    <Input id="contactName" name="contactName" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" name="website" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="orderMethod">Order Method</Label>
                    <Select name="orderMethod" defaultValue="EMAIL">
                      <SelectTrigger>
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
                  <div className="grid gap-2">
                    <Label htmlFor="leadTimeDays">Lead Time (days)</Label>
                    <Input
                      id="leadTimeDays"
                      name="leadTimeDays"
                      type="number"
                      defaultValue="3"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="paymentTerms">Payment Terms</Label>
                  <Input
                    id="paymentTerms"
                    name="paymentTerms"
                    placeholder="e.g., Net 30, COD, Prepaid"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={3} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Add Vendor"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{vendors.length} vendors</Badge>
      </div>

      {/* Vendor Cards */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Truck className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No vendors yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Add your first vendor to start creating purchase orders
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((vendor) => {
            const Icon = orderMethodIcons[vendor.orderMethod] || Mail;
            return (
              <Card key={vendor.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{vendor.name}</CardTitle>
                    <Badge variant="outline" className="text-xs">
                      <Icon className="mr-1 h-3 w-3" />
                      {vendor.orderMethod}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {vendor.contactName && (
                    <p className="text-muted-foreground">{vendor.contactName}</p>
                  )}
                  {vendor.email && (
                    <p className="text-muted-foreground">{vendor.email}</p>
                  )}
                  {vendor.phone && (
                    <p className="text-muted-foreground">{vendor.phone}</p>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-xs text-muted-foreground">
                      Lead time: {vendor.leadTimeDays} days
                    </span>
                    {vendor.paymentTerms && (
                      <span className="text-xs text-muted-foreground">
                        {vendor.paymentTerms}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
