import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/email/check
 *
 * Cron job endpoint to poll Gmail for new vendor emails and process them.
 *
 * PHASE 3 STUB: Gmail polling is not yet connected. This endpoint will
 * eventually:
 *   1. Use the Gmail API (via OAuth refresh token stored in AppSettings)
 *      to fetch unread emails from known vendor addresses.
 *   2. Filter for emails that match vendor domains in the Vendor table.
 *   3. For each new email, call the /api/email/parse endpoint or
 *      parseVendorEmail() directly to extract PO data.
 *   4. Mark processed emails as read / label them in Gmail.
 *   5. Return a summary of processed emails and any alerts generated.
 *
 * To manually process emails in the meantime, POST to /api/email/parse
 * with { subject, body, from, messageId }.
 */
export async function POST() {
  // Fix: Add missing requireAuth() — endpoint was unprotected
  const authError = await requireAuth();
  if (authError) return authError;

  // TODO: Implement Gmail polling
  // Steps to implement:
  // 1. Read gmailRefreshToken from AppSettings
  // 2. Exchange refresh token for access token via Google OAuth
  // 3. Call Gmail API: GET /gmail/v1/users/me/messages?q=is:unread from:({vendor_emails})
  // 4. For each message, GET /gmail/v1/users/me/messages/{id} to get full content
  // 5. Parse each email with parseVendorEmail()
  // 6. Process results (update POs, create alerts)
  // 7. Mark emails as read via Gmail API

  return NextResponse.json({
    status: "not_connected",
    message:
      "Gmail polling not yet connected. Use /api/email/parse to manually process emails.",
    instructions: [
      "POST to /api/email/parse with { subject, body, from, messageId }",
      "The parse endpoint will use AI to extract PO data and update matching purchase orders.",
    ],
  });
}
