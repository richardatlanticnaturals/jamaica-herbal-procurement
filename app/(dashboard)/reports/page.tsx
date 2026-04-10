"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  BarChart3,
  Download,
  TrendingUp,
  TrendingDown,
  PackageX,
  DollarSign,
  ArrowUpDown,
  Sliders,
  Play,
  Loader2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ProfitMarginItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  vendorName: string;
  costPrice: number;
  retailPrice: number;
  marginPercent: number;
  currentStock: number;
}

interface DeadStockItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  vendorName: string;
  currentStock: number;
  costPrice: number;
  stockValue: number;
  lastSoldAt: string | null;
}

interface TopSellerItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  totalQtySold: number;
  totalRevenue: number;
  salesCount: number;
  lastSoldAt: string | null;
}

interface CategorySummaryItem {
  category: string;
  itemCount: number;
  totalRevenue: number;
  totalQtySold: number;
}

interface VendorSummaryItem {
  id: string;
  name: string;
  poCount: number;
  totalSpend: number;
  avgItemsPerPO: number;
  avgLeadTimeDays: number;
}

interface SpendingTrendItem {
  month: string;
  label: string;
  spend: number;
  poCount: number;
}

interface InventoryValueItem {
  category: string;
  costValue: number;
  retailValue: number;
  itemCount: number;
  totalUnits: number;
}

// Chart color palette
const COLORS = ["#FFB81C", "#009B3A", "#CE1126", "#1A1A1A", "#4A90D9", "#E67E22", "#8E44AD", "#27AE60", "#C0392B", "#2980B9"];

// ─────────────────────────────────────────────
// CSV export utility
// ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function downloadCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map((row: Record<string, unknown>) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val === null || val === undefined ? "" : String(val);
          return str.includes(",") || str.includes('"')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────
function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────
// Main Reports Page
// ─────────────────────────────────────────────
export default function ReportsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-[#FFB81C]" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Procurement analytics and inventory insights
          </p>
        </div>
      </div>

      {/* Tabbed reports */}
      <Tabs defaultValue="profit-margins">
        <div className="overflow-x-auto -mx-6 px-6">
          <TabsList variant="line" className="w-full justify-start gap-1">
            <TabsTrigger value="profit-margins" className="text-xs sm:text-sm">
              Profit Margins
            </TabsTrigger>
            <TabsTrigger value="top-sellers" className="text-xs sm:text-sm">
              Top Sellers
            </TabsTrigger>
            <TabsTrigger value="dead-stock" className="text-xs sm:text-sm">
              Dead Stock
            </TabsTrigger>
            <TabsTrigger value="category" className="text-xs sm:text-sm">
              Category
            </TabsTrigger>
            <TabsTrigger value="vendors" className="text-xs sm:text-sm">
              Vendors
            </TabsTrigger>
            <TabsTrigger value="spending" className="text-xs sm:text-sm">
              Spending
            </TabsTrigger>
            <TabsTrigger value="inventory-value" className="text-xs sm:text-sm">
              Inventory Value
            </TabsTrigger>
            <TabsTrigger value="custom-report" className="text-xs sm:text-sm">
              Custom Report
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profit-margins">
          <ProfitMarginsTab />
        </TabsContent>
        <TabsContent value="top-sellers">
          <TopSellersTab />
        </TabsContent>
        <TabsContent value="dead-stock">
          <DeadStockTab />
        </TabsContent>
        <TabsContent value="category">
          <CategorySummaryTab />
        </TabsContent>
        <TabsContent value="vendors">
          <VendorSummaryTab />
        </TabsContent>
        <TabsContent value="spending">
          <SpendingTrendsTab />
        </TabsContent>
        <TabsContent value="inventory-value">
          <InventoryValueTab />
        </TabsContent>
        <TabsContent value="custom-report">
          <CustomReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Tab: Profit Margins
// ═══════════════════════════════════════════════
function ProfitMarginsTab() {
  const [data, setData] = useState<ProfitMarginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortField, setSortField] = useState<"marginPercent" | "costPrice" | "retailPrice" | "name">("marginPercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [categories, setCategories] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ type: "profit-margins", limit: "500" });
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    const res = await fetch(`/api/reports?${params}`);
    const json = await res.json();
    setData(json.data || []);
    // Extract unique categories
    const cats = [...new Set((json.data || []).map((i: ProfitMarginItem) => i.category))].sort();
    if (categoryFilter === "all") setCategories(cats as string[]);
    setLoading(false);
  }, [categoryFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
    return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function marginColor(pct: number) {
    if (pct < 20) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    if (pct <= 40) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  }

  const SortHeader = ({ field, children }: { field: typeof sortField; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-foreground"
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </span>
    </TableHead>
  );

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#009B3A]" />
            Profit Margins
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCSV(data, "profit-margins.csv")}
              disabled={!data.length}
            >
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No inventory data found</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader field="name">Item</SortHeader>
                  <TableHead>Category</TableHead>
                  <SortHeader field="costPrice">Cost</SortHeader>
                  <SortHeader field="retailPrice">Retail</SortHeader>
                  <SortHeader field="marginPercent">Margin %</SortHeader>
                  <TableHead>Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium max-w-[200px] truncate" title={item.name}>
                      {item.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(item.costPrice)}</TableCell>
                    <TableCell>{formatCurrency(item.retailPrice)}</TableCell>
                    <TableCell>
                      <Badge className={marginColor(item.marginPercent)}>
                        {item.marginPercent.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>{item.currentStock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Top Sellers
// ═══════════════════════════════════════════════
function TopSellersTab() {
  const [data, setData] = useState<TopSellerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reports?type=top-sellers&days=${days}&limit=20`);
    const json = await res.json();
    setData(json.data || []);
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#FFB81C]" />
            Top Sellers
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={(v) => setDays(v ?? "30")}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCSV(data, "top-sellers.csv")}
              disabled={!data.length}
            >
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No sales data found</div>
        ) : (
          <>
            {/* Bar chart */}
            <div className="h-[300px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.slice(0, 10)} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="name"
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                    tick={{ fontSize: 11 }}
                    height={80}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [Number(value), "Qty Sold"]}
                    labelStyle={{ fontWeight: "bold" }}
                  />
                  <Bar dataKey="totalQtySold" fill="#FFB81C" radius={[4, 4, 0, 0]} name="Qty Sold" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead>Last Sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item, i) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={item.name}>{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{item.totalQtySold}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.totalRevenue)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(item.lastSoldAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Dead Stock
// ═══════════════════════════════════════════════
function DeadStockTab() {
  const [data, setData] = useState<DeadStockItem[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/reports?type=dead-stock");
      const json = await res.json();
      setData(json.data || []);
      setTotalValue(json.totalValueTiedUp || 0);
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <PackageX className="h-5 w-5 text-[#CE1126]" />
              Dead Stock
            </CardTitle>
            {totalValue > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {formatCurrency(totalValue)} in capital tied up in unsold inventory
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(data, "dead-stock.csv")}
            disabled={!data.length}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No dead stock found -- all inventory is moving</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Stock Value</TableHead>
                  <TableHead>Last Sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium max-w-[180px] truncate" title={item.name}>{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.vendorName}</TableCell>
                    <TableCell className="text-right">{item.currentStock}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.costPrice)}</TableCell>
                    <TableCell className="text-right font-medium text-red-600">{formatCurrency(item.stockValue)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(item.lastSoldAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Category Performance
// ═══════════════════════════════════════════════
function CategorySummaryTab() {
  const [data, setData] = useState<CategorySummaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/reports?type=category-summary");
      const json = await res.json();
      setData(json.data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-lg">Category Performance</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(data, "category-summary.csv")}
            disabled={!data.length}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No category data found</div>
        ) : (
          <>
            {/* Pie chart for revenue distribution */}
            <div className="h-[300px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.filter((d) => d.totalRevenue > 0)}
                    dataKey="totalRevenue"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={(props: any) =>
                      `${props.category} (${(props.percent * 100).toFixed(0)}%)`
                    }
                    labelLine={true}
                  >
                    {data.filter((d) => d.totalRevenue > 0).map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Qty Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item) => (
                    <TableRow key={item.category}>
                      <TableCell className="font-medium">{item.category}</TableCell>
                      <TableCell className="text-right">{item.itemCount}</TableCell>
                      <TableCell className="text-right">{item.totalQtySold}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.totalRevenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Vendor Summary
// ═══════════════════════════════════════════════
function VendorSummaryTab() {
  const [data, setData] = useState<VendorSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/reports?type=vendor-summary");
      const json = await res.json();
      setData(json.data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-lg">Vendor Summary</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(data, "vendor-summary.csv")}
            disabled={!data.length}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No vendor data found</div>
        ) : (
          <>
            {/* Bar chart for spend per vendor */}
            <div className="h-[300px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.slice(0, 10)} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="name"
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                    tick={{ fontSize: 11 }}
                    height={80}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip formatter={(value) => [formatCurrency(Number(value)), "Total Spend"]} />
                  <Bar dataKey="totalSpend" fill="#009B3A" radius={[4, 4, 0, 0]} name="Total Spend" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">PO Count</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="text-right">Avg Items/PO</TableHead>
                    <TableHead className="text-right">Avg Lead Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.poCount}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.totalSpend)}</TableCell>
                      <TableCell className="text-right">{item.avgItemsPerPO}</TableCell>
                      <TableCell className="text-right">{item.avgLeadTimeDays} days</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Spending Trends
// ═══════════════════════════════════════════════
function SpendingTrendsTab() {
  const [data, setData] = useState<SpendingTrendItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/reports?type=spending-trends");
      const json = await res.json();
      setData(json.data || []);
      setLoading(false);
    })();
  }, []);

  const totalSpend = data.reduce((s, d) => s + d.spend, 0);
  const totalPOs = data.reduce((s, d) => s + d.poCount, 0);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-[#4A90D9]" />
              Spending Trends (12 Months)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {formatCurrency(totalSpend)} total across {totalPOs} purchase orders
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(data, "spending-trends.csv")}
            disabled={!data.length}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No spending data found</div>
        ) : (
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(value) => [formatCurrency(Number(value)), "Spend"]} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#FFB81C"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  name="Monthly Spend"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════
// Tab: Inventory Value
// ═══════════════════════════════════════════════
function InventoryValueTab() {
  const [data, setData] = useState<InventoryValueItem[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalRetail, setTotalRetail] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/reports?type=inventory-value");
      const json = await res.json();
      setData(json.data || []);
      setTotalCost(json.totalCostValue || 0);
      setTotalRetail(json.totalRetailValue || 0);
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-[#009B3A]" />
              Inventory Value
            </CardTitle>
            <div className="flex gap-4 mt-1">
              <p className="text-sm text-muted-foreground">
                Cost: <span className="font-medium text-foreground">{formatCurrency(totalCost)}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Retail: <span className="font-medium text-foreground">{formatCurrency(totalRetail)}</span>
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(data, "inventory-value.csv")}
            disabled={!data.length}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">No inventory data found</div>
        ) : (
          <>
            {/* Stacked bar chart: cost vs retail value per category */}
            <div className="h-[350px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="category"
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                    tick={{ fontSize: 11 }}
                    height={80}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  <Bar dataKey="costValue" stackId="value" fill="#FFB81C" name="Cost Value" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="retailValue" stackId="value" fill="#009B3A" name="Retail Value" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total Units</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead className="text-right">Retail Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item) => (
                    <TableRow key={item.category}>
                      <TableCell className="font-medium">{item.category}</TableCell>
                      <TableCell className="text-right">{item.itemCount}</TableCell>
                      <TableCell className="text-right">{item.totalUnits}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.costValue)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.retailValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ===============================================
// Tab: Custom Report Builder
// ===============================================

// Report type definitions with their available columns
const REPORT_TYPES = [
  { value: "sales-by-product", label: "Sales by Product", group: "sales" },
  { value: "sales-by-category", label: "Sales by Category", group: "sales" },
  { value: "sales-by-vendor", label: "Sales by Vendor", group: "sales" },
  { value: "inventory-by-category", label: "Inventory by Category", group: "inventory" },
  { value: "inventory-by-vendor", label: "Inventory by Vendor", group: "inventory" },
  { value: "po-spend-by-vendor", label: "PO Spend by Vendor", group: "po" },
  { value: "po-spend-by-month", label: "PO Spend by Month", group: "po" },
  { value: "profit-analysis", label: "Profit Analysis", group: "sales" },
] as const;

// Map report type -> columns it can return
const REPORT_COLUMNS: Record<string, { key: string; label: string; align?: "right" }[]> = {
  "sales-by-product": [
    { key: "productName", label: "Product Name" },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "currentStock", label: "Stock", align: "right" },
    { key: "costPrice", label: "Cost", align: "right" },
    { key: "retailPrice", label: "Retail", align: "right" },
    { key: "marginPercent", label: "Margin %", align: "right" },
    { key: "qtySold", label: "Qty Sold", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
    { key: "reorderPoint", label: "Reorder Point", align: "right" },
  ],
  "sales-by-category": [
    { key: "category", label: "Category" },
    { key: "productCount", label: "Products", align: "right" },
    { key: "qtySold", label: "Qty Sold", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
  ],
  "sales-by-vendor": [
    { key: "vendor", label: "Vendor" },
    { key: "productCount", label: "Products", align: "right" },
    { key: "qtySold", label: "Qty Sold", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
  ],
  "inventory-by-category": [
    { key: "category", label: "Category" },
    { key: "productCount", label: "Products", align: "right" },
    { key: "totalStock", label: "Total Stock", align: "right" },
    { key: "costValue", label: "Cost Value", align: "right" },
    { key: "retailValue", label: "Retail Value", align: "right" },
    { key: "lowStockCount", label: "Low Stock", align: "right" },
    { key: "outOfStockCount", label: "Out of Stock", align: "right" },
  ],
  "inventory-by-vendor": [
    { key: "vendor", label: "Vendor" },
    { key: "productCount", label: "Products", align: "right" },
    { key: "totalStock", label: "Total Stock", align: "right" },
    { key: "costValue", label: "Cost Value", align: "right" },
    { key: "retailValue", label: "Retail Value", align: "right" },
    { key: "lowStockCount", label: "Low Stock", align: "right" },
    { key: "outOfStockCount", label: "Out of Stock", align: "right" },
  ],
  "po-spend-by-vendor": [
    { key: "vendor", label: "Vendor" },
    { key: "poCount", label: "PO Count", align: "right" },
    { key: "totalSpend", label: "Total Spend", align: "right" },
    { key: "totalItems", label: "Total Items", align: "right" },
    { key: "avgPoValue", label: "Avg PO Value", align: "right" },
  ],
  "po-spend-by-month": [
    { key: "month", label: "Month" },
    { key: "poCount", label: "PO Count", align: "right" },
    { key: "totalSpend", label: "Total Spend", align: "right" },
  ],
  "profit-analysis": [
    { key: "productName", label: "Product Name" },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "vendor", label: "Vendor" },
    { key: "costPrice", label: "Cost", align: "right" },
    { key: "retailPrice", label: "Retail", align: "right" },
    { key: "marginPercent", label: "Margin %", align: "right" },
    { key: "qtySold", label: "Qty Sold", align: "right" },
    { key: "revenue", label: "Revenue", align: "right" },
    { key: "totalCost", label: "Total Cost", align: "right" },
    { key: "profit", label: "Profit", align: "right" },
    { key: "currentStock", label: "Stock", align: "right" },
    { key: "reorderPoint", label: "Reorder Point", align: "right" },
  ],
};

// Currency columns for formatting
const CURRENCY_COLUMNS = new Set([
  "costPrice", "retailPrice", "revenue", "costValue", "retailValue",
  "totalSpend", "avgPoValue", "totalCost", "profit",
]);

// Percent columns
const PERCENT_COLUMNS = new Set(["marginPercent"]);

function CustomReportTab() {
  // -- State --
  const [reportType, setReportType] = useState("sales-by-product");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [stockStatus, setStockStatus] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [maxMargin, setMaxMargin] = useState("");

  // Columns
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  // Sort
  const [customSortBy, setCustomSortBy] = useState("");
  const [customSortDir, setCustomSortDir] = useState<"asc" | "desc">("desc");

  // Results
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [customLoading, setCustomLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // Lookup data for filter dropdowns
  const [categories, setCategories] = useState<string[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);

  // Show/hide filters panel
  const [showFilters, setShowFilters] = useState(true);

  // Available columns for current report type
  const availableColumns = REPORT_COLUMNS[reportType] || [];

  // Load filter options on mount
  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const [catRes, vendorRes] = await Promise.all([
          fetch("/api/reports?type=category-summary"),
          fetch("/api/reports?type=vendor-summary"),
        ]);
        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData.data.map((c: { category: string }) => c.category));
        }
        if (vendorRes.ok) {
          const vendorData = await vendorRes.json();
          setVendors(vendorData.data.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })));
        }
      } catch {
        // Filter options are optional
      }
    }
    loadFilterOptions();
  }, []);

  // When report type changes, reset columns and select all by default
  useEffect(() => {
    const cols = REPORT_COLUMNS[reportType] || [];
    setSelectedColumns(cols.map((c) => c.key));
    setCustomSortBy("");
    setHasRun(false);
    setRows([]);
  }, [reportType]);

  // Toggle a column
  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  // Select / deselect all columns
  const toggleAllColumns = () => {
    if (selectedColumns.length === availableColumns.length) {
      setSelectedColumns([]);
    } else {
      setSelectedColumns(availableColumns.map((c) => c.key));
    }
  };

  // Run report
  const runReport = useCallback(async () => {
    setCustomLoading(true);
    setHasRun(true);
    try {
      const body: Record<string, unknown> = {
        reportType,
        dateFrom,
        dateTo,
        columns: selectedColumns,
        sortBy: customSortBy || undefined,
        sortDir: customSortDir,
        limit: 500,
        filters: {
          ...(categoryFilter.length ? { categories: categoryFilter } : {}),
          ...(vendorFilter.length ? { vendors: vendorFilter } : {}),
          ...(stockStatus !== "all" ? { stockStatus } : {}),
          ...(minPrice ? { minPrice: parseFloat(minPrice) } : {}),
          ...(maxPrice ? { maxPrice: parseFloat(maxPrice) } : {}),
          ...(minMargin ? { minMargin: parseFloat(minMargin) } : {}),
          ...(maxMargin ? { maxMargin: parseFloat(maxMargin) } : {}),
        },
      };

      const res = await fetch("/api/reports/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch report");
      }

      const data = await res.json();
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Custom report error:", err);
      setRows([]);
      setTotal(0);
    } finally {
      setCustomLoading(false);
    }
  }, [reportType, dateFrom, dateTo, selectedColumns, customSortBy, customSortDir, categoryFilter, vendorFilter, stockStatus, minPrice, maxPrice, minMargin, maxMargin]);

  // Export CSV
  const exportCSV = () => {
    if (!rows.length) return;
    const colMap = Object.fromEntries(availableColumns.map((c) => [c.key, c.label]));
    const exportRows = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of selectedColumns) {
        out[colMap[key] || key] = row[key];
      }
      return out;
    });
    downloadCSV(exportRows, `custom-report-${reportType}-${new Date().toISOString().split("T")[0]}.csv`);
  };

  // Format cell value
  const formatCellValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (CURRENCY_COLUMNS.has(key)) return formatCurrency(Number(value));
    if (PERCENT_COLUMNS.has(key)) return `${Number(value).toFixed(1)}%`;
    return String(value);
  };

  // Check which filter groups apply to current report type
  const reportGroup = REPORT_TYPES.find((r) => r.value === reportType)?.group || "sales";
  const showDateFilters = reportGroup === "sales" || reportGroup === "po";
  const showCategoryFilter = reportGroup === "sales" || reportGroup === "inventory";
  const showVendorFilter = true;
  const showStockFilter = reportGroup === "inventory";
  const showPriceFilter = reportGroup === "inventory" || reportType === "sales-by-product" || reportType === "profit-analysis";
  const showMarginFilter = reportType === "profit-analysis" || reportType === "sales-by-product";

  // Header sort click
  const handleHeaderSort = (key: string) => {
    if (customSortBy === key) {
      setCustomSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setCustomSortBy(key);
      setCustomSortDir("desc");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-[#FFB81C]" />
            <CardTitle className="text-lg">Custom Report Builder</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? "Hide Filters" : "Show Filters"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {showFilters && (
          <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
            {/* Row 1: Report Type + Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Report Type */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Report Type</Label>
                <Select value={reportType} onValueChange={(val) => { if (val) setReportType(val); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((rt) => (
                      <SelectItem key={rt.value} value={rt.value}>
                        {rt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              {showDateFilters && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date From</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
              )}

              {/* Date To */}
              {showDateFilters && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date To</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Row 2: Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Category filter */}
              {showCategoryFilter && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Category</Label>
                  <Select
                    value={categoryFilter.length === 1 ? categoryFilter[0] : "all"}
                    onValueChange={(val) =>
                      setCategoryFilter(!val || val === "all" ? [] : [val])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Vendor filter */}
              {showVendorFilter && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Vendor</Label>
                  <Select
                    value={vendorFilter.length === 1 ? vendorFilter[0] : "all"}
                    onValueChange={(val) =>
                      setVendorFilter(!val || val === "all" ? [] : [val])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Vendors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Vendors</SelectItem>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Stock Status filter */}
              {showStockFilter && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Stock Status</Label>
                  <Select value={stockStatus} onValueChange={(val) => { if (val) setStockStatus(val); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="in-stock">In Stock</SelectItem>
                      <SelectItem value="low-stock">Low Stock</SelectItem>
                      <SelectItem value="out-of-stock">Out of Stock</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Sort By */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sort By</Label>
                <div className="flex gap-1">
                  <Select
                    value={customSortBy || "default"}
                    onValueChange={(val) => setCustomSortBy(!val || val === "default" ? "" : val)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      {availableColumns.map((col) => (
                        <SelectItem key={col.key} value={col.key}>
                          {col.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setCustomSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    title={customSortDir === "asc" ? "Ascending" : "Descending"}
                  >
                    {customSortDir === "asc" ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Row 3: Min/Max filters */}
            {(showPriceFilter || showMarginFilter) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {showPriceFilter && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Min Price ($)</Label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Max Price ($)</Label>
                      <Input
                        type="number"
                        placeholder="999"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {showMarginFilter && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Min Margin (%)</Label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={minMargin}
                        onChange={(e) => setMinMargin(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Max Margin (%)</Label>
                      <Input
                        type="number"
                        placeholder="100"
                        value={maxMargin}
                        onChange={(e) => setMaxMargin(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Row 4: Column selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Columns</Label>
                <button
                  type="button"
                  className="text-xs text-[#009B3A] hover:underline"
                  onClick={toggleAllColumns}
                >
                  {selectedColumns.length === availableColumns.length
                    ? "Deselect All"
                    : "Select All"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableColumns.map((col) => {
                  const isSelected = selectedColumns.includes(col.key);
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleColumn(col.key)}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? "border-[#009B3A] bg-[#009B3A]/10 text-[#009B3A]"
                          : "border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground"
                      }`}
                    >
                      {col.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Run Report button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={runReport}
                disabled={customLoading || selectedColumns.length === 0}
                className="bg-[#009B3A] hover:bg-[#009B3A]/90 text-white"
              >
                {customLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Run Report
              </Button>
              {hasRun && rows.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              )}
              {hasRun && (
                <span className="text-xs text-muted-foreground">
                  {total} result{total !== 1 ? "s" : ""}
                  {rows.length < total ? ` (showing ${rows.length})` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Results Table */}
        {customLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Generating report...
          </div>
        )}

        {!customLoading && hasRun && rows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No data found for the selected criteria. Try adjusting your filters or date range.
          </div>
        )}

        {!customLoading && rows.length > 0 && (
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {selectedColumns.map((key) => {
                    const col = availableColumns.find((c) => c.key === key);
                    if (!col) return null;
                    const isSorted = customSortBy === key;
                    return (
                      <TableHead
                        key={key}
                        className={`cursor-pointer hover:bg-muted/50 select-none whitespace-nowrap ${
                          col.align === "right" ? "text-right" : ""
                        }`}
                        onClick={() => handleHeaderSort(key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {isSorted ? (
                            customSortDir === "asc" ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={idx}>
                    {selectedColumns.map((key) => {
                      const col = availableColumns.find((c) => c.key === key);
                      return (
                        <TableCell
                          key={key}
                          className={`whitespace-nowrap ${
                            col?.align === "right" ? "text-right" : ""
                          } ${
                            key === "profit"
                              ? Number(row[key]) >= 0
                                ? "text-green-600"
                                : "text-red-600"
                              : ""
                          } ${
                            key === "marginPercent"
                              ? Number(row[key]) < 20
                                ? "text-red-600"
                                : Number(row[key]) > 50
                                  ? "text-green-600"
                                  : ""
                              : ""
                          }`}
                        >
                          {formatCellValue(key, row[key])}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Collapsed state: quick actions */}
        {!showFilters && hasRun && rows.length > 0 && (
          <div className="flex items-center gap-3">
            <Button
              onClick={runReport}
              disabled={customLoading}
              size="sm"
              className="bg-[#009B3A] hover:bg-[#009B3A]/90 text-white"
            >
              {customLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Re-run
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <span className="text-xs text-muted-foreground">
              {total} result{total !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
