import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  amountToCents,
  parseReport,
  parseBackup,
  uniqueRecords,
  totals,
  pendingRecurring,
  validateRecurring,
  parseBackupData,
  keyFor,
} from "../src/domain.ts";
import {
  allInvoices,
  saveInvoices,
  deleteInvoice,
  deleteMonth,
  allRecurring,
  saveRecurring,
  deleteRecurring,
} from "../src/db.ts";
globalThis.indexedDB = indexedDB;
const header =
  "SERIE_COMPROBANTE\tFECHA_EMISION\tIDENTIFICACION_RECEPTOR\tVALOR_SIN_IMPUESTOS\tIMPORTE_TOTAL\tRAZON_SOCIAL_EMISOR\tTIPO_COMPROBANTE";
const report = (rows: string[]) => [header, ...rows].join("\n");
const row = (n: string, id: string, date = "15/09/2026") =>
  `${n}\t${date}\t${id}\t13.04\t15\tTienda & Compañía\tFactura`;
test("upgrading the original database preserves saved invoices", async () => {
  const legacy = parseReport(report([row("legacy-invoice", "9999999999")]))
    .records[0];
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("lila-invoices", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("invoices", {
        keyPath: "id",
      });
      store.createIndex("numberKey", "numberKey", { unique: true });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("invoices", "readwrite");
      tx.objectStore("invoices").put({
        ...legacy,
        numberKey: keyFor(legacy.number),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  assert.deepEqual(await allInvoices(), [legacy]);
  assert.deepEqual(await allRecurring(), []);
  await deleteInvoice(legacy.id);
});
test("import classifies by recipient and uses the requested amount", () => {
  const result = parseReport(
    report([
      row("001-001-000000001", "9999999999"),
      row("001-001-000000002", "9999999999001"),
    ]),
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].cents, 1500);
  assert.equal(result.records[0].category, "GASTOS PERSONALES");
  assert.equal(result.records[1].cents, 1304);
  assert.equal(result.records[1].category, "APLICABLE IVA");
  assert.equal(result.records[1].month, "2026-09");
});
test("fictional reports reconcile totals and skip repeated invoices", () => {
  const result = parseReport(report([
    row("sample-personal-1", "9999999999"),
    row("sample-personal-2", "9999999999"),
    row("sample-vat", "9999999999001"),
  ]));
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 3);
  const sums = totals(result.records);
  assert.equal(sums["GASTOS PERSONALES"], 3000);
  assert.equal(sums["APLICABLE IVA"], 1304);
  assert.equal(uniqueRecords(result.records, result.records).duplicates, 3);
  const backup = JSON.stringify({app: "lila", version: 1, records: result.records});
  assert.deepEqual(parseBackup(backup), result.records);
});
test("malformed rows, unsupported types, and invalid dates are reported", () => {
  const result = parseReport(
    report([
      row("a", "123"),
      row("b", "9999999999", "31/02/2026"),
      row("c", "9999999999").replace("Factura", "Nota de crédito"),
      row("d", "9999999999"),
    ]),
  );
  assert.equal(result.errors.length, 3);
  assert.equal(result.records.length, 1);
  assert.throws(() => parseReport("not a report"));
  assert.throws(() => parseBackup('{"records":[]}'));
});
test("amounts use exact cents and reject invalid values", () => {
  assert.equal(amountToCents("13.04"), 1304);
  assert.equal(amountToCents("0,10"), 10);
  assert.equal(amountToCents("5"), 500);
  for (const input of ["-2", "NaN", "1.234", "", "1e4", "Infinity"])
    assert.throws(() => amountToCents(input));
});
test("duplicates normalize separators and whitespace within a batch", () => {
  const a = parseReport(report([row("001-001-000000001", "9999999999")]))
    .records[0];
  assert.equal(
    uniqueRecords([a, { ...a, id: "b", number: "001001000000001" }], [])
      .duplicates,
    1,
  );
  assert.throws(() =>
    parseBackup(
      JSON.stringify({
        app: "lila",
        version: 1,
        records: [{ ...a, cents: -1 }],
      }),
    ),
  );
});
test("IndexedDB persists, edits, prevents duplicates atomically, and deletes", async () => {
  const a = parseReport(report([row("001-001-000000001", "9999999999")]))
    .records[0];
  await saveInvoices([a]);
  assert.equal((await allInvoices()).length, 1);
  await saveInvoices([
    { ...a, detail: "Updated", category: "ACTIVIDADES SIN IVA" },
  ]);
  assert.equal((await allInvoices())[0].detail, "Updated");
  await assert.rejects(
    saveInvoices([{ ...a, id: "another", number: "001001000000001" }]),
  );
  await assert.rejects(
    saveInvoices([
      { ...a, id: "valid", number: "other" },
      { ...a, id: "duplicate" },
    ]),
  );
  assert.equal((await allInvoices()).length, 1);
  await deleteInvoice(a.id);
  assert.equal((await allInvoices()).length, 0);
});
test("monthly totals remain independent across categories and months", () => {
  const entries = parseReport(
    report([
      row("a", "9999999999"),
      row("b", "9999999999001"),
      row("c", "9999999999", "01/10/2026"),
    ]),
  ).records;
  entries.push({
    ...entries[0],
    id: "manual",
    number: "manual",
    category: "ACTIVIDADES SIN IVA",
    cents: 10,
  });
  const september = totals(entries.filter((r) => r.month === "2026-09"));
  assert.equal(september["GASTOS PERSONALES"], 1500);
  assert.equal(september["APLICABLE IVA"], 1304);
  assert.equal(september["ACTIVIDADES SIN IVA"], 10);
  assert.equal(
    totals(entries.filter((r) => r.month === "2026-10"))["GASTOS PERSONALES"],
    1500,
  );
});
test("backup validation rejects malformed and unsupported data before writing", () => {
  for (const data of [
    null,
    {},
    { app: "lila", version: 2, records: [] },
    { app: "lila", version: 1, records: [null] },
    { app: "lila", version: 1, records: [{}] },
  ])
    assert.throws(() => parseBackup(JSON.stringify(data)));
});

test("deleting a month removes all its categories and preserves other months", async () => {
  const entries = parseReport(
    report([
      row("month-personal", "9999999999"),
      row("month-vat", "9999999999001"),
      row("month-other", "9999999999", "01/10/2026"),
    ]),
  ).records;
  entries.push({
    ...entries[0],
    id: "month-no-vat",
    number: "month-no-vat",
    category: "ACTIVIDADES SIN IVA",
  });
  await saveInvoices(entries);
  await assert.rejects(deleteMonth("invalid"));
  assert.equal((await allInvoices()).length, 4);
  await deleteMonth("2026-09");
  const remaining = await allInvoices();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].number, "month-other");
  await deleteMonth("2026-09");
  assert.equal((await allInvoices()).length, 1);
  await deleteMonth("2026-10");
  assert.equal((await allInvoices()).length, 0);
});

test("recurring settings persist and edits or removal preserve historical invoices", async () => {
  const template = validateRecurring({
    id: "internet",
    name: "Internet",
    category: "GASTOS PERSONALES",
    detail: "Home connection",
    cents: 2000,
    createdAt: new Date().toISOString(),
  });
  await saveRecurring(template);
  assert.deepEqual(await allRecurring(), [template]);
  const entry = {
    ...parseReport(report([row("recurring-september", "9999999999")]))
      .records[0],
    cents: template.cents,
    recurringId: template.id,
  };
  await saveInvoices([entry]);
  assert.equal(
    pendingRecurring([template], await allInvoices(), "2026-09").length,
    0,
  );
  assert.equal(
    pendingRecurring([template], await allInvoices(), "2026-10").length,
    1,
  );
  await saveRecurring({ ...template, cents: 2500 });
  assert.equal((await allRecurring())[0].cents, 2500);
  assert.equal((await allInvoices())[0].cents, 2000);
  await assert.rejects(
    saveInvoices([
      { ...entry, id: "duplicate-recurrence", number: "different-invoice" },
    ]),
  );
  assert.equal(
    uniqueRecords(
      [{ ...entry, id: "duplicate", number: "other-number" }],
      [entry],
    ).duplicates,
    1,
  );
  const october = {
    ...entry,
    id: "october",
    number: "recurring-october",
    month: "2026-10",
  };
  await saveInvoices([october]);
  await deleteRecurring(template.id);
  assert.equal((await allRecurring()).length, 0);
  assert.equal((await allInvoices()).length, 2);
  await deleteMonth("2026-09");
  await deleteMonth("2026-10");
});
test("new backups restore templates and invoices atomically, keeping existing settings", async () => {
  const template = validateRecurring({
    id: "backup-internet",
    name: "Internet",
    category: "APLICABLE IVA",
    detail: "Internet",
    cents: 1000,
    createdAt: new Date().toISOString(),
  });
  const invoice = {
    ...parseReport(report([row("backup-recurring-invoice", "9999999999001")]))
      .records[0],
    recurringId: template.id,
  };
  const backup = parseBackupData(
    JSON.stringify({
      app: "lila",
      version: 2,
      records: [invoice],
      recurring: [template],
    }),
  );
  assert.deepEqual(backup, { records: [invoice], recurring: [template] });
  await saveInvoices(backup.records, backup.recurring);
  assert.deepEqual(await allRecurring(), [template]);
  assert.deepEqual(await allInvoices(), [invoice]);
  await saveRecurring({ ...template, cents: 1700 });
  await saveInvoices([], backup.recurring);
  assert.equal((await allRecurring())[0].cents, 1700);
  await assert.rejects(
    saveInvoices(
      [{ ...invoice, id: "duplicate", number: "unique-number" }],
      [{ ...template, id: "must-rollback" }],
    ),
  );
  assert.equal((await allRecurring()).length, 1);
  assert.throws(() =>
    parseBackupData(
      JSON.stringify({
        app: "lila",
        version: 2,
        records: [],
        recurring: [{ ...template, cents: -1 }],
      }),
    ),
  );
  assert.deepEqual(
    parseBackupData(
      JSON.stringify({ app: "lila", version: 1, records: [invoice] }),
    ).recurring,
    [],
  );
  await deleteMonth("2026-09");
  assert.equal((await allRecurring()).length, 1);
  assert.equal(
    pendingRecurring([template], await allInvoices(), "2026-09").length,
    1,
  );
  await deleteRecurring(template.id);
});
test("invalid recurring templates are rejected without changing saved settings", async () => {
  const template = {
    id: "bad",
    name: " ",
    category: "GASTOS PERSONALES",
    detail: "",
    cents: 0,
    createdAt: new Date().toISOString(),
  };
  assert.throws(() => validateRecurring(template));
  await assert.rejects(saveRecurring(template as any));
  assert.equal((await allRecurring()).length, 0);
});
