"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Loader2, Sparkles, RotateCcw, ChevronDown, ChevronUp, Database, RefreshCw, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

// --- Types ---

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  usage?: TokenUsage;
}

// --- Suggested prompts shown when chat is empty ---
const SUGGESTED_PROMPTS = [
  { label: "Dashboard Stats", prompt: "Show me the dashboard stats" },
  { label: "Low Stock Items", prompt: "What items are low in stock?" },
  { label: "Out of Stock", prompt: "What items are out of stock?" },
  { label: "Pending POs", prompt: "Show me all pending purchase orders" },
  {
    label: "Create Restock POs",
    prompt: "Auto-generate purchase orders for all low stock items",
  },
  { label: "Top Vendors", prompt: "Which vendors do I order from the most?" },
  { label: "Sales This Week", prompt: "Show me sales data from the last 7 days" },
  { label: "Sync Inventory", prompt: "Sync products from Comcash" },
];

// --- Chat Page Component ---

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync bar state
  const [syncBarOpen, setSyncBarOpen] = useState(false);
  const [syncingStock, setSyncingStock] = useState(false);
  const [syncingSales, setSyncingSales] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncingVendors, setSyncingVendors] = useState(false);
  const [lastStockSync, setLastStockSync] = useState<string | null>(null);

  // Fetch last stock sync timestamp on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => setLastStockSync(s.lastStockSync || null))
      .catch(() => {});
  }, []);

  const handleSync = async (
    type: "stock" | "sales" | "products" | "vendors"
  ) => {
    const setLoading = {
      stock: setSyncingStock,
      sales: setSyncingSales,
      products: setSyncingProducts,
      vendors: setSyncingVendors,
    }[type];
    const endpoint = {
      stock: "/api/comcash/refresh-stock",
      sales: "/api/comcash/sync-sales",
      products: "/api/comcash/sync-products",
      vendors: "/api/comcash/sync-vendors",
    }[type];

    setLoading(true);
    try {
      await fetch(endpoint, { method: "POST" });
      if (type === "stock") {
        // Refresh the lastStockSync timestamp
        const res = await fetch("/api/settings");
        if (res.ok) {
          const s = await res.json();
          setLastStockSync(s.lastStockSync || null);
        }
      }
    } catch (err) {
      console.error(`Sync ${type} failed:`, err);
    } finally {
      setLoading(false);
    }
  };

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  // Send message handler
  const sendMessage = async (content?: string) => {
    const text = content || input.trim();
    if (!text || isLoading) return;

    const userMessage: Message = { role: "user", content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const assistantMessage: Message = {
        role: "assistant",
        content: data.content || "Sorry, I could not generate a response.",
        usage: data.usage || undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Something went wrong";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `**Error:** ${msg}. Please try again.`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
  };

  // Calculate session totals from all assistant messages with usage data
  const sessionTotals = messages.reduce(
    (acc, msg) => {
      if (msg.usage) {
        acc.totalTokens += msg.usage.totalTokens;
        acc.cost += msg.usage.cost;
      }
      return acc;
    },
    { totalTokens: 0, cost: 0 }
  );

  // Format cost for display
  const formatCost = (cost: number) => {
    if (cost < 0.01) {
      return `${(cost * 100).toFixed(1)}c`;
    }
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toLocaleString();
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">AI Procurement Assistant</h1>
            <p className="text-xs text-muted-foreground">
              Ask about inventory, POs, vendors, or sales
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {sessionTotals.totalTokens > 0 && (
            <span className="text-[11px] text-muted-foreground/70 tabular-nums">
              Session: {formatTokens(sessionTotals.totalTokens)} tokens &middot; {formatCost(sessionTotals.cost)}
            </span>
          )}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Sync Data Bar */}
      <div className="border-b">
        <button
          onClick={() => setSyncBarOpen(!syncBarOpen)}
          className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Database className="h-3 w-3" />
            <span>Sync Data</span>
            {lastStockSync && (
              <span className="text-muted-foreground/60">
                &middot; Last stock sync: {(() => {
                  const seconds = Math.floor((Date.now() - new Date(lastStockSync).getTime()) / 1000);
                  if (seconds < 60) return "just now";
                  const minutes = Math.floor(seconds / 60);
                  if (minutes < 60) return `${minutes}m ago`;
                  const hours = Math.floor(minutes / 60);
                  if (hours < 24) return `${hours}h ago`;
                  return `${Math.floor(hours / 24)}d ago`;
                })()}
              </span>
            )}
          </div>
          {syncBarOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {syncBarOpen && (
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSync("stock")}
              disabled={syncingStock}
              className="h-7 text-xs"
            >
              {syncingStock ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Database className="mr-1 h-3 w-3" />}
              Refresh Stock
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSync("sales")}
              disabled={syncingSales}
              className="h-7 text-xs"
            >
              {syncingSales ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Sync Sales
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSync("products")}
              disabled={syncingProducts}
              className="h-7 text-xs"
            >
              {syncingProducts ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Package className="mr-1 h-3 w-3" />}
              Sync Products
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSync("vendors")}
              disabled={syncingVendors}
              className="h-7 text-xs"
            >
              {syncingVendors ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Users className="mr-1 h-3 w-3" />}
              Sync Vendors
            </Button>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          /* Empty state with suggested prompts */
          <div className="flex h-full flex-col items-center justify-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">
              How can I help you today?
            </h2>
            <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
              I can query your inventory, check stock levels, manage purchase
              orders, look up vendors, and pull sales data from Comcash.
            </p>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendMessage(s.prompt)}
                  className="rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <>
                      <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_table]:w-full [&_th]:bg-muted-foreground/10 [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border [&_th]:border [&_td]:border [&_table]:border-collapse">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      {msg.usage && (
                        <p className="mt-1.5 text-[10px] text-muted-foreground/50 tabular-nums">
                          {formatCost(msg.usage.cost)} &middot; {formatTokens(msg.usage.totalTokens)} tokens
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about inventory, POs, vendors, or sales..."
              rows={1}
              disabled={isLoading}
              className="w-full resize-none rounded-xl border bg-background px-4 py-3 pr-12 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          AI responses may not always be accurate. Verify important data before
          taking action.
        </p>
      </div>
    </div>
  );
}
