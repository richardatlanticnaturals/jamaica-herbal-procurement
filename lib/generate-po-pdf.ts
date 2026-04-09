import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";

interface LineItem {
  description: string;
  vendorSku?: string | null;
  qtyOrdered: number;
  unitCost: number | string;
  lineTotal: number | string;
  inventoryItem?: { sku?: string } | null;
}

interface PO {
  poNumber: string;
  status: string;
  createdAt: string | Date;
  expectedDate?: string | Date | null;
  notes?: string | null;
  orderMethod: string;
  subtotal: number | string;
  total: number | string;
  vendor?: {
    name: string;
    email?: string | null;
    phone?: string | null;
    contactName?: string | null;
    address?: string | null;
  } | null;
  lineItems: LineItem[];
}

export function generatePOPdf(po: PO): Buffer {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header — Jamaica Herbal branding with off-white background
  doc.setFillColor(248, 247, 244); // off-white #F8F7F4 (matches app theme)
  doc.rect(0, 0, pageWidth, 40, "F");

  // Add logo image
  try {
    const logoPath = path.join(process.cwd(), "public", "jh-logo.png");
    const logoData = fs.readFileSync(logoPath);
    const logoBase64 = logoData.toString("base64");
    doc.addImage(`data:image/png;base64,${logoBase64}`, "PNG", 14, 6, 70, 28);
  } catch {
    // Fallback text if logo not found
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("JAMAICA", 14, 18);
    doc.setTextColor(0, 155, 58);
    doc.text("HERBAL", 58, 18);
  }

  // Green accent bar below header
  doc.setFillColor(0, 155, 58);
  doc.rect(0, 40, pageWidth, 3, "F");

  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Lauderdale Lakes, FL | North Lauderdale, FL | (954) 854-2195", 14, 38);

  // PO Number and details — right side of header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 155, 58); // green
  doc.text(po.poNumber, pageWidth - 14, 14, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(`Status: ${po.status.replace(/_/g, " ")}`, pageWidth - 14, 22, { align: "right" });
  doc.text(
    `Date: ${new Date(po.createdAt).toLocaleDateString()}`,
    pageWidth - 14,
    28,
    { align: "right" }
  );

  // Reset text color
  doc.setTextColor(26, 26, 26);

  // Vendor info box
  let y = 52;
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(14, y - 4, pageWidth - 28, 34, 2, 2, "F");

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("VENDOR", 18, y + 1);

  doc.setFontSize(12);
  doc.setTextColor(26, 26, 26);
  doc.setFont("helvetica", "bold");
  doc.text(po.vendor?.name || "Unknown Vendor", 18, y + 9);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  let vendorY = y + 15;
  if (po.vendor?.contactName) {
    doc.text(`Attn: ${po.vendor.contactName}`, 18, vendorY);
    vendorY += 5;
  }
  if (po.vendor?.email) {
    doc.text(po.vendor.email, 18, vendorY);
    vendorY += 5;
  }
  if (po.vendor?.phone) {
    doc.text(po.vendor.phone, 18, vendorY);
  }

  // Expected date on right side
  if (po.expectedDate) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text("EXPECTED DELIVERY", pageWidth - 65, y + 1);
    doc.setFontSize(11);
    doc.setTextColor(26, 26, 26);
    doc.setFont("helvetica", "bold");
    doc.text(
      new Date(po.expectedDate).toLocaleDateString(),
      pageWidth - 65,
      y + 9
    );
    doc.setFont("helvetica", "normal");
  }

  // Order method on right
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("ORDER METHOD", pageWidth - 65, y + 18);
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);
  doc.text(po.orderMethod, pageWidth - 65, y + 25);

  y = 94;

  // Line items table
  if (po.lineItems.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text("No line items — this PO was imported from Comcash without item details.", 14, y + 6);
    doc.text(`PO Total: $${Number(po.total).toFixed(2)}`, 14, y + 14);
    y += 24;
  }

  const tableData = po.lineItems.map((item, i) => [
    String(i + 1),
    item.inventoryItem?.sku || item.vendorSku || "—",
    item.description.length > 50 ? item.description.substring(0, 47) + "..." : item.description,
    String(item.qtyOrdered),
    `$${Number(item.unitCost).toFixed(2)}`,
    `$${Number(item.lineTotal).toFixed(2)}`,
  ]);

  if (tableData.length > 0) autoTable(doc, {
    startY: y,
    head: [["#", "SKU", "Description", "Qty", "Unit Cost", "Total"]],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [0, 155, 58],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [26, 26, 26],
    },
    alternateRowStyles: {
      fillColor: [245, 250, 245],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 28 },
      2: { cellWidth: "auto" },
      3: { cellWidth: 15, halign: "center" },
      4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 25, halign: "right" },
    },
    margin: { left: 14, right: 14 },
  });

  // Totals
  const finalY = (doc as any).lastAutoTable?.finalY || y;
  const totalsY = finalY + 8;

  doc.setDrawColor(200, 200, 200);
  doc.line(pageWidth - 80, totalsY - 2, pageWidth - 14, totalsY - 2);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("Subtotal:", pageWidth - 80, totalsY + 4);
  doc.setTextColor(26, 26, 26);
  doc.text(`$${Number(po.subtotal).toFixed(2)}`, pageWidth - 14, totalsY + 4, {
    align: "right",
  });

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 155, 58);
  doc.text("Total:", pageWidth - 80, totalsY + 14);
  doc.text(`$${Number(po.total).toFixed(2)}`, pageWidth - 14, totalsY + 14, {
    align: "right",
  });

  // Notes
  if (po.notes) {
    const notesY = totalsY + 26;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.text("NOTES", 14, notesY);
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    doc.text(po.notes, 14, notesY + 6, { maxWidth: pageWidth - 28 });
  }

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated ${new Date().toLocaleString()} | Jamaica Herbal Procurement System`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" }
  );

  return Buffer.from(doc.output("arraybuffer"));
}
