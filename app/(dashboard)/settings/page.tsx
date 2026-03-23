import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Database, Mail, ShoppingBag } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure integrations and preferences
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              <CardTitle>Comcash POS</CardTitle>
            </div>
            <CardDescription>
              Connect to your Comcash POS system for inventory sync
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>API URL</Label>
              <Input placeholder="https://api.comcash.com/v1" disabled />
            </div>
            <div className="grid gap-2">
              <Label>API Key</Label>
              <Input type="password" placeholder="Enter Comcash API key" disabled />
            </div>
            <p className="text-sm text-muted-foreground">
              Contact Comcash to get API access. In the meantime, use CSV import on the Inventory page.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              <CardTitle>Gmail Integration</CardTitle>
            </div>
            <CardDescription>
              Connect Gmail to send POs and read vendor replies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled>
              Connect Gmail (Phase 2)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              <CardTitle>Shopify</CardTitle>
            </div>
            <CardDescription>
              Sync inventory levels with your Shopify store
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Store</Label>
              <Input value="jamaican-herbal.myshopify.com" disabled />
            </div>
            <p className="text-sm text-muted-foreground">
              Shopify integration is pre-configured. Inventory levels will sync automatically when receiving is confirmed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
