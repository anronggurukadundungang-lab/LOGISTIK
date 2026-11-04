import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFileBuffer, suggestMapping } from "../src/services/import.ts";

const PDF_PATH = new URL("./fixtures/servise-donor.pdf", import.meta.url);

describe("impor PDF SIMDONDAR", () => {
  it("membaca baris pengeluaran dan mengabaikan kolom harga/total", async () => {
    const parsed = await parseFileBuffer(
      fs.readFileSync(PDF_PATH),
      "servise donor.pdf",
    );

    expect(parsed.headers).toEqual([
      "Nomor Urut",
      "Nomor Dokumen",
      "Nomor Baris",
      "Tanggal Pengeluaran",
      "Kode Bagian Penerima",
      "Nama Bagian Penerima",
      "Kode Barang",
      "Nama Barang",
      "Satuan",
      "Qty Diminta",
      "Qty Keluar",
    ]);
    expect(parsed.headers.join(" ")).not.toMatch(/harga|total/i);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rows[0]).toMatchObject({
      "Nomor Dokumen": "IO26001118",
      "Nomor Baris": "1",
      "Tanggal Pengeluaran": "2026-11-02",
      "Kode Bagian Penerima": "731120220013",
      "Nama Bagian Penerima": "SERVICE DONOR",
      "Kode Barang": "2608180075",
      "Nama Barang": "POCARI PET 900ML EA",
      Satuan: "BOTOL",
      "Qty Diminta": "15",
      "Qty Keluar": "15",
    });
    expect(parsed.rows[5]?.["Kode Barang"]).toBe("2608180080");
    expect(parsed.rows[5]?.["Qty Keluar"]).toBe("15");

    const serialized = JSON.stringify(parsed.rows);
    expect(serialized).not.toContain("11.600");
    expect(serialized).not.toContain("174.000");
    expect(serialized).not.toContain("294.000");
  });

  it("menyarankan pemetaan kolom PDF tanpa kolom harga/total", async () => {
    const parsed = await parseFileBuffer(
      fs.readFileSync(PDF_PATH),
      "servise donor.pdf",
    );
    const mapping = suggestMapping(parsed.headers);

    expect(mapping).toMatchObject({
      doc_number: "Nomor Dokumen",
      line_number: "Nomor Baris",
      date: "Tanggal Pengeluaran",
      item_code: "Kode Barang",
      item_name: "Nama Barang",
      department_code: "Kode Bagian Penerima",
      department_name: "Nama Bagian Penerima",
      unit: "Satuan",
      qty_requested: "Qty Diminta",
      qty_issued: "Qty Keluar",
    });
    expect(mapping.qty_approved).toBe("");
    expect(mapping.notes).toBe("");
  });
});
