import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, crc32 } from "node:zlib";

import "../extension/src/gmail-dom.js";

const gmail = (globalThis as any).LilaGmail;

// A minimal single-entry ZIP: local header + deflated data. describe() reads
// only the first entry, so no central directory is needed.
function zipWith(filename: string, content: string): Uint8Array {
  const name = Buffer.from(filename, "utf8");
  const raw = Buffer.from(content, "utf8");
  const deflated = deflateRawSync(raw);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 signature
  header.writeUInt16LE(20, 4); // version
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // method: deflate
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(0, 12); // date
  header.writeUInt32LE(crc32(raw), 14);
  header.writeUInt32LE(deflated.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // no extra field
  return new Uint8Array(Buffer.concat([header, name, deflated]));
}

test("un PDF se reconoce por sus bytes y viaja en base64", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\nhola");
  const found = await gmail.describe(bytes);
  assert.equal(found.kind, "pdf");
  assert.equal(atob(found.base64).startsWith("%PDF"), true);
});

test("un XML viaja en base64 y también en claro", async () => {
  const found = await gmail.describe(
    new TextEncoder().encode("<factura><x/></factura>"),
  );
  assert.equal(found.kind, "xml");
  assert.match(found.text, /<factura>/);
  assert.equal(atob(found.base64).startsWith("<factura"), true);
});

test("un ZIP con un XML dentro se descomprime y queda como XML", async () => {
  const found = await gmail.describe(
    zipWith("factura.xml", '<?xml version="1.0"?><factura><id>1</id></factura>'),
  );
  assert.equal(found.kind, "xml");
  assert.match(found.text, /<factura>/);
});

test("un ZIP corrupto no rompe nada: queda como otro", async () => {
  const found = await gmail.describe(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]));
  assert.equal(found.kind, "otro");
});

test("un ZIP que no trae XML dentro tampoco rompe", async () => {
  const found = await gmail.describe(zipWith("notas.txt", "esto no es un xml"));
  assert.equal(found.kind, "otro");
});
