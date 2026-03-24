-- CreateEnum
CREATE TYPE "OrderMethod" AS ENUM ('EMAIL', 'PORTAL', 'PHONE', 'API');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'PARTIAL_MATCH', 'MISMATCH', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "orderMethod" "OrderMethod" NOT NULL DEFAULT 'EMAIL',
    "portalUrl" TEXT,
    "portalUsername" TEXT,
    "portalPassword" TEXT,
    "emailTemplate" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "minimumOrder" DECIMAL(10,2),
    "paymentTerms" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "comcashItemId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorSku" TEXT,
    "costPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "retailPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 5,
    "reorderQty" INTEGER NOT NULL DEFAULT 12,
    "locationLL" INTEGER NOT NULL DEFAULT 0,
    "locationNL" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'each',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "locationCode" TEXT,
    "notes" TEXT,
    "orderMethod" "OrderMethod" NOT NULL DEFAULT 'EMAIL',
    "sentAt" TIMESTAMP(3),
    "expectedDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "emailMessageId" TEXT,
    "confirmationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POLineItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "vendorSku" TEXT,
    "description" TEXT NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "outOfStockNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receiving" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT,
    "invoiceNumber" TEXT,
    "invoiceImageUrl" TEXT,
    "ocrRawText" TEXT,
    "ocrParsedData" JSONB,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receiving_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivingLineItem" (
    "id" TEXT NOT NULL,
    "receivingId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "ocrDescription" TEXT NOT NULL,
    "ocrQty" INTEGER NOT NULL,
    "ocrUnitCost" DECIMAL(10,2),
    "matchedToPoLine" BOOLEAN NOT NULL DEFAULT false,
    "matchConfidence" DOUBLE PRECISION,
    "qtyAccepted" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "ReceivingLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlternativeProduct" (
    "id" TEXT NOT NULL,
    "primaryItemId" TEXT NOT NULL,
    "altVendorId" TEXT,
    "altItemName" TEXT NOT NULL,
    "altSku" TEXT,
    "altCostPrice" DECIMAL(10,2),
    "reason" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlternativeProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POStatusLog" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "fromStatus" "POStatus",
    "toStatus" "POStatus" NOT NULL,
    "note" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "comcashApiUrl" TEXT,
    "comcashApiKey" TEXT,
    "gmailRefreshToken" TEXT,
    "autoGeneratePOs" BOOLEAN NOT NULL DEFAULT false,
    "autoSendPOs" BOOLEAN NOT NULL DEFAULT false,
    "poApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "poNumberPrefix" TEXT NOT NULL DEFAULT 'PO',
    "nextPoSequence" INTEGER NOT NULL DEFAULT 1,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastInventorySync" TIMESTAMP(3),

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineItem" ADD CONSTRAINT "POLineItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineItem" ADD CONSTRAINT "POLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receiving" ADD CONSTRAINT "Receiving_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingLineItem" ADD CONSTRAINT "ReceivingLineItem_receivingId_fkey" FOREIGN KEY ("receivingId") REFERENCES "Receiving"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingLineItem" ADD CONSTRAINT "ReceivingLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlternativeProduct" ADD CONSTRAINT "AlternativeProduct_primaryItemId_fkey" FOREIGN KEY ("primaryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlternativeProduct" ADD CONSTRAINT "AlternativeProduct_altVendorId_fkey" FOREIGN KEY ("altVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POStatusLog" ADD CONSTRAINT "POStatusLog_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
