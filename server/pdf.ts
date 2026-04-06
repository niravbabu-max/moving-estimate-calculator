import PDFDocument from "pdfkit";
import type { Response } from "express";

interface QuoteData {
  customerName: string;
  moveType: string;
  weightLbs: number;
  hourlyRate: number;
  trucks26ft: number;
  trucks17ft: number;
  numMovers: number;
  numHours: number;
  totalLaborHours: number;
  laborCost: number;
  uhaulCost: number | null;
  totalEstimate: number;
  notes: string | null;
  quoteDate: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  truckSize?: string;
  tripType?: string;
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function generateQuotePDF(res: Response, data: QuoteData) {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 50, bottom: 0, left: 55, right: 55 },
    info: { Title: `Moving Quote - ${data.customerName}`, Author: "Moves For Less" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Moves-For-Less-Quote-${data.customerName.replace(/[^a-zA-Z0-9]/g, "-")}.pdf"`);
  doc.pipe(res);

  const W = 502; // 612 - 55 - 55
  const brandBlue = "#1a4a7a";
  const brandDark = "#0f2e4d";
  const orange = "#e87a1e";
  const ltGray = "#f5f7fa";
  const mdGray = "#e1e5eb";
  const dark = "#1a1a1a";
  const muted = "#5a6474";

  // Helper: draw text at exact position, no line-break, no cursor advance
  function t(text: string, x: number, y: number, opts: any = {}) {
    doc.text(text, x, y, { lineBreak: false, ...opts });
  }

  // Helper: right-aligned text at Y
  function tr(text: string, y: number) {
    const tw = doc.widthOfString(text);
    t(text, 55 + W - tw, y);
  }

  // ── HEADER ──
  doc.rect(0, 0, 612, 120).fill(brandDark);

  doc.font("Helvetica-Bold").fontSize(26).fillColor("#ffffff");
  t("MOVES FOR LESS", 55, 32);

  doc.font("Helvetica").fontSize(10).fillColor("#a8c4e0");
  t("Professional Moving Services  |  Greater Metro Area", 55, 64);

  doc.font("Helvetica").fontSize(9).fillColor("#c8ddf0");
  tr("(301) 635-4345", 32);
  tr("www.movesforless.com", 44);
  tr("Upper Marlboro & Baltimore, MD", 56);

  doc.rect(0, 120, 612, 4).fill(orange);

  // ── TITLE ──
  let y = 146;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(brandBlue);
  t("MOVING ESTIMATE", 55, y);

  y += 28;
  doc.font("Helvetica").fontSize(10).fillColor(muted);
  t(`Date: ${fmtDate(data.quoteDate)}`, 55, y);
  tr(`Quote #: MFL-${Date.now().toString(36).toUpperCase().slice(-6)}`, y);

  // ── CUSTOMER ──
  y += 30;
  doc.rect(55, y, W, 48).lineWidth(0.5).strokeColor(mdGray).fillAndStroke(ltGray, mdGray);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(muted);
  t("PREPARED FOR", 70, y + 10);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(dark);
  t(data.customerName, 70, y + 25);

  // ── MOVE DETAILS ──
  y += 64;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(brandBlue);
  t("MOVE DETAILS", 55, y);
  doc.rect(55, y + 16, 60, 2).fill(orange);

  y += 26;

  function row(label: string, value: string, yp: number, bg = false) {
    if (bg) doc.rect(55, yp - 3, W, 20).fill(ltGray);
    doc.font("Helvetica").fontSize(10).fillColor(muted);
    t(label, 70, yp);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(dark);
    tr(value, yp);
    return yp + 22;
  }

  y = row("Move Type", data.moveType === "long_distance" ? "Long Distance" : "Local Move", y, true);
  y = row("Estimated Weight", `${data.weightLbs.toLocaleString()} lbs`, y);

  const trucks: string[] = [];
  if (data.trucks26ft > 0) trucks.push(`${data.trucks26ft}x 26 ft truck`);
  if (data.trucks17ft > 0) trucks.push(`${data.trucks17ft}x 17 ft truck`);
  y = row("Trucks Required", trucks.join(" + ") || "—", y, true);
  y = row("Number of Movers", String(data.numMovers), y);
  y = row("Estimated Hours", `${data.numHours} hours`, y, true);
  y = row("Total Labor Hours", `${data.totalLaborHours} hrs (${data.numMovers} movers × ${data.numHours} hrs)`, y);

  if (data.moveType === "long_distance") {
    if (data.pickupLocation) { y += 2; y = row("Pickup Location", data.pickupLocation, y, true); }
    if (data.dropoffLocation) y = row("Drop-off Location", data.dropoffLocation, y);
    if (data.truckSize) y = row("U-Haul Truck Size", data.truckSize, y, true);
    if (data.tripType) y = row("Trip Type", data.tripType === "one_way" ? "One Way" : "Return to Same Location", y);
  }

  // ── PRICING ──
  y += 12;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(brandBlue);
  t("PRICING", 55, y);
  doc.rect(55, y + 16, 44, 2).fill(orange);
  y += 26;

  doc.font("Helvetica").fontSize(10).fillColor(muted);
  t("Hourly Rate", 70, y);
  doc.fillColor(dark);
  tr(`${fmt(data.hourlyRate)} / hr per mover`, y);
  y += 22;

  doc.rect(55, y - 3, W, 20).fill(ltGray);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(muted);
  t("Labor Cost", 70, y);
  doc.fillColor(dark);
  tr(fmt(data.laborCost), y);
  y += 22;

  if (data.moveType === "long_distance" && data.uhaulCost && data.uhaulCost > 0) {
    doc.font("Helvetica").fontSize(10).fillColor(muted);
    t("U-Haul Truck Rental", 70, y);
    doc.fillColor(dark);
    tr(fmt(data.uhaulCost), y);
    y += 22;
  }

  // Total bar
  y += 4;
  doc.rect(55, y - 4, W, 28).fill(brandDark);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff");
  t("TOTAL ESTIMATE", 70, y);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff");
  tr(fmt(data.totalEstimate), y - 1);
  y += 34;

  // ── NOTES ──
  if (data.notes && y < 680) {
    y += 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted);
    t("NOTES", 55, y);
    y += 14;
    doc.font("Helvetica").fontSize(9.5).fillColor(dark);
    // Manually wrap notes into lines to avoid PDFKit cursor advancing past page
    const maxNotesW = W - 30;
    const maxLines = Math.min(3, Math.floor((700 - y) / 13)); // up to 3 lines, space permitting
    const words = data.notes.split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      const test = currentLine ? currentLine + " " + word : word;
      if (doc.widthOfString(test) > maxNotesW && currentLine) {
        lines.push(currentLine);
        currentLine = word;
        if (lines.length >= maxLines) break;
      } else {
        currentLine = test;
      }
    }
    if (currentLine && lines.length < maxLines) lines.push(currentLine);
    // If text was truncated, add ellipsis to last line
    if (lines.length >= maxLines && words.length > lines.join(" ").split(" ").length) {
      let last = lines[lines.length - 1];
      while (last.length > 0 && doc.widthOfString(last + "...") > maxNotesW) {
        last = last.slice(0, last.lastIndexOf(" ") || -1);
      }
      lines[lines.length - 1] = last + "...";
    }
    for (const line of lines) {
      t(line, 70, y);
      y += 13;
    }
    y += 3;
  }

  // ── DISCLAIMER ──
  const footerTop = 742;
  if (y < footerTop - 40) {
    y += 14;
    doc.rect(55, y, W, 0.5).fill(mdGray);
    y += 8;
    doc.font("Helvetica").fontSize(7.5).fillColor(muted);
    const d1 = "This estimate is based on information provided and is subject to change. Additional charges";
    const d2 = "may apply for stairs, long carries, heavy items, or packing materials. Final pricing confirmed";
    const d3 = "on move day. This quote is valid for 30 days from the date above.";
    t(d1, 55, y);
    t(d2, 55, y + 10);
    t(d3, 55, y + 20);
  }

  // ── FOOTER ──
  doc.rect(0, footerTop, 612, 50).fill(brandDark);

  const f1 = "Moves For Less  |  Greater Metro Area";
  const f2 = "(301) 635-4345  |  www.movesforless.com  |  Upper Marlboro & Baltimore, MD";

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  t(f1, (612 - doc.widthOfString(f1)) / 2, footerTop + 12);

  doc.font("Helvetica").fontSize(8).fillColor("#a8c4e0");
  t(f2, (612 - doc.widthOfString(f2)) / 2, footerTop + 28);

  doc.end();
}
