import assert from "node:assert/strict";
import test from "node:test";
import "../extension/src/clave.js";
import "../extension/src/xml.js";
import "../extension/src/pdf.js";
import "../extension/src/parse.js";
import { parseReport } from "../src/domain.ts";

const clave = (globalThis as any).LilaClave;
const parse = (globalThis as any).LilaParse;
const xml = (globalThis as any).LilaXml;
const pdf = (globalThis as any).LilaPdf;

const CLAVE = "1503202601099999999900120010020000012341234567810";
const SERIE = "001-002-000001234";
const CEDULA = "0912345678";
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
  assert.equal(clave.valid(`${CLAVE.slice(0, 48)}${(Number(CLAVE[48]) + 1) % 10}`), false);
  const partido = `Factura${CLAVE.slice(0, 20)} ${CLAVE.slice(20)}0000`;
  assert.equal(clave.all(partido)[0]?.serie, SERIE);
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

test("lee el monto que sigue a su etiqueta", () => {
  const text = "SUBTOTAL SIN IMPUESTOS:\n$ 13,04\nIVA 15% 1,96\nIMPORTE TOTAL 15,00";
  assert.equal(parse.amountFor(text, ["subtotal sin impuestos"]), "13.04");
  assert.equal(parse.amountFor(text, ["iva 15%", "iva"]), "1.96");
  assert.equal(parse.amountFor(text, ["importe total", "total"]), "15.00");
});

const RIDE = `R.U.C.: FACTURA CLAVE DE ACCESO 0411202601098888888800120010100000000311234567810
04/11/2026 09:15:00 NORMAL Razón Social / Nombres y Apellidos: Identificación
CLIENTE DE PRUEBA ${CEDULA} 04/11/2026 001-010-000000031
30.43 SUBTOTAL 15% 0.00 SUBTOTAL NO OBJETO DE IVA 0.00 SUBTOTAL EXENTO DE IVA
30.43 SUBTOTAL SIN IMPUESTOS 0.00 TOTAL DESCUENTO 0.00 ICE 4.56 IVA 15%
0.00 IRBPNR 0.00 PROPINA 34.99 VALOR TOTAL VALOR TOTAL SIN SUBSIDIO 0.00`;

test("en un RIDE el importe va antes de su etiqueta y aun así se lee", () => {
  assert.equal(parse.sideOf(RIDE.replace(/\s+/g, " ").toLowerCase()), "antes");
  assert.equal(parse.amountFor(RIDE, ["valor total", "total"]), "34.99");
  assert.equal(parse.amountFor(RIDE, ["subtotal sin impuestos"]), "30.43");
  assert.equal(parse.amountFor(RIDE, ["iva 15%", "iva"]), "4.56");
});

test("un RIDE entero entra completo por parseReport", () => {
  const record = parse.extract({ text: RIDE, sender: "Instituto" }, { cedula: CEDULA });
  assert.deepEqual(record.missing, []);
  assert.equal(record.serie, "001-010-000000031");
  assert.equal(record.base, "30.43");
  const { records, errors } = parseReport(parse.toReport([record]));
  assert.deepEqual(errors, []);
  assert.equal(records[0].cents, 3499);
  assert.equal(records[0].category, "GASTOS PERSONALES");
});

test("'IVA 15,00%' es la misma etiqueta que 'IVA 15%'", () => {
  const text = "SUBTOTAL SIN IMPUESTOS: 0,27 IVA 15,00%: 0,04 VALOR TOTAL: 0,31";
  assert.equal(parse.amountFor(text, ["iva 15%", "iva"]), "0.04");
  assert.equal(parse.amountFor(text, ["valor total", "total"]), "0.31");
});

const ivaEmail = {
  sender: "Facturación <facturas@ejemplo.com.ec>",
  subject: `Factura electrónica ${SERIE}`,
  text: `Estimado cliente,
Clave de acceso: ${CLAVE}
Identificación: ${RUC}
SUBTOTAL SIN IMPUESTOS: 13,04
IVA 15%: 1,96
IMPORTE TOTAL: $ 15,00`,
};

test("el receptor decide la categoría: RUC va al IVA, cédula a gastos personales", () => {
  const empresa = parse.extract(ivaEmail, {});
  assert.deepEqual(empresa.missing, []);
  assert.equal(empresa.category, "APLICABLE IVA");
  assert.equal(empresa.amount, "13.04");

  const personal = parse.extract(
    { ...ivaEmail, text: ivaEmail.text.replace(RUC, CEDULA) },
    {},
  );
  const { records, errors } = parseReport(parse.toReport([empresa, personal]));
  assert.deepEqual(errors, []);
  assert.equal(records[0].cents, 1304);
  assert.equal(records[0].month, "2026-03");
  assert.equal(records[1].category, "GASTOS PERSONALES");
  assert.equal(records[1].cents, 1500);
});

test("deduce la base sin impuestos cuando solo hay total e IVA", () => {
  const record = parse.extract(
    { ...ivaEmail, text: `Clave: ${CLAVE}\nRUC: ${RUC}\nIVA 15%: 1,96\nTOTAL A PAGAR: 15,00` },
    {},
  );
  assert.equal(record.amount, "13.04");
  assert.equal(record.complete, true);
});

test("sin IVA en el documento, el total es todo el gasto", () => {
  const record = parse.finalize({
    serie: SERIE,
    fecha: "04/11/2026",
    recipient: RUC,
    total: "1754,00",
  });
  assert.deepEqual(record.missing, []);
  assert.equal(record.base, "1754.00");
});

test("señala exactamente lo que falta en vez de inventarlo", () => {
  const record = parse.extract(
    { sender: "Tienda", subject: "Su factura", text: "Gracias por su compra." },
    {},
  );
  assert.deepEqual(record.missing, [
    "número de la factura o de la transacción",
    "fecha de emisión",
    "tu cédula",
    "importe total",
  ]);
});

const FACTURA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<autorizacion>
  <estado>AUTORIZADO</estado>
  <comprobante><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.0.0">
  <infoTributaria>
    <ambiente>2</ambiente>
    <razonSocial>COMERCIAL EJEMPLO CIA. LTDA.</razonSocial>
    <ruc>0999999999001</ruc>
    <claveAcceso>${CLAVE}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>001</estab>
    <ptoEmi>002</ptoEmi>
    <secuencial>000001234</secuencial>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>15/03/2026</fechaEmision>
    <razonSocialComprador>CLIENTE DE PRUEBA</razonSocialComprador>
    <identificacionComprador>${RUC}</identificacionComprador>
    <totalSinImpuestos>13.04</totalSinImpuestos>
    <importeTotal>15.00</importeTotal>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <baseImponible>13.04</baseImponible>
        <valor>1.96</valor>
      </totalImpuesto>
    </totalConImpuestos>
  </infoFactura>
</factura>]]></comprobante>
</autorizacion>`;

test("el XML adjunto rinde todos los campos exactos, escapado o no", () => {
  const fields = xml.parse(FACTURA_XML);
  assert.equal(fields.serie, SERIE);
  assert.equal(fields.fecha, "15/03/2026");
  assert.equal(fields.recipient, RUC);
  assert.equal(fields.base, "13.04");
  assert.equal(fields.total, "15.00");
  assert.equal(fields.iva, "1.96");
  assert.equal(fields.emisor, "COMERCIAL EJEMPLO CIA. LTDA.");
  const escaped = FACTURA_XML.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  assert.equal(xml.parse(escaped)?.serie, SERIE);
  assert.equal(xml.parse("<autorizacion><estado>NO AUTORIZADO</estado></autorizacion>"), null);
});

test("un registro desde XML entra completo por parseReport", () => {
  const record = parse.fromXml(FACTURA_XML, { sender: "Facturas" }, {});
  assert.equal(record.category, "APLICABLE IVA");
  const { records, errors } = parseReport(parse.toReport([record]));
  assert.deepEqual(errors, []);
  assert.equal(records[0].number, SERIE);
  assert.equal(records[0].cents, 1304);
});

test("el texto comprimido sobrevive a la basura que va antes de endstream", async () => {
  const { deflateSync } = await import("node:zlib");
  const body = Buffer.from("BT [(VA) -20 (LO) -20 (R) -400 (TOTAL) -400 (34,99)] TJ ET");
  const head = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Length 99 /Filter /FlateDecode >>\nstream\n",
    "latin1",
  );
  const tail = Buffer.from("\nendstream\nendobj\n%%EOF", "latin1");
  const text = await pdf.textFrom(
    new Uint8Array(Buffer.concat([head, deflateSync(body), tail])),
  );
  assert.equal(text.includes("VALOR TOTAL"), true);
  assert.equal(parse.amountFor(text, ["valor total"]), "34.99");
});

test("el ajuste entre letras no mete espacios dentro de las palabras", () => {
  const text = pdf.textOf("BT [(12) -15 (60) -10 (.0) -12 (0) -500 (VA) -20 (LOR)] TJ ET");
  assert.equal(text.replace(/\s+/g, " ").trim(), "1260.00 VALOR");
});

test("un PDF ilegible devuelve vacío en vez de romper", async () => {
  assert.equal(await pdf.textFrom(new TextEncoder().encode("no soy un pdf")), "");
  assert.equal(await pdf.textFrom(new Uint8Array([0x25, 0x50, 0x44, 0x46])), "");
});

test("sin fecha propia usa la de llegada y lo deja marcado", () => {
  const aviso = {
    sender: "Banco <alertas@banco.ec>",
    subject: "Débito a su cuenta",
    text: "Se debitó $ 15,00. Número de transacción 9930221.",
    receivedAt: "02/10/2026",
  };
  const record = parse.extract(aviso, { cedula: CEDULA });
  assert.deepEqual(record.missing, []);
  assert.equal(record.serie, "9930221");
  assert.equal(record.fecha, "02/10/2026");
  assert.equal(record.guessedDate, true);
  assert.equal(parse.extract({ ...aviso, text: `${aviso.text}\nFecha: 01/10/2026` }, { cedula: CEDULA }).guessedDate, false);
});

test("lee las fechas que escriben los bancos y las tiendas", () => {
  assert.equal(parse.dateFrom("Fecha: 3/9/2026"), "03/09/2026");
  assert.equal(parse.dateFrom("emitido 2026-10-03T14:22"), "03/10/2026");
  assert.equal(parse.dateFrom("3 de octubre de 2026"), "03/10/2026");
  assert.equal(parse.dateFrom("sin fecha"), null);
});

test("reconoce recibos en inglés y usa su número de transacción", () => {
  const email = {
    sender: "Servicio <noreply@ejemplo.com>",
    subject: "Payment Receipt",
    text: "RECEIPT - SUBSCRIPTION\nTotal: $10.00 USD\nTransaction ID: 1A234567BC8901234\nDate: 02 Nov 2026",
  };
  assert.equal(parse.looksLikeInvoice(email), true);
  const record = parse.extract(email, { cedula: CEDULA });
  assert.deepEqual(record.missing, []);
  assert.equal(record.total, "10.00");
  assert.equal(record.serie, "1A234567BC8901234");
  assert.equal(record.fecha, "02/11/2026");
});

test("reconoce facturas, avisos de banco y la etiqueta que les pusiste en Gmail", () => {
  for (const subject of [
    "Su factura electrónica",
    "Pago realizado por $15,00",
    "Débito a su cuenta de ahorros",
    "Enviaste dinero a Juan Pérez",
    "Consumo con tu tarjeta",
  ])
    assert.equal(parse.looksLikeInvoice({ subject }), true, subject);

  const ajeno = { sender: "Mamá", subject: "Fotos del domingo", snippet: "" };
  assert.equal(parse.looksLikeInvoice(ajeno), false);
  assert.equal(parse.looksLikeInvoice({ ...ajeno, text: "Mamá Facturas 4 nov" }), true);
});

test("el informe generado nunca parte una celda con tabulaciones ni saltos", () => {
  const record = parse.extract({ ...ivaEmail, sender: "Mega\tTienda\nS.A. <a@b.ec>" }, {});
  const report = parse.toReport([record]);
  assert.equal(report.split("\n").length, 2);
  assert.equal(report.split("\n")[1].split("\t").length, parse.HEADER.length);
});

const CEDULA_OK = "0912345675";

test("reconoce una cédula ecuatoriana y descarta lo que solo lo parece", () => {
  assert.equal(parse.cedulaOk(CEDULA_OK), true);
  assert.equal(parse.cedulaOk("0998697244"), false);
  assert.equal(parse.cedulaOk("2512345675"), false);
  assert.equal(parse.cedulaOk("0962345675"), false);
});

test("deduce quién recibe la factura sin que nadie se lo diga", () => {
  const text = `R.U.C.: 0999999999001 FACTURA CLAVE DE ACCESO ${CLAVE}
TELÉFONO EMPRESA: 0998697244 Razón Social: CLIENTE DE PRUEBA ${CEDULA_OK}001`;
  const found = parse.identityCandidates(text);
  assert.deepEqual(found, [`${CEDULA_OK}001`]);
});

test("una factura que emitiste tú no entra como gasto", () => {
  const record = parse.finalize(
    {
      serie: SERIE,
      fecha: "15/03/2026",
      recipient: "0999999999001",
      total: "100.00",
      ruc: `${CEDULA_OK}001`,
    },
    { cedula: CEDULA_OK },
  );
  assert.equal(record.complete, false);
  assert.equal(record.missing[0], "la emitiste tú, no es un gasto");
});
