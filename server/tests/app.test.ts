import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

type Agent = ReturnType<typeof request.agent>;
let app: Express;
let admin: Agent;
let csrf = "";
let adminAgent: Agent;
let aftapId = 0;
let otherDeptId = 0;
let pcsUnitId = 0;
let itemId = 0;
let date = "";
let receiptTxnId = 0;
let duplicateBatchId = 0;
let csrfNoHeaderStatus = 0;
let picAgent: Agent;
let kepalaAgent: Agent;
let opnameId = 0;
let opnameDetailId = 0;
let opnameApprovalId = 0;

function api(agent: Agent, method: "get" | "post" | "patch" | "delete", path: string) {
  const req = agent[method](path);
  return method === "get" ? req : req.set("X-CSRF-Token", csrf);
}

async function login(username: string, password: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ username, password })
    .expect(200);
  // Setiap agen memakai token CSRF sesinya sendiri.
  const token = res.body.user.csrfToken as string;
  (agent as unknown as { csrfToken: string }).csrfToken = token;
  return agent;
}

function agentCsrf(agent: Agent): string {
  return (agent as unknown as { csrfToken: string }).csrfToken;
}

function uploadCsv(agent: Agent, csv: string, filename: string) {
  return agent
    .post("/api/imports/upload")
    .set("X-CSRF-Token", agentCsrf(agent))
    .attach("file", Buffer.from(csv, "utf8"), filename);
}

const CSV = [
  "Nomor Dokumen,Nomor Baris,Tanggal,Kode Barang,Nama Barang,Bagian Penerima,Satuan,Qty Diminta,Qty Disetujui,Qty Keluar,Keterangan",
  `SIM-001,1,${new Date().toISOString().slice(0, 10)},TST-001,Barang Uji Integrasi,Aftap,PCS,10,10,10,Uji impor otomatis`,
].join("\n");

const MAPPING = {
  doc_number: "Nomor Dokumen",
  line_number: "Nomor Baris",
  date: "Tanggal",
  item_code: "Kode Barang",
  item_name: "Nama Barang",
  department_name: "Bagian Penerima",
  unit: "Satuan",
  qty_requested: "Qty Diminta",
  qty_approved: "Qty Disetujui",
  qty_issued: "Qty Keluar",
  notes: "Keterangan",
};

beforeAll(async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "integration-test-secret";
  const { createApp, bootstrap } = await import("../src/app.ts");
  bootstrap();
  app = createApp();
  date = new Date().toISOString().slice(0, 10);

  admin = await login("admin", "Admin#12345");
  adminAgent = admin;
  csrf = agentCsrf(admin);

  const meta = await api(admin, "get", "/api/meta").expect(200);
  const aftap = meta.body.departments.find(
    (d: { name: string }) => d.name === "Aftap",
  );
  const other = meta.body.departments.find(
    (d: { name: string }) => d.name === "Mobile Unit",
  );
  const pcs = meta.body.units.find((u: { code: string }) => u.code === "PCS");
  aftapId = aftap.id;
  otherDeptId = other.id;
  pcsUnitId = pcs.id;

  const item = await api(admin, "post", "/api/items")
    .send({
      code: "TST-001",
      name: "Barang Uji Integrasi",
      baseUnitId: pcsUnitId,
      minStock: 2,
    })
    .expect(201);
  itemId = item.body.item.id;

  const roles = await api(admin, "get", "/api/roles").expect(200);
  const kepalaRole = roles.body.items.find(
    (r: { code: string }) => r.code === "KEPALA_BAGIAN",
  );
  const picRole = roles.body.items.find((r: { code: string }) => r.code === "PIC");

  await api(admin, "post", "/api/users")
    .send({
      username: "kepala.aftap",
      name: "Kepala Aftap Uji",
      password: "Kepala#12345",
      roleId: kepalaRole.id,
      departmentIds: [aftapId],
    })
    .expect(201);
  kepalaAgent = await login("kepala.aftap", "Kepala#12345");

  await api(admin, "post", "/api/users")
    .send({
      username: "pic.aftap",
      name: "PIC Aftap Uji",
      password: "Pic#123456",
      roleId: picRole.id,
      departmentIds: [aftapId],
    })
    .expect(201);
  picAgent = await login("pic.aftap", "Pic#123456");
}, 60_000);

afterAll(async () => {
  const { closeDb } = await import("../src/db.ts");
  closeDb();
});

describe("sistem monitoring stok", () => {
  it("menyajikan health check tanpa autentikasi", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("menolak akses tanpa sesi", async () => {
    await request(app).get("/api/stocks").expect(401);
  });

  it("login mengembalikan role, permission, dan token CSRF", async () => {
    const res = await api(admin, "get", "/api/auth/me").expect(200);
    expect(res.body.user.role.code).toBe("SUPER_ADMIN");
    expect(res.body.user.permissions).toContain("imports.manage");
    expect(res.body.departments).toHaveLength(23);
    expect(csrf).toBeTruthy();
  });

  it("menolak mutasi tanpa token CSRF", async () => {
    const res = await picAgent
      .post("/api/consumptions")
      .send({
        departmentId: aftapId,
        occurredAt: date,
        lines: [{ itemId, qty: 1 }],
      })
      .expect(403);
    csrfNoHeaderStatus = res.status;
    expect(csrfNoHeaderStatus).toBe(403);
  });

  it("mengimpor CSV, memetakan kolom, dan memvalidasi baris", async () => {
    const upload = await uploadCsv(admin, CSV, "uji-integrasi.csv").expect(201);
    expect(upload.body.totalRows).toBe(1);
    expect(upload.body.mapping.date).toBe("Tanggal");

    const validated = await api(
      admin,
      "post",
      `/api/imports/${upload.body.batchId}/validate`,
    )
      .send({ mapping: MAPPING })
      .expect(200);
    expect(validated.body.counts.valid).toBe(1);
    expect(validated.body.preview.batch.created_by_name).toBe(
      "Administrator Sistem",
    );

    const committed = await api(
      admin,
      "post",
      `/api/imports/${upload.body.batchId}/commit`,
    )
      .send({})
      .expect(200);
    expect(committed.body.imported).toBe(1);
    expect(committed.body.awaitingReceipt).toBe(1);

    const receipts = await api(
      admin,
      "get",
      `/api/receipts?status=AWAITING_RECEIPT&departmentId=${aftapId}`,
    ).expect(200);
    const txn = receipts.body.items.find(
      (row: { item_id: number }) => row.item_id === itemId,
    );
    expect(txn).toBeTruthy();
    receiptTxnId = txn.id;
  });

  it("mengonfirmasi penerimaan dan menambah saldo", async () => {
    await api(admin, "post", `/api/receipts/${receiptTxnId}/confirm`)
      .send({ qtyReceived: 10 })
      .expect(200);

    const stock = await api(
      admin,
      "get",
      `/api/stocks?itemId=${itemId}&departmentId=${aftapId}`,
    ).expect(200);
    expect(stock.body.items[0].qty).toBe(10);
    expect(stock.body.items[0].received_total).toBe(10);
  });

  it("mencatat pemakaian multi-baris dan menolak stok negatif", async () => {
    const over = await api(admin, "post", "/api/consumptions")
      .send({
        departmentId: aftapId,
        occurredAt: date,
        lines: [{ itemId, qty: 11 }],
      })
      .expect(422);
    expect(over.body.error).toMatch(/stok/i);

    await api(admin, "post", "/api/consumptions")
      .send({
        departmentId: aftapId,
        occurredAt: date,
        activityCategory: "Operasional",
        lines: [
          { itemId, qty: 2, notes: "Baris satu" },
          { itemId, qty: 3, notes: "Baris dua" },
        ],
      })
      .expect(201);

    const stock = await api(
      admin,
      "get",
      `/api/stocks?itemId=${itemId}&departmentId=${aftapId}`,
    ).expect(200);
    expect(stock.body.items[0].qty).toBe(5);
    expect(stock.body.items[0].consumption_total).toBe(5);

    const card = await api(
      admin,
      "get",
      `/api/stock-entries?itemId=${itemId}&departmentId=${aftapId}`,
    ).expect(200);
    expect(card.body.items.length).toBe(3);
  });

  it("menolak impor duplikat berdasarkan identitas dokumen", async () => {
    const upload = await uploadCsv(admin, CSV, "uji-duplikat.csv").expect(201);
    duplicateBatchId = upload.body.batchId;
    const validated = await api(
      admin,
      "post",
      `/api/imports/${upload.body.batchId}/validate`,
    )
      .send({ mapping: MAPPING })
      .expect(200);
    expect(validated.body.counts.duplicate).toBe(1);

    const committed = await api(
      admin,
      "post",
      `/api/imports/${upload.body.batchId}/commit`,
    )
      .send({})
      .expect(200);
    expect(committed.body.imported).toBe(0);
    expect(committed.body.skipped).toBe(1);
  });

  it("membuat barang dan bagian otomatis saat impor bila opsi autoCreate aktif", async () => {
    const autoCsv = [
      "Nomor Dokumen,Nomor Baris,Tanggal,Kode Barang,Nama Barang,Bagian Penerima,Satuan,Qty Diminta,Qty Disetujui,Qty Keluar,Keterangan",
      `AUTO-001,1,${date},AUTO-001,Barang Dibuat Otomatis,Bagian Dibuat Otomatis,PCS,5,5,5,uji auto-create`,
    ].join("\n");

    // Tanpa autoCreate: baris gagal validasi karena master belum ada.
    const rejected = await uploadCsv(admin, autoCsv, "uji-tanpa-autocreate.csv").expect(201);
    const rejectedValidated = await api(
      admin,
      "post",
      `/api/imports/${rejected.body.batchId}/validate`,
    )
      .send({ mapping: MAPPING })
      .expect(200);
    expect(rejectedValidated.body.counts.error).toBe(1);
    expect(rejectedValidated.body.createdItems).toBe(0);
    expect(rejectedValidated.body.createdDepartments).toBe(0);

    // Dengan autoCreate: master dibuat otomatis dan baris masuk peringatan.
    const accepted = await uploadCsv(admin, autoCsv, "uji-autocreate.csv").expect(201);
    const validated = await api(
      admin,
      "post",
      `/api/imports/${accepted.body.batchId}/validate`,
    )
      .send({ mapping: MAPPING, autoCreate: true })
      .expect(200);
    expect(validated.body.createdItems).toBe(1);
    expect(validated.body.createdDepartments).toBe(1);
    expect(validated.body.counts.error).toBe(0);
    expect(validated.body.counts.warning).toBe(1);
    expect(validated.body.preview.batch.auto_create).toBe(1);

    const committed = await api(
      admin,
      "post",
      `/api/imports/${accepted.body.batchId}/commit`,
    )
      .send({})
      .expect(200);
    expect(committed.body.imported).toBe(1);
    expect(committed.body.awaitingReceipt).toBe(1);
  });

  it("menerapkan RBAC dan pembatasan bagian", async () => {
    await picAgent.get("/api/imports").expect(403);
    await picAgent
      .post("/api/imports/upload")
      .set("X-CSRF-Token", agentCsrf(picAgent))
      .attach("file", Buffer.from(CSV, "utf8"), "ditolak.csv")
      .expect(403);
    await picAgent
      .get(`/api/stocks?departmentId=${otherDeptId}`)
      .expect(403);
    const own = await picAgent
      .get(`/api/stocks?departmentId=${aftapId}`)
      .expect(200);
    expect(own.body.items[0].item_id).toBe(itemId);
  });

  it("membuat opname, mengajukan, dan tidak mengubah saldo sebelum disetujui", async () => {
    const created = await api(admin, "post", "/api/opnames")
      .send({ departmentId: aftapId, opnameDate: date, notes: "Uji opname" })
      .expect(201);
    opnameId = created.body.id;
    expect(created.body.itemCount).toBeGreaterThan(0);

    const detail = await api(admin, "get", `/api/opnames/${opnameId}`).expect(200);
    const row = detail.body.details.find(
      (d: { item_id: number }) => d.item_id === itemId,
    );
    expect(row.system_qty).toBe(5);
    opnameDetailId = row.id;

    await api(admin, "patch", `/api/opnames/${opnameId}/details/${opnameDetailId}`)
      .send({ physicalQty: 4, reason: "Selisih uji integrasi" })
      .expect(200);

    // Semua barang lain harus diisi agar submit lolos validasi kelengkapan.
    for (const d of detail.body.details) {
      if (d.id === opnameDetailId) continue;
      await api(admin, "patch", `/api/opnames/${opnameId}/details/${d.id}`)
        .send({ physicalQty: d.system_qty })
        .expect(200);
    }

    const submitted = await api(admin, "post", `/api/opnames/${opnameId}/submit`)
      .send({})
      .expect(200);
    expect(submitted.body.diffCount).toBe(1);
    opnameApprovalId = submitted.body.approvalId;

    const stock = await api(
      admin,
      "get",
      `/api/stocks?itemId=${itemId}&departmentId=${aftapId}`,
    ).expect(200);
    expect(stock.body.items[0].qty).toBe(5);
  });

  it("melarang pengaju menyetujui pengajuannya sendiri", async () => {
    await api(admin, "post", `/api/approvals/${opnameApprovalId}/approve`)
      .send({})
      .expect(403);
  });

  it("menyetujui opname dan membukukan selisih ke ledger", async () => {
    const approved = await kepalaAgent
      .post(`/api/approvals/${opnameApprovalId}/approve`)
      .set("X-CSRF-Token", agentCsrf(kepalaAgent))
      .send({ note: "Disetujui untuk pengujian" })
      .expect(200);
    expect(approved.body.item.status).toBe("APPROVED");

    const stock = await api(
      admin,
      "get",
      `/api/stocks?itemId=${itemId}&departmentId=${aftapId}`,
    ).expect(200);
    expect(stock.body.items[0].qty).toBe(4);

    const integrity = await api(admin, "get", "/api/stocks/integrity").expect(200);
    const mismatch = integrity.body.items.find(
      (row: { item_id: number }) => row.item_id === itemId,
    );
    expect(mismatch?.difference ?? 0).toBe(0);

    const session = await api(admin, "get", `/api/opnames/${opnameId}`).expect(200);
    expect(session.body.item.status).toBe("APPROVED");
  });

  it("menyediakan laporan dan ekspor Excel/PDF", async () => {
    const types = await api(admin, "get", "/api/reports/types").expect(200);
    expect(types.body.items.length).toBeGreaterThanOrEqual(11);

    const stock = await api(admin, "get", `/api/reports/stock-summary`).expect(200);
    expect(stock.body.rows.length).toBeGreaterThan(0);

    const xlsx = await api(
      admin,
      "get",
      "/api/reports/stock-summary/export?format=xlsx",
    ).expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");

    const pdf = await api(
      admin,
      "get",
      "/api/reports/stock-summary/export?format=pdf",
    ).expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
  });

  it("mencatat audit trail untuk aksi penting", async () => {
    const audit = await api(admin, "get", "/api/audit?page=1&pageSize=100").expect(
      200,
    );
    const actions = audit.body.items.map((row: { action: string }) => row.action);
    expect(actions).toContain("LOGIN");
    expect(actions).toContain("COMMIT_IMPORT");
    expect(actions).toContain("APPROVE_REQUEST");
  });
});
