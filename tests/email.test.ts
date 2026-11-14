import assert from "node:assert/strict";
import test from "node:test";
import "../extension/src/clave.js";
import "../extension/src/parse.js";
import { parseReport } from "../src/domain.ts";

const clave = (globalThis as any).LilaClave;
const parse = (globalThis as any).LilaParse;

const CLAVE = "1503202601099999999900120010020000012341234567810";
const SERIE = "001-002-000001234";
const CEDULA = "0912345678";
const CEDULA_OK = "0912345675";
const RUC = "0912345678001";

test("la clave de acceso rinde fecha, RUC y serie, y rechaza las imposibles", () => {
  const parsed = clave.parse(CLAVE);
  assert.equal(parsed.fecha, "15/03/2026");
  assert.equal(parsed.ruc, "0999999999001");
  assert.equal(parsed.serie, SERIE);
  assert.equal(parsed.tipo, "01");
  assert.equal(clave.parse(`32${CLAVE.slice(2)}`), null);
  assert.equal(clave.parse(CLAVE.slice(0, 48)), null);
});

test("el dígito verificador descarta las claves que arma el texto sin espacios", () => {
  assert.equal(clave.valid(CLAVE), true);
  assert.equal(clave.valid(`${CLAVE.slice(0, 48)}9`), false);
});

test("normaliza montos escritos de distintas formas", () => {
  const cases: [string, string | null][] = [
    ["15,00", "15.00"],
    ["$ 1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["USD 13", "13"],
    ["1.234", "1234"],
    ["", null],
    ["-5,00", null],
  ];
  for (const [input, expected] of cases)
    assert.equal(parse.normalizeAmount(input), expected, input);
});

test("reconoce una cédula ecuatoriana y descarta lo que solo lo parece", () => {
  assert.equal(parse.cedulaOk(CEDULA_OK), true);
  assert.equal(parse.cedulaOk("0998697244"), false);
  assert.equal(parse.cedulaOk("2512345675"), false);
  assert.equal(parse.cedulaOk("0962345675"), false);
});

test("lee las fechas que escriben los bancos y las tiendas", () => {
  assert.equal(parse.dateFrom("el 04/11/2026 a las 10:00"), "04/11/2026");
  assert.equal(parse.dateFrom("2026-11-04"), "04/11/2026");
  assert.equal(parse.dateFrom("4 de noviembre de 2026"), "04/11/2026");
  assert.equal(parse.dateFrom("sin fecha"), null);
});

test("el receptor decide la categoría: RUC va al IVA, cédula a gastos personales", () => {
  const empresa = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: RUC, total: "11.50", base: "10.00", iva: "1.50" },
    {},
  );
  assert.equal(empresa.category, "APLICABLE IVA");
  assert.equal(empresa.amount, "10.00");

  const personal = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: CEDULA, total: "11.50", base: "10.00", iva: "1.50" },
    {},
  );
  assert.equal(personal.category, "GASTOS PERSONALES");
  assert.equal(personal.amount, "11.50");
});

test("los rescates de finalize siguen vivos", () => {
  const record = parse.finalize(
    { total: "7.25", emisor: "TIENDA", fecha: "09/11/2026" },
    { cedula: CEDULA },
  );
  assert.equal(record.recipient, CEDULA);
  assert.equal(record.category, "GASTOS PERSONALES");
  assert.equal(record.complete, true);
});

test("deduce la base sin impuestos cuando solo hay total e IVA", () => {
  const record = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: RUC, total: "11.50", iva: "1.50" },
    {},
  );
  assert.equal(record.base, "10.00");
});

test("sin IVA en el documento, el total es todo el gasto", () => {
  const record = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: RUC, total: "11.50" },
    {},
  );
  assert.equal(record.base, "11.50");
});

test("los problemas que reporta ai.js entran en missing", () => {
  const record = parse.finalize(
    {
      total: "7.25",
      emisor: "X",
      fecha: "09/11/2026",
      problems: ["el importe total no cuadra con base + IVA"],
    },
    { cedula: CEDULA },
  );
  assert.equal(record.complete, false);
  assert.match(record.missing.join(" "), /no cuadra/);
});

test("señala exactamente lo que falta en vez de inventarlo", () => {
  const record = parse.finalize({ serie: SERIE, emisor: "X" }, {});
  assert.equal(record.complete, false);
  assert.ok(record.missing.includes("fecha de emisión"));
  assert.ok(record.missing.includes(parse.MISSING_ID));
});

test("sin número propio, lo arma con la fecha y el remitente, y siempre el mismo", () => {
  const fields = { fecha: "09/11/2026", recipient: CEDULA, total: "9.90", emisor: "Cafetería Nan" };
  const uno = parse.finalize(fields, {});
  const dos = parse.finalize(fields, {});
  assert.equal(uno.generatedSerie, true);
  assert.match(uno.serie, /^SN-20261109-/);
  assert.equal(uno.serie, dos.serie);
  assert.notEqual(parse.finalize({ ...fields, total: "9.91" }, {}).serie, uno.serie);
});

test("una factura que emitiste tú no entra como gasto", () => {
  const record = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: "0999999999001", total: "100.00", ruc: `${CEDULA_OK}001` },
    { cedula: CEDULA_OK },
  );
  assert.equal(record.complete, false);
  assert.equal(record.missing[0], "la emitiste tú, no es un gasto");
});

test("el informe generado nunca parte una celda con tabulaciones ni saltos", () => {
  const record = parse.finalize(
    { serie: SERIE, fecha: "15/03/2026", recipient: CEDULA, total: "9.90", emisor: "Mega\tTienda\nS.A." },
    {},
  );
  const report = parse.toReport([record]);
  assert.equal(report.split("\n").length, 2);
  assert.equal(report.split("\n")[1].split("\t").length, parse.HEADER.length);
});

test("un registro entra completo por parseReport", () => {
  const record = parse.finalize(
    {
      serie: "001-010-000000031",
      fecha: "15/03/2026",
      recipient: CEDULA,
      total: "34.99",
      base: "30.43",
      iva: "4.56",
      emisor: "Instituto",
      clave: CLAVE,
      ruc: "0999999999001",
    },
    {},
  );
  assert.deepEqual(record.missing, []);
  const { records, errors } = parseReport(parse.toReport([record]));
  assert.deepEqual(errors, []);
  assert.equal(records[0].cents, 3499);
  assert.equal(records[0].category, "GASTOS PERSONALES");
});
