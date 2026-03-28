"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Plus, Zap, ChevronLeft, ChevronRight, Search, Download, X } from "lucide-react";

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

const PO_STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_APPROVAL", label: "Pending Approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "SENT", label: "Sent" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PARTIALLY_RECEIVED", label: "Partially Received" },
  { value: "RECEIVED", label: "Received" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "CLOSED", label: "Closed" },
];

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Debounce search input -- 400ms delay
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, dateFrom, dateTo]);

  const buildQueryString = useCallback(
    (p: number) => {
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("limit", "20");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return params.toString();
    },
    [debouncedSearch, statusFilter, dateFrom, dateTo]
  );

  const loadOrders = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/po?${buildQueryString(p)}`);
        const data = await res.json();
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } catch (err) {
        console.error("Failed to load POs:", err);
      } finally {
        setLoading(false);
      }
    },
    [buildQueryString]
  );

  useEffect(() => {
    loadOrders(page);
  }, [page, loadOrders]);

  const handleAutoGenerate = async () => {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/po/auto-generate", { method: "POST" });
      const data = await res.json();
      setGenResult(data.message);
      loadOrders(1);
      setPage(1);
    } catch (err) {
      setGenResult("Failed to auto-generate POs");
    } finally {
      setGenerating(false);
    }
  };

  // CSV Export -- applies the same active filters
  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter) params.set("status", statusFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const qs = params.toString();
    window.open(`/api/po/export${qs ? `?${qs}` : ""}`, "_blank");
  };

  const hasActiveFilters = debouncedSearch || statusFilter || dateFrom || dateTo;

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">
            {total > 0 ? `${total} purchase orders` : "Create and manage purchase orders"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            title="Export filtered results as CSV"
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          {/* Manual PO creation */}
          <Link href="/po/new">
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New PO
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoGenerate}
            disabled={generating}
          >
            <Zap className="mr-2 h-4 w-4" />
            {generating ? "Generating..." : "Auto-Generate POs"}
          </Button>
        </div>
      </div>

      {/* Search and filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search input with debounce */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PO number or vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Status filter -- native select styled to match theme */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {PO_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>

        {/* Clear filters button -- only show when filters active */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {genResult && (
        <div className={`rounded-lg px-4 py-3 text-sm ${genResult.includes("Failed") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {genResult}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              Loading purchase orders...
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">
                {hasActiveFilters ? "No matching purchase orders" : "No purchase orders"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
                {hasActiveFilters
                  ? "Try adjusting your search or filters."
                  : 'Click "Auto-Generate POs" to create purchase orders for all items below their reorder point.'}
              </p>
              {hasActiveFilters ? (
                <Button size="sm" variant="outline" className="mt-4" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={handleAutoGenerate}
                  disabled={generating}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  Auto-Generate POs
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((po) => (
                    <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/po/${po.id}`} className="font-mono text-sm font-medium text-blue-600 hover:underline">
                          {po.poNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        {po.vendor?.name || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[po.status] || "bg-gray-100"}>
                          {po.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {po._count?.lineItems || 0}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${Number(po.total).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(po.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
                      Next <ChevronRight className="h-4 w-4" />
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
