import assert from "node:assert/strict";
import test from "node:test";
import "../extension/src/clave.js";
import "../extension/src/parse.js";
import "../extension/src/ai.js";

const ai = (globalThis as any).LilaAI;

const CLAVE = "1503202601099999999900120010020000012341234567810";

test("el cuerpo de la petición nunca manda los parámetros prohibidos", () => {
  const body = ai.triageBody(
    [{ id: "a", sender: "X", subject: "Y", snippet: "Z" }],
    { model: "claude-opus-5-5" },
  );
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.output_config.effort, "low");
  for (const prohibido of ["thinking", "temperature", "top_p", "top_k"])
    assert.equal(prohibido in body, false, prohibido);
});

test("un PDF viaja como bloque document y un XML como texto", () => {
  const body = ai.extractBody(
    {
      subject: "Factura",
      sender: "a@b.ec",
      text: "hola",
      attachments: [
        { kind: "pdf", base64: "JVBERi0=" },
        { kind: "xml", base64: btoa("<factura/>") },
      ],
    },
    { model: "claude-opus-5-5" },
  );
  const bloques = body.messages[0].content;
  const doc = bloques.find((b: any) => b.type === "document");
  assert.equal(doc.source.media_type, "application/pdf");
  assert.equal(doc.source.data, "JVBERi0=");
  assert.ok(
    bloques.some(
      (b: any) => b.type === "text" && b.text.includes("<factura/>"),
    ),
  );
});

test("la clave de acceso del texto manda sobre lo que dijo el modelo", () => {
  const fields = ai.fieldsFrom(
    {
      esGasto: true,
      claveAcceso: null,
      serie: "999-999-999999999",
      fecha: "2020-01-01",
      emisor: "X",
    },
    { text: `Su comprobante ${CLAVE} fue autorizado` },
  );
  assert.equal(fields.clave, CLAVE);
  assert.equal(fields.serie, "001-002-000001234");
  assert.equal(fields.fecha, "15/03/2026");
});

test("la fecha del esquema se convierte, y una imposible se descarta", () => {
  assert.equal(
    ai.fieldsFrom({ esGasto: true, fecha: "2026-03-15" }, {}).fecha,
    "15/03/2026",
  );
  const malo = ai.fieldsFrom(
    { esGasto: true, fecha: "2026-13-45" },
    { receivedAt: "02/11/2026" },
  );
  assert.equal(malo.fecha, "02/11/2026");
  assert.equal(malo.guessedDate, true);
});

test("los montos con formato europeo o con símbolo quedan normalizados", () => {
  const fields = ai.fieldsFrom(
    {
      esGasto: true,
      importeTotal: "$ 1.234,56",
      iva: "1,00",
      valorSinImpuestos: null,
    },
    {},
  );
  assert.equal(fields.total, "1234.56");
  assert.equal(fields.iva, "1.00");
});

test("un receptor nulo no es un problema: lo rescata finalize", () => {
  const fields = ai.fieldsFrom(
    { esGasto: true, identificacionReceptor: null, importeTotal: "7.25" },
    {},
  );
  assert.equal(fields.recipient, null);
  assert.deepEqual(fields.problems, []);
});

test("base + iva que no cuadra con el total se reporta como problema", () => {
  const fields = ai.fieldsFrom(
    {
      esGasto: true,
      valorSinImpuestos: "10.00",
      iva: "1.50",
      importeTotal: "99.00",
    },
    {},
  );
  assert.equal(fields.problems.length, 1);
  assert.match(fields.problems[0], /no cuadra/);
});

test("una respuesta que no es JSON del esquema se rechaza con mensaje propio", () => {
  assert.throws(
    () => ai.readExtract({ content: [{ type: "text", text: "lo siento" }] }),
    /no devolvió/,
  );
});

test("readTriage devuelve una fila por id pedido", () => {
  const message = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          filas: [{ id: "a", esGasto: true, motivo: "factura" }],
        }),
      },
    ],
  };
  assert.deepEqual(ai.readTriage(message), [
    { id: "a", esGasto: true, motivo: "factura" },
  ]);
});

test("un receptor de diez dígitos con dígito verificador falso se descarta", () => {
  const fields = ai.fieldsFrom(
    { esGasto: true, identificacionReceptor: "0912345679", importeTotal: "5.00" },
    {},
  );
  assert.equal(fields.recipient, null);
});
