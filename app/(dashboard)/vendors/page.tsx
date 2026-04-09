"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Search,
  Mail,
  Globe,
  Phone,
  Truck,
  AlertTriangle,
  Upload,
  ArrowUpDown,
  Check,
  X,
  Download,
} from "lucide-react";
import Link from "next/link";

const orderMethodIcons: Record<string, typeof Mail> = {
  EMAIL: Mail,
  PORTAL: Globe,
  PHONE: Phone,
  API: Truck,
};

// Inline editable cell component
function InlineEditCell({
  value,
  field,
  vendorId,
  type = "text",
  onSave,
  placeholder,
  className = "",
}: {
  value: string | number | null;
  field: string;
  vendorId: string;
  type?: "text" | "number" | "select";
  onSave: (vendorId: string, field: string, value: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external value changes
  useEffect(() => {
    if (!editing) setEditValue(String(value ?? ""));
  }, [value, editing]);

  const handleSave = async () => {
    if (editValue === String(value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(vendorId, field, editValue);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    } catch {
      setEditValue(String(value ?? ""));
    }
    setSaving(false);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setEditValue(String(value ?? ""));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type={type === "number" ? "number" : "text"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-7 w-full min-w-[60px] rounded border border-primary bg-white px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
      className={`cursor-pointer rounded px-1 py-0.5 hover:bg-muted transition-colors ${
        flash ? "bg-green-100" : ""
      } ${className}`}
      title="Click to edit"
    >
      {saving ? (
        <span className="text-muted-foreground text-xs">Saving...</span>
      ) : value ? (
        String(value)
      ) : (
        <span className="text-muted-foreground italic text-xs">
          {placeholder || "---"}
        </span>
      )}
    </span>
  );
}

// Inline editable select for Order Method
function InlineSelectCell({
  value,
  vendorId,
  onSave,
}: {
  value: string;
  vendorId: string;
  onSave: (vendorId: string, field: string, value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);

  const handleChange = async (newValue: string) => {
    if (newValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(vendorId, "orderMethod", newValue);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    } catch {}
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setEditing(false)}
        className="h-7 rounded border border-primary bg-white px-1 text-xs outline-none"
      >
        <option value="EMAIL">Email</option>
        <option value="PORTAL">Portal</option>
        <option value="PHONE">Phone</option>
        <option value="API">API</option>
      </select>
    );
  }

  const Icon = orderMethodIcons[value] || Mail;
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
      className={`cursor-pointer inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted transition-colors text-xs ${
        flash ? "bg-green-100" : ""
      }`}
      title="Click to change"
    >
      {saving ? "..." : (
        <>
          <Icon className="h-3 w-3" />
          {value}
        </>
      )}
    </span>
  );
}

type SortField =
  | "name"
  | "email"
  | "phone"
  | "contactName"
  | "orderMethod"
  | "items"
  | "pos"
  | "leadTimeDays";

export default function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);

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

  // Inline save handler — PATCH single field
  const handleInlineSave = useCallback(
    async (vendorId: string, field: string, value: string) => {
      const res = await fetch("/api/vendors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vendorId, field, value }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      // Update local state with the returned vendor
      setVendors((prev) =>
        prev.map((v) => (v.id === vendorId ? { ...v, ...data.vendor } : v))
      );
    },
    []
  );

  // CSV import handler
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvUploading(true);
    setCsvResult(null);

    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      setCsvResult("Error: CSV must have a header row and at least one data row");
      setCsvUploading(false);
      return;
    }

    // Parse header
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = headers.findIndex((h) => h === "name" || h === "company" || h === "vendor");
    const emailIdx = headers.findIndex((h) => h === "email");
    const phoneIdx = headers.findIndex((h) => h === "phone" || h === "telephone");
    const contactIdx = headers.findIndex((h) =>
      h === "contact" || h === "contact name" || h === "contactname" || h === "contact_name"
    );

    if (nameIdx === -1) {
      setCsvResult("Error: CSV must have a 'name' column");
      setCsvUploading(false);
      return;
    }

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const name = cols[nameIdx];
      if (!name) { skipped++; continue; }

      try {
        await fetch("/api/vendors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email: emailIdx >= 0 ? cols[emailIdx] || null : null,
            phone: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
            contactName: contactIdx >= 0 ? cols[contactIdx] || null : null,
          }),
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    setCsvResult(`Imported ${imported} vendors${skipped > 0 ? `, skipped ${skipped}` : ""}`);
    setCsvUploading(false);
    loadVendors();

    // Reset file input
    e.target.value = "";
  };

  // Filter vendors by search term (name, email, phone)
  const filtered = vendors.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.name?.toLowerCase().includes(q) ||
      v.email?.toLowerCase().includes(q) ||
      v.phone?.toLowerCase().includes(q) ||
      v.contactName?.toLowerCase().includes(q)
    );
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let aVal: any, bVal: any;
    switch (sortField) {
      case "name":
        aVal = a.name?.toLowerCase() || "";
        bVal = b.name?.toLowerCase() || "";
        break;
      case "email":
        aVal = a.email?.toLowerCase() || "zzz";
        bVal = b.email?.toLowerCase() || "zzz";
        break;
      case "phone":
        aVal = a.phone || "zzz";
        bVal = b.phone || "zzz";
        break;
      case "contactName":
        aVal = a.contactName?.toLowerCase() || "zzz";
        bVal = b.contactName?.toLowerCase() || "zzz";
        break;
      case "orderMethod":
        aVal = a.orderMethod;
        bVal = b.orderMethod;
        break;
      case "items":
        aVal = a._count?.items || 0;
        bVal = b._count?.items || 0;
        break;
      case "pos":
        aVal = a._count?.purchaseOrders || 0;
        bVal = b._count?.purchaseOrders || 0;
        break;
      case "leadTimeDays":
        aVal = a.leadTimeDays || 0;
        bVal = b.leadTimeDays || 0;
        break;
      default:
        return 0;
    }
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const missingEmailCount = vendors.filter((v) => !v.email).length;

  const SortableHeader = ({
    field,
    children,
    className = "",
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 ${className}`}
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
        {sortField === field && (
          <span className="text-xs text-primary">
            {sortDir === "asc" ? "\u2191" : "\u2193"}
          </span>
        )}
      </div>
    </TableHead>
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
        <div className="flex items-center gap-2">
          {/* CSV Export */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.open("/api/export?type=vendors", "_blank");
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          {/* CSV Import */}
          <label className="cursor-pointer inline-flex shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-medium h-9 gap-1 px-3 hover:bg-muted transition-all">
            <Upload className="h-4 w-4 mr-1" />
            {csvUploading ? "Importing..." : "Import CSV"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsvImport}
              disabled={csvUploading}
            />
          </label>

          {/* Add Vendor Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button><Plus className="mr-2 h-4 w-4" />Add Vendor</Button>} />
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
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
      </div>

      {/* CSV import result */}
      {csvResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            csvResult.startsWith("Error")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {csvResult}
          <button
            onClick={() => setCsvResult(null)}
            className="ml-2 underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Search + Stats */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone, contact..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{vendors.length} vendors</Badge>
        {missingEmailCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {missingEmailCount} missing email
          </Badge>
        )}
      </div>

      {/* Vendor Table */}
      {sorted.length === 0 && !search ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Truck className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No vendors yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Add your first vendor or import from CSV to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader field="name">Name</SortableHeader>
                  <SortableHeader field="email">Email</SortableHeader>
                  <SortableHeader field="phone">Phone</SortableHeader>
                  <SortableHeader field="contactName">Contact</SortableHeader>
                  <SortableHeader field="orderMethod">Order Method</SortableHeader>
                  <SortableHeader field="items" className="text-center">
                    Items
                  </SortableHeader>
                  <SortableHeader field="pos" className="text-center">
                    POs
                  </SortableHeader>
                  <SortableHeader field="leadTimeDays" className="text-center">
                    Lead Time
                  </SortableHeader>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((vendor) => (
                  <TableRow key={vendor.id} className="group">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/vendors/${vendor.id}`}
                          className="hover:underline text-primary"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {vendor.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <InlineEditCell
                          value={vendor.email}
                          field="email"
                          vendorId={vendor.id}
                          onSave={handleInlineSave}
                          placeholder="Add email"
                        />
                        {!vendor.email && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1 py-0 h-4"
                          >
                            Missing
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <InlineEditCell
                        value={vendor.phone}
                        field="phone"
                        vendorId={vendor.id}
                        onSave={handleInlineSave}
                        placeholder="Add phone"
                      />
                    </TableCell>
                    <TableCell>
                      <InlineEditCell
                        value={vendor.contactName}
                        field="contactName"
                        vendorId={vendor.id}
                        onSave={handleInlineSave}
                        placeholder="Add contact"
                      />
                    </TableCell>
                    <TableCell>
                      <InlineSelectCell
                        value={vendor.orderMethod}
                        vendorId={vendor.id}
                        onSave={handleInlineSave}
                      />
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {vendor._count?.items || 0}
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {vendor._count?.purchaseOrders || 0}
                    </TableCell>
                    <TableCell className="text-center">
                      <InlineEditCell
                        value={vendor.leadTimeDays}
                        field="leadTimeDays"
                        vendorId={vendor.id}
                        type="number"
                        onSave={handleInlineSave}
                        placeholder="0"
                        className="text-sm"
                      />
                      <span className="text-xs text-muted-foreground ml-0.5">
                        days
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/vendors/${vendor.id}`}
                        className="text-muted-foreground hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs underline">View</span>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {sorted.length === 0 && search && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No vendors matching &quot;{search}&quot;
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
