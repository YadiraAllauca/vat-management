# Detección y extracción por IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un modelo de Anthropic, no listas de palabras clave, decida qué correo de Gmail es un gasto y de dónde sale cada dato.

**Architecture:** El service worker es el único que tiene la key y el único que habla con `api.anthropic.com`. `ai.js` es puro —arma cuerpos de petición y valida respuestas— y se carga tanto en el service worker (`importScripts`) como en los tests. El content script pide por mensajes y aplica los verificadores deterministas (clave de acceso, dígito verificador, aritmética) sobre lo que el modelo devolvió.

**Tech Stack:** Chrome MV3 sin bundler (IIFE sobre `globalThis`), `fetch` crudo contra `/v1/messages`, `node --test` con `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-11-13-deteccion-por-ia-design.md`

## Global Constraints

- Endpoint: `POST https://api.anthropic.com/v1/messages`.
- Encabezados obligatorios: `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`, `anthropic-dangerous-direct-browser-access: true`.
- Modelo por defecto `claude-opus-5-5`. Alternativas en opciones: `claude-sonnet-5-5`, `claude-haiku-5-5`.
- **Nunca** enviar `thinking`, `temperature`, `top_p` ni `top_k`: los tres últimos dan 400 en `2026-10-21` y el primero da 400 en Opus 5.5.
- `output_config: { effort: "low", format: <json schema> }`.
- `max_tokens: 4000`.
- El esquema usa fechas `YYYY-MM-DD`; `finalize` en `parse.js` espera `DD/MM/YYYY` (deriva `month` con `fecha.slice(6,10)` y `fecha.slice(3,5)`). La conversión vive en `ai.js`.
- Sin bundler: cada archivo es un IIFE que asigna a `globalThis.LilaX`. Los tests lo importan por efecto secundario y leen el global.
- `npm test` **no toca la red**, nunca.
- Todo el texto visible al usuario, en español.

## Review Focus

1. **Sin key configurada** — el panel dice «falta tu key de Anthropic» con enlace a opciones, no lanza una excepción. Test en Task 2.
2. **`identificacionReceptor: null`** — el rescate de §7.1 pone tu cédula y el registro sale completo como `GASTOS PERSONALES`; es el caso de casi todo aviso de banco. Test en Task 1.
3. **Fecha imposible devuelta por el modelo** (`2026-13-45`, `null`, `"ayer"`) — se descarta y cae el rescate a `email.receivedAt`; nunca llega `NaN` al TSV. Test en Task 1.
4. **ZIP corrupto o sin XML dentro** — el adjunto se reporta `{kind:"otro"}` y el correo se resuelve con el texto; no rompe la tanda. Test en Task 4.
5. **Monto con formato europeo o con símbolo** (`"$ 1.234,56"`) devuelto por el modelo — pasa por `normalizeAmount` y queda `1234.56`; nunca `NaN`. Test en Task 1.

---

### Task 1: `ai.js` — el contrato con el modelo

**Files:**
- Create: `extension/src/ai.js`
- Test: `tests/ai.test.ts`

**Interfaces:**
- Consumes: `globalThis.LilaClave` (`clave.all`, `clave.parse`), `globalThis.LilaParse.normalizeAmount`, `globalThis.LilaParse.cedulaOk`.
- Produces: `globalThis.LilaAI` con
  - `TRIAGE_SCHEMA`, `EXTRACT_SCHEMA` — objetos JSON Schema.
  - `triageBody(rows: {id,sender,subject,snippet}[], opts: {model:string}) -> object`
  - `extractBody(email: {subject,sender,text,attachments}, opts: {model:string, lessons?: {antes,después,nota}[]}) -> object` donde `attachments` es `{kind:"pdf"|"xml"|"otro", base64:string}[]`
  - `readTriage(message: object) -> {id:string, esGasto:boolean, motivo:string}[]`
  - `readExtract(message: object) -> object` (el objeto del esquema)
  - `fieldsFrom(answer: object, email: {text?:string, xmlText?:string, receivedAt?:string}) -> object` — los `fields` que espera `finalize`, más `problems: string[]`

- [ ] **Step 1: Escribir los tests que fallan** en `tests/ai.test.ts`

```ts
import "../extension/src/clave.js";
import "../extension/src/parse.js";
import "../extension/src/ai.js";
const ai = (globalThis as any).LilaAI;

test("el cuerpo de la petición nunca manda los parámetros prohibidos", () => {
  const body = ai.triageBody([{ id: "a", sender: "X", subject: "Y", snippet: "Z" }], { model: "claude-opus-5-5" });
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.output_config.effort, "low");
  for (const prohibido of ["thinking", "temperature", "top_p", "top_k"])
    assert.equal(prohibido in body, false, prohibido);
});

test("un PDF viaja como bloque document y un XML como texto", () => {
  const body = ai.extractBody(
    { subject: "Factura", sender: "a@b.ec", text: "hola",
      attachments: [{ kind: "pdf", base64: "JVBERi0=" }, { kind: "xml", base64: btoa("<factura/>") }] },
    { model: "claude-opus-5-5" },
  );
  const bloques = body.messages[0].content;
  const doc = bloques.find((b: any) => b.type === "document");
  assert.equal(doc.source.media_type, "application/pdf");
  assert.equal(doc.source.data, "JVBERi0=");
  assert.ok(bloques.some((b: any) => b.type === "text" && b.text.includes("<factura/>")));
});

test("la clave de acceso del texto manda sobre lo que dijo el modelo", () => {
  const CLAVE = "1503202601099999999900120010020000012341234567810";
  const fields = ai.fieldsFrom(
    { esGasto: true, claveAcceso: null, serie: "999-999-999999999", fecha: "2020-01-01", emisor: "X" },
    { text: `Su comprobante ${CLAVE} fue autorizado` },
  );
  assert.equal(fields.clave, CLAVE);
  assert.equal(fields.serie, "001-002-000001234");
  assert.equal(fields.fecha, "15/03/2026");
});

test("la fecha del esquema se convierte, y una imposible se descarta", () => {
  assert.equal(ai.fieldsFrom({ esGasto: true, fecha: "2026-03-15" }, {}).fecha, "15/03/2026");
  const malo = ai.fieldsFrom({ esGasto: true, fecha: "2026-13-45" }, { receivedAt: "02/11/2026" });
  assert.equal(malo.fecha, "02/11/2026");
  assert.equal(malo.guessedDate, true);
});

test("los montos con formato europeo o con símbolo quedan normalizados", () => {
  const fields = ai.fieldsFrom(
    { esGasto: true, importeTotal: "$ 1.234,56", iva: "1,00", valorSinImpuestos: null },
    {},
  );
  assert.equal(fields.total, "1234.56");
  assert.equal(fields.iva, "1.00");
});

test("un receptor nulo no es un problema: lo rescata finalize", () => {
  const fields = ai.fieldsFrom({ esGasto: true, identificacionReceptor: null, importeTotal: "7.25" }, {});
  assert.equal(fields.recipient, null);
  assert.deepEqual(fields.problems, []);
});

test("base + iva que no cuadra con el total se reporta como problema", () => {
  const fields = ai.fieldsFrom(
    { esGasto: true, valorSinImpuestos: "10.00", iva: "1.50", importeTotal: "99.00" },
    {},
  );
  assert.equal(fields.problems.length, 1);
  assert.match(fields.problems[0], /no cuadra/);
});

test("una respuesta que no es JSON del esquema se rechaza con mensaje propio", () => {
  assert.throws(() => ai.readExtract({ content: [{ type: "text", text: "lo siento" }] }), /no devolvió/);
});

test("readTriage devuelve una fila por id pedido", () => {
  const message = { content: [{ type: "text", text: JSON.stringify({ filas: [{ id: "a", esGasto: true, motivo: "factura" }] }) }] };
  assert.deepEqual(ai.readTriage(message), [{ id: "a", esGasto: true, motivo: "factura" }]);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../extension/src/ai.js'`

- [ ] **Step 3: Escribir `extension/src/ai.js`**

Un IIFE que asigna `globalThis.LilaAI`. Decisiones que el test no fija:

- El `system` de extracción describe las doce columnas del informe del SRI (las de `HEADER` en `parse.js:4-15`) y los géneros de correo: factura electrónica con RIDE, aviso de consumo o débito de banco, recibo de servicio en inglés. Dice explícitamente que el emisor es quien vendió, no quien mandó el correo, y que en un reenvío vale el `De:` del cuerpo.
- `fieldsFrom` aplica, en este orden: `clave.all(text + xmlText)` para encontrar una clave válida; si la hay, `clave.parse` manda sobre `serie`, `ruc` y `fecha` del modelo. Después convierte la fecha, normaliza montos con `normalizeAmount`, y compara `base + iva` con `total` (±0.02) agregando a `problems` si no cuadra.
- `problems` queda **vacío** cuando falta un dato que `finalize` rescata (receptor, fecha, base): esos no son problemas, son rescates de §7.1 del diseño.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/ai.js tests/ai.test.ts
git commit -m "feat(extension): contrato puro con el modelo en ai.js"
```

---

### Task 2: `claude.js` y el service worker — la llamada real

Esta tarea contesta el riesgo §11.1 del diseño: si Chrome no deja salir la petición, aquí se ve.

**Files:**
- Create: `extension/src/claude.js`
- Modify: `extension/background.js` (añadir `importScripts` al inicio y dos manejadores en el `onMessage` de la línea 8)
- Modify: `extension/manifest.json` — `host_permissions` ya tiene `https://api.anthropic.com/*`; verificar.
- Test: `tests/claude.test.ts`

**Interfaces:**
- Consumes: `globalThis.LilaAI` de Task 1.
- Produces: `globalThis.LilaClaude.call(body: object, key: string, fetchImpl?: typeof fetch) -> Promise<{message: object, usage: object}>`.
  Mensajes nuevos del service worker: `{type:"clasificar", rows}` → `{ok, filas}` y `{type:"extraer", email}` → `{ok, answer, usage}`; ambos `{ok:false, error}` con texto en español.

- [ ] **Step 1: Escribir los tests que fallan** en `tests/claude.test.ts`

`call` recibe un `fetchImpl` inyectable justamente para poder probarlo sin red.

```ts
test("manda los cuatro encabezados obligatorios", async () => {
  let visto: any = null;
  const falso = async (_url: string, init: any) => { visto = init; return new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }); };
  await claude.call({ model: "claude-opus-5-5" }, "sk-ant-x", falso as any);
  assert.equal(visto.headers["anthropic-version"], "2026-10-21");
  assert.equal(visto.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(visto.headers["x-api-key"], "sk-ant-x");
  assert.equal(visto.headers["content-type"], "application/json");
});

test("un 401 se traduce a un mensaje sobre la key", async () => {
  const falso = async () => new Response(JSON.stringify({ error: { type: "authentication_error", message: "x" } }), { status: 401 });
  await assert.rejects(() => claude.call({}, "mala", falso as any), /key/i);
});

test("un 429 reintenta una vez y después se rinde", async () => {
  let veces = 0;
  const falso = async () => { veces += 1; return new Response("{}", { status: 429, headers: { "retry-after": "0" } }); };
  await assert.rejects(() => claude.call({}, "k", falso as any));
  assert.equal(veces, 2);
});

test("sin key la llamada ni sale", async () => {
  await assert.rejects(() => claude.call({}, "", (() => { throw new Error("no debió llamar"); }) as any), /falta tu key/i);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar `claude.js` y conectar `background.js`**

En `background.js`, arriba del todo: `importScripts("src/clave.js", "src/parse.js", "src/ai.js", "src/claude.js")`. Los dos manejadores nuevos leen `apiKey` y `model` de `chrome.storage.local`, arman el cuerpo con `LilaAI`, llaman a `LilaClaude.call` y devuelven lo que `readTriage` / `readExtract` validaron. Reintentos: 429 según `retry-after` (una vez), 500/529 dos veces con espera creciente.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: La prueba que ningún test puede dar — CORS**

Cargar la extensión en `chrome://extensions`, abrir la consola del **service worker** y correr:

```js
chrome.storage.local.set({ apiKey: "sk-ant-..." }).then(() =>
  chrome.runtime.sendMessage({ type: "extraer", email: { subject: "prueba", sender: "x@y.ec", text: "Total: $1.00", attachments: [] } }))
```

Expected: un objeto con `ok: true`. Si sale `Failed to fetch`, **parar el plan** y volver al diseño: no hay rama de proxy.

- [ ] **Step 6: Commit**

```bash
git add extension/src/claude.js extension/background.js tests/claude.test.ts
git commit -m "feat(extension): cliente de Anthropic en el service worker"
```

---

### Task 3: Opciones — key y modelo

**Files:**
- Modify: `extension/options.html` (añadir dos campos al formulario), `extension/options.js:1` (la lista `fields`)

**Interfaces:**
- Produces: `chrome.storage.local` gana `apiKey: string` y `model: string`.

- [ ] **Step 1: Añadir los campos**

`options.js:1` pasa a `const fields = ["lilaUrl", "cedula", "ruc", "apiKey", "model"]`. En `options.html`: un `<input type="password" id="apiKey">` y un `<select id="model">` con las tres opciones del Global Constraints, `claude-opus-5-5` seleccionado. Validación nueva, con el mismo patrón que `cedula`: si `apiKey` no empieza con `sk-ant-`, error «Esa no parece una key de Anthropic».

- [ ] **Step 2: Escribir el aviso de privacidad**

Un párrafo encima del campo de key: qué se manda a Anthropic (asunto, remitente, cuerpo y adjuntos de los correos que elijas revisar), con qué key, y que esto cambia la promesa anterior de la extensión.

- [ ] **Step 3: Verificar a mano**

Abrir la página de opciones, guardar una key de prueba, recargar: el campo vuelve con el valor. El `<select>` recuerda la elección.

- [ ] **Step 4: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "feat(extension): key de Anthropic y modelo en opciones"
```

---

### Task 4: `gmail-dom.js` — adjuntos crudos y ZIP

**Files:**
- Modify: `extension/src/gmail-dom.js:124-134` (`describe`), `:136-160` (`readAttachments`)
- Test: `tests/adjuntos.test.ts`

**Interfaces:**
- Produces: `describe(bytes: Uint8Array) -> Promise<{kind:"pdf"|"xml"|"otro", base64:string, text?:string}>`. `text` solo para XML, que `ai.js` necesita en claro para `clave.all`. `readAttachments()` devuelve ese mismo objeto, sin tocar `LilaPdf` ni `LilaXml`.

- [ ] **Step 1: Escribir los tests que fallan** en `tests/adjuntos.test.ts`

`describe` no toca el DOM, así que se prueba sola exportándola en el objeto de `LilaGmail`.

```ts
test("un PDF se reconoce por sus bytes y viaja en base64", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\nhola");
  const found = await gmail.describe(bytes);
  assert.equal(found.kind, "pdf");
  assert.equal(atob(found.base64).startsWith("%PDF"), true);
});

test("un XML viaja en base64 y también en claro", async () => {
  const found = await gmail.describe(new TextEncoder().encode("<factura><x/></factura>"));
  assert.equal(found.kind, "xml");
  assert.match(found.text, /<factura>/);
});

test("un ZIP con un XML dentro se descomprime y queda como XML", async () => {
  const found = await gmail.describe(zipConXml()); // helper en el test
  assert.equal(found.kind, "xml");
  assert.match(found.text, /<factura/);
});

test("un ZIP corrupto no rompe nada: queda como otro", async () => {
  const found = await gmail.describe(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]));
  assert.equal(found.kind, "otro");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Implementar**

El ZIP: leer la cabecera local (firma `PK\x03\x04`), tomar `compressionMethod` del offset 8, los tamaños de 18 y 22, el nombre de 26 y 28; si el método es 8, `new DecompressionStream("deflate-raw")` sobre los bytes comprimidos; si es 0, los bytes tal cual. Solo la primera entrada. Cualquier excepción cae a `{kind:"otro"}`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/gmail-dom.js tests/adjuntos.test.ts
git commit -m "feat(extension): adjuntos crudos en base64 y XML dentro de ZIP"
```

---

### Task 5: Podar `parse.js` y rehacer sus tests

**Files:**
- Modify: `extension/src/parse.js`
- Delete: `extension/src/xml.js`, `extension/src/pdf.js`
- Modify: `tests/email.test.ts`
- Modify: `extension/manifest.json` (quitar `src/xml.js` y `src/pdf.js` de `content_scripts`, añadir `src/ai.js`)

**Interfaces:**
- Produces: `globalThis.LilaParse` conserva `HEADER`, `normalizeAmount`, `cedulaOk`, `finalize`, `row`, `toReport`, `MISSING_ID`. `finalize(fields, identity)` gana una línea: `missing.push(...(fields.problems ?? []))`.

- [ ] **Step 1: Recortar `tests/email.test.ts`**

Borrar los tests de `extract`, `looksLikeInvoice`, `merchant`, `forwardedSender`, `amountFor`, `dateFrom`, `identityCandidates`, `fromXml` y los de `LilaPdf` / `LilaXml`. Quedan los de `clave.js`, `normalizeAmount`, `cedulaOk`, `row`/`toReport` y el ida y vuelta por `parseReport`. Añadir dos nuevos:

```ts
test("los rescates de finalize siguen vivos", () => {
  const record = parse.finalize({ total: "7.25", emisor: "TIENDA" }, { cedula: CEDULA });
  assert.equal(record.recipient, CEDULA);
  assert.equal(record.category, "GASTOS PERSONALES");
  assert.equal(record.complete, true);
});

test("los problemas que reporta ai.js entran en missing", () => {
  const record = parse.finalize(
    { total: "7.25", emisor: "X", problems: ["el total no cuadra con base + IVA"] },
    { cedula: CEDULA },
  );
  assert.equal(record.complete, false);
  assert.match(record.missing.join(" "), /no cuadra/);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `parse.finalize` ignora `problems`

- [ ] **Step 3: Podar `parse.js` y añadir la línea de `problems`**

Borrar `KEYWORDS`, `TOTAL_LABELS`, `BASE_LABELS`, `IVA_LABELS`, `BANK_LABELS`, `SERIE`, `CLOCK`, `sideOf`, `amountFor`, `firstAmount`, `recipientFrom`, `reference`, `identityCandidates`, `senderName`, `merchant`, `forwardedSender`, `extract`, `fromXml`, `looksLikeInvoice`. Conservar `tag`, `serieFor`, `today`, `cell`, `amount`.

**`dateFrom` se queda**, contra lo que dice §9 del diseño, con sus regex `FECHA`, `ISO`, `MONTHS` y `LONG`. No es una heurística sobre emisores: es un lector de fechas determinista, y `gmail.js` lo necesita para convertir lo que Gmail pinta en la fila (`row.received`, un título tipo «2 de noviembre de 2026, 10:21») al `DD/MM/YYYY` que espera el rescate de `finalize`. Reimplementarlo en `ai.js` sería el mismo código en otro archivo.

- [ ] **Step 4: Borrar los archivos y actualizar el manifiesto**

```bash
git rm extension/src/xml.js extension/src/pdf.js
```

En `manifest.json`, el primer bloque de `content_scripts` pasa a `["src/clave.js", "src/ai.js", "src/parse.js", "src/gmail-dom.js", "src/panel.js", "src/gmail.js"]`.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A extension tests
git commit -m "refactor(extension): borrar las heurísticas de parse.js, xml.js y pdf.js"
```

---

### Task 6: `gmail.js` — a pedido, y por el modelo

**Files:**
- Modify: `extension/src/gmail.js` — el destructuring de `:2-10`, `scan`/`rescanNow` de `:78-116`, `learnIdentity` de `:187-203`, `recompute` de `:205-260`, `start` de `:380-402`, `globalThis.lila` de `:404-414`.

**Interfaces:**
- Consumes: mensajes `clasificar` / `extraer` de Task 2; `LilaAI.fieldsFrom` de Task 1; `describe` de Task 4.
- Produces: nada nuevo hacia afuera.

- [ ] **Step 1: Quitar el escaneo automático**

El `MutationObserver` de `:396` deja de llamar a `rescan()`: solo marca `state = null` para que el panel sepa que la bandeja cambió. `hashchange` igual. `rescanNow` (el icono de Chrome y «Buscar otra vez») queda como única entrada.

- [ ] **Step 2: `scan()` llama al modelo**

`rescanNow` manda `{type:"clasificar", rows}` con `{id, sender, subject, snippet}` de cada fila y arma los candidatos con las que vuelvan `esGasto: true`. Estado nuevo del panel mientras espera: `{name:"triaging"}`. Sin key, `{name:"error", message:"Falta tu key de Anthropic.", fixable:"key"}`.

- [ ] **Step 3: `recompute()` usa el modelo en vez de `extract`**

Por cada resultado leído, mandar `{type:"extraer", email:{subject, sender, text, attachments}}`, y con la respuesta: `finalize(LilaAI.fieldsFrom(answer, {text: result.text, xmlText, receivedAt: dateFrom(row.received ?? "")}), identity)` — `dateFrom` se conserva en Task 5 justamente para esto. Un `esGasto: false` va a `incomplete` con su `motivo`. Borrar `learnIdentity` entera y su uso en `:206`: la cédula la deduce el modelo.

- [ ] **Step 4: Arreglar `globalThis.lila`**

`probar` desaparece (probaba `looksLikeInvoice`). `revisar`, `escanear`, `discarded`, `forgetDiscarded` quedan.

- [ ] **Step 5: Verificar a mano en Gmail**

Recargar la extensión, abrir Gmail. Expected: el panel **no** aparece solo. Al pulsar el icono de Lila, aparece y dice cuántos correos parecen gastos. «Leer y extraer» produce registros con emisor, monto y serie.

- [ ] **Step 6: Commit**

```bash
git add extension/src/gmail.js
git commit -m "feat(extension): detección y extracción por el modelo, solo a pedido"
```

---

### Task 7: Caché, rechazados y `lila.guardar()`

**Files:**
- Modify: `extension/src/gmail.js`, `extension/background.js`

**Interfaces:**
- Produces: `chrome.storage.local` gana `aiCases` y `aiRejected`; `globalThis.lila.guardar()`.

- [ ] **Step 1: Hash por correo**

`hashOf(email)` = SHA-256 con `crypto.subtle.digest` sobre `sender + subject + text + nombres de adjuntos`, en hex. Antes de `{type:"extraer"}`, mirar `aiCases[hash]`; si está, usarlo y no llamar. Tope 500, se descartan las más viejas.

- [ ] **Step 2: Recordar los rechazados**

`esGasto: false` se guarda en `aiRejected` por `hash`, como ya hace `dropped` con `keyOf`. En el siguiente repaso no se vuelven a mandar.

- [ ] **Step 3: `lila.guardar()`**

Descarga un JSON por correo de la última tanda —`{subject, sender, text, receivedAt, attachments:[{kind, base64}]}`— usando un `Blob` y un `<a download>`. Nombre: `correo-<hash corto>.json`.

- [ ] **Step 4: Añadir `tests/fixtures/correos/` al `.gitignore`**

- [ ] **Step 5: Verificar a mano**

Repasar la bandeja dos veces seguidas. Expected: el segundo repaso no gasta nada y el panel lo dice.

- [ ] **Step 6: Commit**

```bash
git add extension .gitignore
git commit -m "feat(extension): caché por correo, rechazados recordados y lila.guardar()"
```

---

### Task 8: El panel — aviso, gasto y correcciones

**Files:**
- Modify: `extension/src/panel.js` (el `constructor` de `:~20` y el `render` de `:303-350`), `extension/src/gmail.js`

**Interfaces:**
- Consumes: estados nuevos `triaging`, y `ready` gana `cost: {entrada:number, salida:number, dolares:number}`.
- Produces: el constructor gana `onEdit(index, campo, valor)`; `chrome.storage.local` gana `aiLessons` y `aiConsent`.

- [ ] **Step 1: Aviso de privacidad, una vez**

Si `aiConsent` no está, el panel muestra el aviso y un botón «Entendido» **antes** de la primera petición. Se guarda y no vuelve.

- [ ] **Step 2: Estado `triaging` y el gasto de la tanda**

`triaging` dice «mirando la bandeja…». `ready` muestra al pie «esta tanda costó $0,04», sumando `usage` de cada llamada con las constantes de precio del modelo elegido. Un total al final, no un contador en vivo.

- [ ] **Step 3: Edición de campos**

Cada línea de `records` vuelve editable en monto, emisor y fecha. `onEdit` reescribe el registro, **lo vuelve a pasar por `finalize`** (el valor escrito gana: si rompe la aritmética, se avisa pero el registro sigue utilizable) y, si estaba en `incomplete` y ya cumple, lo promueve a `records`.

- [ ] ~~**Step 4: Guardar la lección**~~ — **fuera de alcance.** Las lecciones por emisor (`aiLessons`) se aplazan: es la pieza más compleja del plan y, para una herramienta de uso personal, la caché por correo de Task 7 ya da el ahorro que importa. `extractBody` mantiene el parámetro `lessons` en su firma (Task 1) para que esto se pueda añadir después sin tocar nada más.

- [ ] **Step 5: Verificar a mano**

Corregir un monto. Expected: el total de la tanda cambia, el registro queda listo, y en el siguiente repaso de un correo del mismo emisor el panel acierta sin corrección.

- [ ] **Step 6: Commit**

```bash
git add extension/src/panel.js extension/src/gmail.js
git commit -m "feat(extension): aviso de privacidad, gasto visible y correcciones que enseñan"
```

---

### Task 9: El README dice la verdad

**Files:**
- Modify: `extension/README.md`

- [ ] **Step 1: Reescribir**

Lo que cambia: ya no dice «Nada sale de tu navegador». Dice qué se manda a Anthropic y con qué key. La sección «De dónde salen los datos, en orden de preferencia» y todo lo de `KEYWORDS` / `TOTAL_LABELS` se van: ya no existen. La tabla de archivos pierde `xml.js` y `pdf.js`, gana `ai.js` y `claude.js`. «Volver a buscar» dice que el panel ya no aparece solo y por qué. Límites gana: cuesta dinero, y cuánto.

- [ ] **Step 2: Commit**

```bash
git add extension/README.md
git commit -m "docs(extension): el README cuenta lo que hace ahora"
```

---

### Task 10: Medir contra el informe del SRI (§10.3 del diseño)

El punto de control antes de dar esto por bueno. No escribe código de producto: escribe el script que dice si el cambio mejoró o empeoró.

**Files:**
- Create: `scripts/medir.mjs`
- Requires: `tests/fixtures/correos/` con lo que dejó `lila.guardar()` (Task 7)

**Interfaces:**
- Consumes: `globalThis.LilaAI`, `globalThis.LilaClaude` de Tasks 1 y 2; `1804573770001_Recibidos.txt` como verdad conocida.

- [ ] **Step 1: Escribir el script**

`node scripts/medir.mjs` lee cada JSON de `tests/fixtures/correos/`, manda cada uno por `LilaClaude.call` con la key de `ANTHROPIC_API_KEY`, aplica `fieldsFrom` + `finalize`, y empareja con `1804573770001_Recibidos.txt` **por clave de acceso**, que es única. Imprime una tabla: cuántos correos salieron completos, cuántos emparejaron, y por cada campo (`RUC_EMISOR`, `SERIE_COMPROBANTE`, `FECHA_EMISION`, `VALOR_SIN_IMPUESTOS`, `IVA`, `IMPORTE_TOTAL`) cuántos coinciden exactamente. Al final, el costo real de la corrida.

Nunca se llama desde `npm test`: gasta dinero.

- [ ] **Step 2: Correrlo y separar el grupo con XML**

Run: `ANTHROPIC_API_KEY=... node scripts/medir.mjs`
Expected: la tabla, con los correos que traían XML adjunto contados **aparte** del resto.

- [ ] **Step 3: La decisión, que no es del que programa**

Si el grupo con XML acierta menos campos de los que acertaba `xml.js` —que era exacto por construcción—, **parar y reportar el número**. Volver al híbrido del camino A es decisión del dueño del proyecto. Si acierta igual o más, seguir.

- [ ] **Step 4: Commit**

```bash
git add scripts/medir.mjs
git commit -m "test(extension): medir el modelo contra el informe del SRI"
```
