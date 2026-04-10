"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package,
  Truck,
  FileText,
  AlertTriangle,
  Users,
  Clock,
  Zap,
  RefreshCw,
  Upload,
  DollarSign,
  Database,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SpendingDay {
  date: string;
  total: number;
}

interface DashboardData {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  activePOs: number;
  totalVendors: number;
  pendingReceivings: number;
  spendingByDay: SpendingDay[];
  recentPOs: {
    id: string;
    poNumber: string;
    status: string;
    total: number;
    createdAt: string;
    vendorName: string;
  }[];
  recentAlerts: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    triggeredBy: string;
    createdAt: string;
    poNumber: string;
    vendorName: string;
  }[];
}

// Day range options for the spending chart
const SPENDING_RANGES = [
  { label: "7 Days", value: 7 },
  { label: "30 Days", value: 30 },
  { label: "60 Days", value: 60 },
] as const;

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-800",
  RECEIVED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  CLOSED: "bg-gray-200 text-gray-600",
};

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spendingDays, setSpendingDays] = useState(30);
  const [spendingLoading, setSpendingLoading] = useState(false);
  const [stockRefreshing, setStockRefreshing] = useState(false);
  const [lastStockSync, setLastStockSync] = useState<string | null>(null);

  const fetchData = useCallback(async (days?: number) => {
    try {
      setLoading(true);
      setError(null);
      const d = days ?? spendingDays;
      const res = await fetch(`/api/dashboard?days=${d}`);
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [spendingDays]);

  // Fetch only spending data when the range changes (avoids re-fetching KPIs)
  const fetchSpending = useCallback(async (days: number) => {
    try {
      setSpendingLoading(true);
      const res = await fetch(`/api/dashboard?days=${days}`);
      if (!res.ok) return;
      const json = await res.json();
      setData((prev) => prev ? { ...prev, spendingByDay: json.spendingByDay } : json);
    } finally {
      setSpendingLoading(false);
    }
  }, []);

  const handleRangeChange = (days: number) => {
    setSpendingDays(days);
    fetchSpending(days);
  };

  // Fetch last stock sync timestamp from AppSettings
  const fetchLastStockSync = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const settings = await res.json();
        setLastStockSync(settings.lastStockSync || null);
      }
    } catch {
      // ignore
    }
  }, []);

  // Fast stock-only refresh from Comcash POS
  const handleRefreshStock = useCallback(async () => {
    setStockRefreshing(true);
    try {
      const res = await fetch("/api/comcash/refresh-stock", { method: "POST" });
      if (res.ok) {
        // Refresh dashboard data and last sync timestamp
        fetchData();
        fetchLastStockSync();
      }
    } catch (err) {
      console.error("Stock refresh failed:", err);
    } finally {
      setStockRefreshing(false);
    }
  }, [fetchData, fetchLastStockSync]);

  useEffect(() => {
    fetchData();
    fetchLastStockSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your procurement activity
          </p>
        </div>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center justify-between py-6">
            <p className="text-sm text-red-700">{error}</p>
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your procurement activity
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastStockSync && (
            <span className="text-xs text-muted-foreground">
              Stock synced: {timeAgo(lastStockSync)}
            </span>
          )}
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={handleRefreshStock} disabled={stockRefreshing}>
            <Database className={`mr-2 h-4 w-4 ${stockRefreshing ? "animate-spin" : ""}`} />
            {stockRefreshing ? "Syncing..." : "Refresh Stock"}
          </Button>
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Total Products */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.totalItems ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Active inventory items</p>
          </CardContent>
        </Card>

        {/* Low Stock */}
        <Card className="border-yellow-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-yellow-700">
              Low Stock
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-yellow-700">
                {data?.lowStockItems ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Below reorder point</p>
          </CardContent>
        </Card>

        {/* Out of Stock */}
        <Card className="border-red-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-700">
              Out of Stock
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-red-700">
                {data?.outOfStockItems ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Need immediate action</p>
          </CardContent>
        </Card>

        {/* Active POs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active POs</CardTitle>
            <FileText className="h-4 w-4" style={{ color: "#009B3A" }} />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.activePOs ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Open purchase orders</p>
          </CardContent>
        </Card>

        {/* Vendors */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vendors</CardTitle>
            <Users className="h-4 w-4" style={{ color: "#FFB81C" }} />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.totalVendors ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Registered suppliers</p>
          </CardContent>
        </Card>

        {/* Pending Deliveries */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Deliveries</CardTitle>
            <Truck className="h-4 w-4" style={{ color: "#009B3A" }} />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {data?.pendingReceivings ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Awaiting receiving</p>
          </CardContent>
        </Card>
      </div>

      {/* PO Spending Chart */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" style={{ color: "#009B3A" }} />
              Purchase Order Spending
            </CardTitle>
            <CardDescription>
              {loading || spendingLoading ? (
                <Skeleton className="mt-1 h-4 w-32" />
              ) : (
                <>
                  Total:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(
                      (data?.spendingByDay ?? []).reduce((sum, d) => sum + d.total, 0)
                    )}
                  </span>{" "}
                  over {spendingDays} days
                </>
              )}
            </CardDescription>
          </div>
          {/* Day range selector — pill-style buttons */}
          <div className="flex gap-1 rounded-lg border p-1 bg-muted/50">
            {SPENDING_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => handleRangeChange(range.value)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  spendingDays === range.value
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <Skeleton className="h-[280px] w-full rounded-md" />
          ) : !data?.spendingByDay?.length ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              No PO spending data for this period.
            </div>
          ) : (
            <div className="relative h-[280px] w-full">
              {spendingLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-md">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.spendingByDay}
                  margin={{ top: 4, right: 4, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: string) => {
                      const d = new Date(v + "T00:00:00");
                      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    }}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                    }
                    width={52}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                    labelFormatter={(label) => {
                      const d = new Date(String(label) + "T00:00:00");
                      return d.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });
                    }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                    }}
                  />
                  <Bar
                    dataKey="total"
                    fill="#009B3A"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent POs & Alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Purchase Orders */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Purchase Orders</CardTitle>
            <CardDescription>Your latest PO activity</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !data?.recentPOs?.length ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No purchase orders yet. Import your inventory to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead className="hidden sm:table-cell">Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Date
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentPOs.map((po) => (
                    <TableRow
                      key={po.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/po/${po.id}`)}
                    >
                      <TableCell className="font-medium text-xs">
                        {po.poNumber}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">
                        {po.vendorName}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${STATUS_COLORS[po.status] ?? ""}`}
                        >
                          {formatStatus(po.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatCurrency(po.total)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                        {formatDate(po.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <CardDescription>Status changes and notifications</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !data?.recentAlerts?.length ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No alerts at this time.
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight">
                        {alert.poNumber}{" "}
                        <span className="font-normal text-muted-foreground">
                          {alert.fromStatus
                            ? `${formatStatus(alert.fromStatus)} -> ${formatStatus(alert.toStatus)}`
                            : formatStatus(alert.toStatus)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {alert.vendorName} &middot; {timeAgo(alert.createdAt)}
                      </p>
                      {alert.note && (
                        <p className="mt-1 text-xs text-muted-foreground truncate">
                          {alert.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="gap-2"
            style={{ borderColor: "#009B3A", color: "#009B3A" }}
            onClick={() => {
              fetch("/api/po/auto-generate", { method: "POST" })
                .then(() => fetchData())
                .catch(() => {});
            }}
          >
            <Zap className="h-4 w-4" />
            Auto-Generate POs
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            style={{ borderColor: "#FFB81C", color: "#1A1A1A" }}
            onClick={() => {
              fetch("/api/comcash/sync-vendors", { method: "POST" })
                .then(() => fetchData())
                .catch(() => {});
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Sync Vendors
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => router.push("/inventory?import=true")}
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
