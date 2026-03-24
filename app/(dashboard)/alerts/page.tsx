"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Truck,
  ArrowRight,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

interface AlertItem {
  id: string;
  type: "oos" | "confirmed" | "partial" | "rejected" | "status_change" | "delivery";
  message: string;
  severity: "red" | "green" | "yellow" | "blue";
  poId: string;
  poNumber: string;
  vendorName: string | null;
  createdAt: string;
  details: string | null;
}

const severityConfig: Record<
  string,
  { bg: string; border: string; icon: typeof Bell; label: string }
> = {
  red: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: XCircle,
    label: "Critical",
  },
  green: {
    bg: "bg-green-50",
    border: "border-green-200",
    icon: CheckCircle,
    label: "Success",
  },
  yellow: {
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    icon: AlertTriangle,
    label: "Warning",
  },
  blue: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: Truck,
    label: "Info",
  },
};

const severityBadgeColors: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
  blue: "bg-blue-100 text-blue-700",
};

const typeLabels: Record<string, string> = {
  oos: "Out of Stock",
  confirmed: "Confirmed",
  partial: "Partial",
  rejected: "Rejected",
  status_change: "Status Change",
  delivery: "Delivered",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts?days=7");
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error("Failed to load alerts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleDismiss = (alertId: string) => {
    setDismissed((prev) => new Set(prev).add(alertId));
  };

  const visibleAlerts = alerts
    .filter((a) => !dismissed.has(a.id))
    .filter((a) => !filter || a.severity === filter);

  const counts = {
    red: alerts.filter((a) => a.severity === "red" && !dismissed.has(a.id)).length,
    yellow: alerts.filter((a) => a.severity === "yellow" && !dismissed.has(a.id)).length,
    green: alerts.filter((a) => a.severity === "green" && !dismissed.has(a.id)).length,
    blue: alerts.filter((a) => a.severity === "blue" && !dismissed.has(a.id)).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground">
            Out-of-stock notices, delivery confirmations, and PO status changes
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadAlerts}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard
          label="Out of Stock"
          count={counts.red}
          color="red"
          active={filter === "red"}
          onClick={() => setFilter(filter === "red" ? null : "red")}
        />
        <SummaryCard
          label="Partial"
          count={counts.yellow}
          color="yellow"
          active={filter === "yellow"}
          onClick={() => setFilter(filter === "yellow" ? null : "yellow")}
        />
        <SummaryCard
          label="Confirmed"
          count={counts.green}
          color="green"
          active={filter === "green"}
          onClick={() => setFilter(filter === "green" ? null : "green")}
        />
        <SummaryCard
          label="Updates"
          count={counts.blue}
          color="blue"
          active={filter === "blue"}
          onClick={() => setFilter(filter === "blue" ? null : "blue")}
        />
      </div>

      {/* Filter indicator */}
      {filter && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          Showing {severityConfig[filter]?.label || filter} alerts only
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setFilter(null)}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Alerts List */}
      {loading && alerts.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
            Loading alerts...
          </CardContent>
        </Card>
      ) : visibleAlerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              {filter ? "No matching alerts" : "No alerts"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              {filter
                ? "Try clearing the filter to see all alerts."
                : "No alerts in the last 7 days. Alerts are generated when vendor emails are processed."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDismiss={() => handleDismiss(alert.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const config = severityConfig[color] || severityConfig.blue;
  const Icon = config.icon;

  return (
    <Card
      className={`cursor-pointer transition-all ${
        active ? `ring-2 ring-offset-1 ${config.border}` : ""
      } hover:shadow-md`}
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${config.bg}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{count}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertCard({
  alert,
  onDismiss,
}: {
  alert: AlertItem;
  onDismiss: () => void;
}) {
  const config = severityConfig[alert.severity] || severityConfig.blue;
  const Icon = config.icon;

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={severityBadgeColors[alert.severity] || ""}>
                {typeLabels[alert.type] || alert.type}
              </Badge>
              {alert.vendorName && (
                <span className="text-xs text-muted-foreground">
                  {alert.vendorName}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                {formatRelativeTime(alert.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-medium">{alert.message}</p>
            {alert.details && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {alert.details}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Link href={`/po/${alert.poId}`}>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  View PO
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
              {alert.type === "oos" && (
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Find Alternative
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs ml-auto"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
