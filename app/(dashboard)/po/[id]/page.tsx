"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Check, Send, Clock } from "lucide-react";

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

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const [po, setPo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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
    try {
      const res = await fetch(`/api/po/${params.id}/send`, { method: "POST" });
      if (res.ok) {
        loadPO();
      }
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setActionLoading(false);
    }
  };

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
          {po.status === "DRAFT" && (
            <Button size="sm" onClick={handleApprove} disabled={actionLoading}>
              <Check className="mr-2 h-4 w-4" />
              Approve
            </Button>
          )}
          {po.status === "APPROVED" && (
            <Button size="sm" onClick={handleSend} disabled={actionLoading}>
              <Send className="mr-2 h-4 w-4" />
              Send to Vendor
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
            <p className="text-lg font-semibold">{po.lineItems?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">${Number(po.total).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Order Method</p>
            <p className="text-lg font-semibold">{po.orderMethod}</p>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
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
                    {item.inventoryItem?.sku || "—"}
                  </TableCell>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={item.inventoryItem?.currentStock <= 0 ? "destructive" : "secondary"}>
                      {item.inventoryItem?.currentStock ?? "—"}
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
            <span className="text-lg font-bold">${Number(po.total).toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

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
                        <span className="text-muted-foreground">{entry.fromStatus} → </span>
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

      {/* Notes */}
      {po.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{po.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
