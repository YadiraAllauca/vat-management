// Measures the model against the SRI report. Costs money: `npm test` never
// calls it. Usage: ANTHROPIC_API_KEY=sk-ant-... node scripts/medir.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

await import("../extension/src/clave.js");
await import("../extension/src/parse.js");
await import("../extension/src/ai.js");
await import("../extension/src/claude.js");

const { LilaAI, LilaParse, LilaClaude } = globalThis;

const CORPUS = "tests/fixtures/correos";
const REPORT = "1804573770001_Recibidos.txt";
const MODEL = process.env.LILA_MODEL ?? "claude-opus-5-5";
const PRICES = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("Falta ANTHROPIC_API_KEY.");
  process.exit(1);
}

// Ground truth, indexed by access key: it is unique.
const lines = readFileSync(REPORT, "utf8").trim().split("\n");
const header = lines[0].split("\t");
const truth = new Map();
for (const linea of lines.slice(1)) {
  const cells = linea.split("\t");
  const row = Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]));
  if (row.CLAVE_ACCESO) truth.set(row.CLAVE_ACCESO, row);
}

let files = [];
try {
  files = readdirSync(CORPUS).filter((one) => one.endsWith(".json"));
} catch {
  console.error(`No existe ${CORPUS}. Usa lila.guardar() en la consola de Gmail primero.`);
  process.exit(1);
}
if (!files.length) {
  console.error(`${CORPUS} está vacío. Usa lila.guardar() en la consola de Gmail.`);
  process.exit(1);
}

const FIELDS = [
  ["RUC_EMISOR", "ruc"],
  ["SERIE_COMPROBANTE", "serie"],
  ["FECHA_EMISION", "fecha"],
  ["VALOR_SIN_IMPUESTOS", "base"],
  ["IVA", "iva"],
  ["IMPORTE_TOTAL", "total"],
];

const withXml = { read: 0, complete: 0, matched: 0, hits: {} };
const withoutXml = { read: 0, complete: 0, matched: 0, hits: {} };
for (const group of [withXml, withoutXml])
  for (const [name] of FIELDS) group.hits[name] = 0;

let inTokens = 0;
let outTokens = 0;

for (const file of files) {
  const email = JSON.parse(readFileSync(join(CORPUS, file), "utf8"));
  const hasXml = (email.attachments ?? []).some((one) => one.kind === "xml");
  const group = hasXml ? withXml : withoutXml;
  group.read += 1;

  let answer;
  try {
    const body = LilaAI.extractBody(email, { model: MODEL });
    const { message, usage } = await LilaClaude.call(body, key);
    inTokens += usage.input_tokens ?? 0;
    outTokens += usage.output_tokens ?? 0;
    answer = LilaAI.readExtract(message);
  } catch (error) {
    console.error(`✗ ${file}: ${error.message}`);
    continue;
  }
  if (answer.esGasto === false) continue;

  const xmlText = (email.attachments ?? [])
    .filter((one) => one.kind === "xml")
    .map((one) => Buffer.from(one.base64, "base64").toString("utf8"))
    .join("\n");
  const fields = LilaAI.fieldsFrom(answer, { text: email.text, xmlText });
  const record = LilaParse.finalize(fields, {});
  if (record.complete) group.complete += 1;

  const expected = record.clave ? truth.get(record.clave) : null;
  if (!expected) continue;
  group.matched += 1;
  for (const [columna, campo] of FIELDS) {
    const ours = String(record[campo] ?? "");
    const theirs = String(expected[columna] ?? "");
    const same =
      campo === "fecha"
        ? ours === theirs
        : Number(ours || 0).toFixed(2) === Number(theirs || 0).toFixed(2);
    if (same) group.hits[columna] += 1;
    else console.error(`  ≠ ${file} · ${columna}: dije "${ours}", el SRI dice "${theirs}"`);
  }
}

const table = (name, group) => {
  if (!group.read) return;
  console.log(`\n== ${name} ==`);
  console.log(`correos: ${group.read} · complete: ${group.complete} · matched con el SRI: ${group.matched}`);
  if (!group.matched) return;
  for (const [columna] of FIELDS)
    console.log(`  ${columna.padEnd(20)} ${group.hits[columna]}/${group.matched}`);
};

table("CON XML adjunto (aquí xml.js era exacto)", withXml);
table("SIN XML adjunto", withoutXml);

const [pin, pout] = PRICES[MODEL] ?? PRICES["claude-opus-5-5"];
const dollars = (inTokens * pin + outTokens * pout) / 1_000_000;
console.log(`\nmodelo: ${MODEL} · tokens: ${inTokens} inTokens / ${outTokens} outTokens · costo: $${dollars.toFixed(4)}`);
console.log(
  "\nSi el group CON XML acierta menos campos de los que acertaba xml.js, para y repórtalo:\n" +
    "volver al híbrido es decisión del dueño del proyecto, no del que programa.",
);
