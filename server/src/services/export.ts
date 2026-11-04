import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportData, ReportColumn } from "./reports.ts";
import { formatDateId, formatNumber } from "../lib/utils.ts";

function cellText(column: ReportColumn, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (column.type === "date") return formatDateId(String(value));
  if (column.type === "datetime") {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date(String(value)));
  }
  if (column.type === "qty" || column.type === "number")
    return formatNumber(Number(value), 3);
  return String(value);
}

export async function reportToExcel(report: ReportData): Promise<Buffer> {
  {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = report.generatedBy;
    workbook.created = new Date(report.generatedAt);
    const sheet = workbook.addWorksheet("Laporan", {
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
      },
      views: [{ state: "frozen", ySplit: 6 }],
    });

    sheet.mergeCells(1, 1, 1, report.columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = report.title;
    titleCell.font = { size: 14, bold: true };
    sheet.getRow(1).height = 24;

    sheet.mergeCells(2, 1, 2, report.columns.length);
    sheet.getCell(2, 1).value = report.subtitle;
    sheet.getCell(2, 1).font = {
      size: 10,
      italic: true,
      color: { argb: "FF475569" },
    };

    sheet.mergeCells(3, 1, 3, report.columns.length);
    sheet.getCell(3, 1).value = report.filterLabels
      .map((item) => `${item.label}: ${item.value}`)
      .join("   |   ");
    sheet.getCell(3, 1).font = { size: 9 };

    sheet.mergeCells(4, 1, 4, report.columns.length);
    sheet.getCell(4, 1).value =
      `Dibuat: ${new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(report.generatedAt))} oleh ${report.generatedBy}`;
    sheet.getCell(4, 1).font = { size: 9, color: { argb: "FF64748B" } };

    const headerRow = sheet.getRow(6);
    report.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F766E" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });
    headerRow.height = 28;
    sheet.columns = report.columns.map((column) => ({
      width: column.width ?? 16,
    }));

    report.rows.forEach((row, rowIndex) => {
      const excelRow = sheet.addRow(
        report.columns.map((column) => row[column.key] ?? null),
      );
      excelRow.eachCell((cell, colNumber) => {
        const column = report.columns[colNumber - 1];
        cell.font = { size: 9 };
        cell.border = {
          top: { style: "hair", color: { argb: "FFE2E8F0" } },
          left: { style: "hair", color: { argb: "FFE2E8F0" } },
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
          right: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
        if (column?.type === "qty" || column?.type === "number") {
          cell.numFmt = "#,##0.###";
          cell.alignment = { horizontal: "right" };
        }
        if (rowIndex % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" },
          };
        }
      });
    });

    if (report.rows.length === 0) {
      const row = sheet.addRow(["Tidak ada data pada filter yang dipilih."]);
      sheet.mergeCells(row.number, 1, row.number, report.columns.length);
      row.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
    }

    const summaryStart = sheet.rowCount + 2;
    sheet.getCell(summaryStart, 1).value = "Ringkasan";
    sheet.getCell(summaryStart, 1).font = { bold: true, size: 10 };
    report.summary.forEach((item, index) => {
      const row = sheet.getRow(summaryStart + 1 + index);
      row.getCell(1).value = item.label;
      row.getCell(1).font = { size: 9, bold: true };
      row.getCell(2).value = item.value;
      row.getCell(2).font = { size: 9 };
      row.getCell(2).numFmt = "#,##0.###";
    });

    if (report.rows.length) {
      sheet.autoFilter = {
        from: { row: 6, column: 1 },
        to: { row: 6, column: report.columns.length },
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export function reportToPdf(report: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: { top: 30, bottom: 36, left: 28, right: 28 },
        bufferPages: true,
        info: { Title: report.title, Author: report.generatedBy },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const totalWeight = report.columns.reduce(
        (total, column) => total + (column.width ?? 14),
        0,
      );
      const widths = report.columns.map(
        (column) => ((column.width ?? 14) / totalWeight) * pageWidth,
      );
      const startX = doc.page.margins.left;
      const fontSize = 7;
      const cellPadding = 3;

      const drawHeader = () => {
        doc
          .fillColor("#0f766e")
          .font("Helvetica-Bold")
          .fontSize(13)
          .text(report.title, startX, doc.page.margins.top);
        doc
          .fillColor("#475569")
          .font("Helvetica")
          .fontSize(8)
          .text(report.subtitle, startX, doc.y + 1);
        doc
          .fillColor("#64748b")
          .fontSize(7)
          .text(
            report.filterLabels
              .map((item) => `${item.label}: ${item.value}`)
              .join("   |   "),
            startX,
            doc.y + 1,
          );
        doc
          .fillColor("#64748b")
          .fontSize(7)
          .text(
            `Dibuat ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(report.generatedAt))} oleh ${report.generatedBy}`,
            startX,
            doc.y,
          );
        doc.moveDown(0.5);
        drawTableHeader();
      };

      const drawTableHeader = () => {
        const y = doc.y;
        const rowHeight = 18;
        doc.rect(startX, y, pageWidth, rowHeight).fill("#0f766e");
        let x = startX;
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);
        report.columns.forEach((column, index) => {
          doc.text(column.header, x + cellPadding, y + 4, {
            width: widths[index] - cellPadding * 2,
            height: rowHeight - 4,
            ellipsis: true,
          });
          x += widths[index];
        });
        doc.y = y + rowHeight;
        doc.fillColor("#0f172a").font("Helvetica").fontSize(fontSize);
      };

      drawHeader();

      for (let rowIndex = 0; rowIndex < report.rows.length; rowIndex += 1) {
        const row = report.rows[rowIndex];
        const texts = report.columns.map((column) =>
          cellText(column, row[column.key]),
        );
        const heights = texts.map((text, index) =>
          doc.heightOfString(text, {
            width: widths[index] - cellPadding * 2,
            align: "left",
          }),
        );
        const rowHeight = Math.max(14, Math.min(46, Math.max(...heights) + 5));
        if (
          doc.y + rowHeight >
          doc.page.height - doc.page.margins.bottom - 18
        ) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (rowIndex % 2 === 1) {
          doc.rect(startX, y, pageWidth, rowHeight).fill("#f8fafc");
        }
        let x = startX;
        doc.fillColor("#0f172a").font("Helvetica").fontSize(fontSize);
        report.columns.forEach((column, index) => {
          doc.text(texts[index], x + cellPadding, y + 2.5, {
            width: widths[index] - cellPadding * 2,
            height: rowHeight - 4,
            ellipsis: true,
            align:
              column.type === "qty" || column.type === "number"
                ? "right"
                : "left",
          });
          x += widths[index];
        });
        doc
          .moveTo(startX, y + rowHeight)
          .lineTo(startX + pageWidth, y + rowHeight)
          .strokeColor("#e2e8f0")
          .lineWidth(0.5)
          .stroke();
        doc.y = y + rowHeight;
      }

      if (!report.rows.length) {
        doc
          .moveDown(1)
          .fillColor("#64748b")
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text("Tidak ada data pada filter yang dipilih.", startX, doc.y);
      }

      doc.moveDown(1);
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
      }
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Ringkasan", startX, doc.y);
      doc.font("Helvetica").fontSize(8);
      report.summary.forEach((item) => {
        doc.text(`${item.label}: ${item.value}`, startX, doc.y + 1);
      });

      const range = doc.bufferedPageRange();
      for (
        let page = range.start;
        page < range.start + range.count;
        page += 1
      ) {
        doc.switchToPage(page);
        const footerY = doc.page.height - 22;
        doc.fillColor("#94a3b8").font("Helvetica").fontSize(7);
        doc.text(
          `Halaman ${page - range.start + 1} dari ${range.count}`,
          startX,
          footerY,
          {
            width: pageWidth,
            align: "right",
            lineBreak: false,
          },
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
