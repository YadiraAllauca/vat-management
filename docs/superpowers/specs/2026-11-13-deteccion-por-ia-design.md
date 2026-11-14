# Diseño — La IA detecta y extrae, en vez de las reglas

**Fecha:** 2026-11-13
**Alcance:** `extension/` completa. `src/` (la app Lila) no se toca.

---

## 1. Intención y el porqué

Hoy la extensión decide con reglas escritas a mano. `KEYWORDS` (33 palabras) dice
qué fila de la bandeja parece una factura. `TOTAL_LABELS`, `BASE_LABELS`,
`IVA_LABELS` y `BANK_LABELS` dicen qué número de un correo es dinero. `merchant`
exige mayúsculas después de «en» para adivinar qué comercio vendió;
`forwardedSender` busca cabeceras de reenvío; `sideOf` decide si la etiqueta va
antes o después del monto.

Cada emisor que escribe distinto es una línea más en esas listas. El README lo
admite: *«Si un emisor tuyo queda siempre incompleto, agrega su etiqueta ahí».*
Eso es mantenimiento sin fin, y mientras tanto los correos quedan incompletos.

El cambio: un modelo de Anthropic mira cada correo entero —asunto, cuerpo, XML
adjunto, PDF adjunto— y decide él de dónde sale cada dato. Lo que hoy se afina
agregando palabras a una lista, mañana se afina corrigiendo un caso.

## 2. Objetivos

- Ninguna palabra clave ni etiqueta de monto decide nada.
- El modelo ve el correo completo, adjuntos incluidos, y devuelve el registro
  estructurado. Él decide si usa el XML, el PDF o el texto.
- Un correo ya resuelto no se vuelve a pagar.
- Lo que el usuario corrige a mano se guarda y vuelve como contexto la próxima
  vez que llegue un correo de ese mismo emisor.
- La clasificación sigue siendo la de Lila: receptor de 13 dígitos →
  `APLICABLE IVA` con el valor sin impuestos; de 10 → `GASTOS PERSONALES` con el
  importe total.

## 3. No objetivos

- Lila no cambia. El informe TSV, su cabecera, el puente y la cola siguen iguales.
- No cambia el flujo de abrir pestañas lectoras en segundo plano, ni el panel, ni
  cómo llegan los registros a Lila.
- No se agrega backend ni proxy. La petición sale del navegador del usuario con
  su propia key.
- No se toca el aviso de vencimientos del SRI (`docs/handoff-avisos-sri.md`): es
  otro trabajo.

## 4. Anti-objetivos — qué haría fracasar esto aunque funcione

- **Que un gasto entre a Lila con un monto o un RUC inventado.** Un dato
  equivocado en una declaración es peor que un correo no detectado. De aquí sale
  toda la sección 7.
- **Que el usuario se entere del costo por la factura de Anthropic.** El panel
  tiene que decir cuánto se gastó.
- **Que la key se pueda leer desde la página de Gmail.**

## 5. Restricciones

- Extensión MV3 **sin build**: `manifest.json` carga los `.js` crudos. No hay
  bundler para `extension/`, así que no se usa `@anthropic-ai/sdk`; se llama al
  endpoint REST con `fetch`. (Decisión mía, por no meter un paso de compilación
  en una carpeta que hoy se carga descomprimida. Si prefieres el SDK, es
  agregar vite a `extension/` y cambia el flujo de instalación.)
- La llamada vive en `background.js` (service worker), nunca en el content
  script: así la key no está en el contexto de la página de Gmail, y un service
  worker con `host_permissions` no está sujeto a CORS como sí lo está un content
  script desde Chrome 73.
- `chrome.storage.local` da 10 MB sin el permiso `unlimitedStorage`.
- `npm test` corre con `node --test` y **no puede tocar la red**.

## 6. Caminos considerados

**A — La IA lee, el XML se parsea antes en código.** El XML adjunto se
decodifica con `xml.js` como hoy y solo lo demás va al modelo.
*A favor:* los datos del XML quedan exactos por construcción.
*En contra:* deja una rama que no es IA y, sobre todo, obliga a decidir **en
código** si el XML sirve — que es justo la decisión que se quería mover al
modelo.

**B — La IA lo decide todo, incluida la lectura del XML y del PDF.**
*A favor:* una sola cabeza decide; el modelo ve el XML, el PDF y el texto a la
vez y resuelve cuál manda. Es lo que pediste.
*En contra:* se paga por leer datos que ya eran exactos, y un modelo puede
cambiar un dígito de un RUC donde `xml.js` no se equivoca nunca.

**C — Solo la extracción pasa a IA; el filtro de la bandeja sigue con palabras
clave.** Más barato, pero deja `KEYWORDS` viva, que es la mitad del problema.

**Elegido: B, con verificadores.** El modelo recibe todo y decide; lo que queda
de código no adivina, **comprueba** (sección 7). Así se gana la cabeza única sin
quedar a merced de un dígito mal copiado. C queda descartado por dejar las
palabras clave vivas; A, por dejar la decisión en el código.

## 7. Lo que sigue siendo código: los verificadores

Nada de esto adivina. Todo revisa lo que el modelo devolvió, y lo que no pasa el
examen cae en «sin datos suficientes» en vez de entrar mal a Lila.

- **`clave.js` se queda entero.** Si el modelo devolvió una clave de acceso de 49
  dígitos, se exige el módulo 11 y se decodifica: de ahí salen fecha, RUC del
  emisor y serie **sin ambigüedad**. Si no coinciden con lo que dijo el modelo,
  manda la clave. Es el verificador más fuerte que hay.
  Además, `clave.all()` sigue recorriendo el texto del cuerpo y del XML por su
  cuenta, buscando claves válidas. Es gratis, es determinista y no se equivoca
  nunca, así que atrapa al modelo cuando omite la clave o le cambia un dígito.
  Esto **no** es volver a las reglas: no decide si el correo es un gasto, solo
  corrige un campo contra una fuente exacta.
- **`cedulaOk`** — dígito verificador del registro civil sobre el receptor de 10
  dígitos.
- **Aritmética** — `valorSinImpuestos + iva` tiene que dar `importeTotal`
  (±0,02). Si el documento no menciona IVA, el total pasa también como valor sin
  impuestos, como hoy.
- **Formato** — montos `^\d+(\.\d{1,2})?$`, fecha `YYYY-MM-DD`, RUC 13 dígitos,
  cédula 10.
- **La factura que emitiste tú** — si el RUC del emisor empieza con tu cédula, no
  es un gasto. Sigue descartándose en código.
- **La clasificación IVA / gastos personales la aplica el código**, a partir del
  receptor que devolvió el modelo. Decisión mía: es la regla de Lila, es de una
  línea y es determinista. El modelo aporta el dato (quién es el receptor), no la
  política.

### 7.1 Los rescates de `finalize` se quedan

`finalize` hace hoy tres cosas que **no** son adivinar quién escribió el correo,
sino aplicar la política de Lila cuando falta un dato. Las tres sobreviven, y es
importante que así sea: sin ellas, la mayoría de los avisos de banco —que nunca
dicen a nombre de quién están ni traen fecha de emisión— caerían en «sin datos
suficientes» y el cambio empeoraría la extensión en vez de mejorarla.

- `recipient = <el que dijo el modelo> ?? identity.cedula`. El esquema de §8.3
  permite `identificacionReceptor: null` justamente porque este rescate existe.
- `fecha = <la del documento> ?? email.receivedAt`, marcando `guessedDate: true`.
- `base = total − iva` cuando el modelo no devolvió la base.

Lo que sí desaparece es `identityCandidates`, la heurística que deduce tu cédula
rastreando números de 10 dígitos en el RIDE: ahora es trabajo del modelo, que ve
el documento entero y puede decir «el comprador es este». El flujo del panel que
te pide la cédula cuando no hay ninguna (`needsId` / `fixable` / `onSaveId`) y los
campos de cédula y RUC en las opciones **se quedan tal cual**.

## 8. Cómo funciona

### 8.1 Dos llamadas, dos momentos

**Pasada 1 — la bandeja.** Una sola llamada con las ~50 filas visibles
(remitente, asunto, fragmento). Devuelve, por fila, si parece un comprobante de
gasto. Reemplaza `looksLikeInvoice`. Una llamada, no cincuenta.

**Solo a pedido.** Hoy `scan()` se dispara solo, con un `MutationObserver` sobre
`document.body` y `hashchange`, porque comparar palabras clave es gratis. Eso se
acaba: la pasada 1 corre **únicamente** cuando el usuario pulsa el icono de Lila
o «Buscar otra vez». El panel deja de aparecer por su cuenta. Es una pérdida real
de comodidad y se acepta a cambio de dos cosas: nunca se gasta sin pedirlo, y el
aviso de privacidad llega siempre antes que la primera petición. El
`MutationObserver` se queda solo para saber que la bandeja cambió y marcar el
resultado anterior como viejo, sin llamar a nadie.

**Pasada 2 — cada correo.** Una llamada por correo abierto. Entra: asunto,
remitente, fecha recibida, texto del cuerpo, el XML adjunto **como texto**, y el
PDF adjunto **como bloque `document` en base64**. Sale: el registro.

Que el PDF vaya como documento nativo es una mejora real sobre hoy: `pdf.js`
falla con los RIDE escaneados y con los que guardan el texto en *object
streams*; el modelo los lee igual porque los ve.

### 8.2 La petición

```
POST https://api.anthropic.com/v1/messages
x-api-key: <la key del usuario>
anthropic-version: 2026-10-21
content-type: application/json
anthropic-dangerous-direct-browser-access: true
```

La versión `2026-10-21` y ese último encabezado salen de leer el SDK oficial
(v1.8.0), no de memoria; el porqué del encabezado está en §11.1.

Cuerpo:

- `model`: `claude-opus-5-5` por defecto.
- `max_tokens`: 4000.
- `output_config`: `{ effort: "low", format: <json schema> }`. Salida
  estructurada, para que la respuesta sea JSON válido contra el esquema y no
  prosa que haya que raspar.
- **Sin `thinking`**: en Opus 5.5 el pensamiento está siempre activo y
  `{type:"disabled"}` o `budget_tokens` dan 400. El control es `effort`, y para
  extracción `low` basta.
- **Sin `temperature` / `top_p` / `top_k`**: en la versión `2026-10-21` dan 400.
- `betas: ["server-side-fallback-2026-07-01"]` y `fallbacks: "default"`. Si el
  clasificador de seguridad rechaza un correo, otro modelo lo atiende dentro de
  la misma llamada en vez de dejar el correo sin resultado. Se puede quitar si no
  lo quieres.
- `system` con `cache_control: {type:"ephemeral"}`. Si el prompt no llega al
  mínimo cacheable del modelo no cachea y no pasa nada; se comprueba mirando
  `usage.cache_read_input_tokens`, no se promete.

### 8.3 El esquema de salida

Un objeto por correo:

| campo | tipo | nota |
|---|---|---|
| `esGasto` | bool | falso para promociones, recordatorios, facturas que emitiste |
| `motivo` | string | por qué sí o por qué no; va a la consola y al panel |
| `emisor` | string | quién vendió, no quién mandó el correo |
| `rucEmisor` | string\|null | 13 dígitos |
| `claveAcceso` | string\|null | 49 dígitos |
| `serie` | string\|null | `001-001-000000123` |
| `fecha` | string\|null | `YYYY-MM-DD`, la de emisión |
| `identificacionReceptor` | string\|null | 10 o 13 dígitos; null si el correo no lo dice |
| `valorSinImpuestos` | string\|null | |
| `iva` | string\|null | |
| `importeTotal` | string\|null | |
| `referenciaBanco` | string\|null | número de transacción o autorización |
| `fuente` | enum | `xml` \| `pdf` \| `texto` — de dónde dice el modelo que lo sacó |

### 8.4 Qué modelo y qué cuesta

`claude-opus-5-5` por defecto. En la página de opciones se puede cambiar a
`claude-sonnet-5-5` o `claude-haiku-5-5`. **No lo bajo yo**: es tu factura y tu
exactitud, y esa decisión es tuya.

Órdenes de magnitud con Opus 5.5 ($4/MTok de entrada, $20/MTok de salida):

| | estimado |
|---|---|
| una pasada de bandeja, 50 filas | ~$0,015 |
| un correo de texto | ~$0,01 |
| un correo con RIDE en PDF | ~$0,02–0,05 |
| una tanda de 30 facturas | ~$1 |

**Son estimaciones, no medidas.** El primer paso de la implementación mide con
`usage` real y corrige esta tabla. El panel muestra el gasto de la tanda.

### 8.5 Lo que se guarda — «que vaya guardando casos»

En `chrome.storage.local`:

- **`aiCases`** — por correo: `{ hash, record, modelo, fecha }`, donde `hash` es
  SHA-256 de remitente + asunto + texto + nombres de adjuntos. Un segundo repaso
  de la misma bandeja no llama a nadie y no cuesta nada. Tope 500 entradas; se
  descartan las más viejas.
- **`aiLessons`** — por dominio del remitente, hasta 3 ejemplos
  `{ antes, después, nota }`, guardados cuando corriges un dato en el panel. Se
  inyectan en el `system` de los correos de ese mismo emisor.
  `nota` se arma **sola**, no la escribe el usuario: es «el campo `total` decía
  12,60 y debía decir 7,25». Corregir un dato tiene que costar un clic y una
  tecla, no redactar una explicación.
- **`aiRejected`** — los correos que la pasada 2 devolvió con `esGasto: false`,
  guardados por `hash` como ya se guardan los que quitas a mano (`dropped`). Se
  listan en «sin datos suficientes» con el `motivo` que dio el modelo, y no se
  vuelven a pagar en el siguiente repaso.

Un registro que corriges a mano **vuelve a pasar por los verificadores de §7**,
con una excepción: el valor que escribiste tú gana. Si tu corrección rompe
`base + iva = total`, el aviso aparece pero el registro queda utilizable — tú
viste la factura, el modelo no. Corregir un correo que estaba en «sin datos
suficientes» lo promueve a la lista de listos si con el dato nuevo ya cumple.

El modelo no se entrena: ve lo que ya corregiste. Eso es lo que sustituye a
«agrega tu etiqueta a `TOTAL_LABELS`».

### 8.6 Sin key

Sin key no hay detección, y el panel lo dice con un enlace a las opciones. **No
hay respaldo por palabras clave**: lo pediste así, y mantener dos caminos es
volver a mantener las reglas que estamos borrando.

### 8.7 Errores

| caso | qué pasa |
|---|---|
| 401 | «tu key no es válida», enlace a opciones |
| 429 | espera el `retry-after` y reintenta una vez; si vuelve, el correo queda para reintentar |
| 500 / 529 | dos reintentos con espera creciente |
| `stop_reason: "refusal"` tras los fallbacks | el correo cae en «sin datos suficientes» diciendo que el modelo no quiso leerlo |
| JSON que no valida contra el esquema | lo mismo, sin romper la tanda |

Concurrencia: 2 correos a la vez, como hoy.

### 8.8 Privacidad, dicha en voz alta

Esto deja de ser cierto: *«Nada sale de tu navegador: no hay servidor, no hay
OAuth, no hay llamadas a la API de Google»*. Hay que decirlo, no dejarlo de
decir.

- **README** reescrito: qué se manda, a quién, con qué key.
- **Panel**, la primera vez: aviso de una línea con «entendido», guardado.
- **Opciones**: campo de key (`type="password"`), selector de modelo, y el texto
  de qué viaja a Anthropic.
- La key **solo** vive en el service worker. El content script nunca la ve: manda
  el correo por `chrome.runtime.sendMessage` y recibe el registro.
- `manifest.json` suma `https://api.anthropic.com/*` a `host_permissions`.

## 9. Qué se borra, qué se queda

| Archivo | Qué pasa |
|---|---|
| `src/parse.js` | Pierde `KEYWORDS`, las cuatro listas de etiquetas, `amountFor`, `sideOf`, `merchant`, `forwardedSender`, `senderName`, `firstAmount`, `dateFrom`, `recipientFrom`, `reference`, `identityCandidates`, `looksLikeInvoice`, `extract`, `fromXml`. Se queda con `HEADER`, `normalizeAmount`, `cedulaOk`, `row`, `toReport`, el número armado (`tag`, `serieFor`, `today`) y `finalize` reescrito como verificador. |
| `src/xml.js` | **Se borra.** El XML va al modelo como texto. |
| `src/pdf.js` | **Se borra.** El modelo lee el PDF nativo, escaneados incluidos. |
| `src/clave.js` | Se queda entero, ahora como verificador. |
| `src/ai.js` | **Nuevo.** Arma el cuerpo de la petición y valida la respuesta. Puro: sin `fetch`, sin DOM, sin `chrome`. Es lo que se prueba. |
| `background.js` | Nuevo rol: dueño de la key y único que habla con la API. |
| `src/gmail.js` | Pide al service worker en vez de llamar a `looksLikeInvoice` / `extract`. |
| `src/panel.js` | Aviso de privacidad, estado «consultando…», gasto de la tanda y edición de campos. |
| `src/gmail-dom.js` | `readAttachments` deja de convertir adjuntos a texto con `describe()` y pasa los bytes crudos en base64 con su tipo. Gana una cosa nueva: **descomprimir el ZIP** (ver abajo). |
| `options.html/.js` | Campo de key y selector de modelo. |
| `tests/email.test.ts` | Reescrito (sección 10). |

**Los adjuntos, en detalle.** `describe()` hoy identifica el tipo por los primeros
bytes (`%PDF`, `<?xml`, `PK`) y lo convierte a texto. Con `xml.js` y `pdf.js`
borrados ya no hay a qué convertir, pero el reconocimiento por bytes se queda:
decide si el adjunto viaja como bloque `document` (PDF) o como texto (XML).

- **ZIP.** Hoy se reconoce y no se abre, y en Ecuador es común que el emisor mande
  el XML comprimido. Ahora hay que abrirlo en el content script: `DecompressionStream`
  con `deflate-raw` sobre la entrada del contenedor. Es la pieza de trabajo real
  que crece en este archivo; si se complica, el ZIP se reporta como «no legible»
  y el correo cae en «sin datos suficientes» en vez de bloquear el resto.
- **Tope de 3 adjuntos / 4 MB** cada uno: se queda como está. Si hay un cuarto, se
  ignora y se dice en el `motivo`.
- **Un PDF que no entra** en los límites de la API se omite y el correo se
  resuelve con el texto del cuerpo, diciéndolo.

## 10. Tests

### 10.1 El prompt se escribe sin corpus; el corpus llega después

El banco de pruebas no existe —el README dice que las reglas se verificaron
«contra 26 facturas reales», pero esas facturas no quedaron en el repositorio—, y
**aun así el prompt se escribe antes de tenerlo**. Dos razones:

- **La salida está especificada, no hay que descubrirla.** Las doce columnas del
  informe del SRI son exactamente la cabecera de `HEADER` en `parse.js`, y
  `1804573770001_Recibidos.txt` tiene 33 filas reales que muestran cómo se ve
  cada campo lleno. El esquema de §8.3 sale de ahí, literalmente.
- **La entrada es un género conocido.** Una factura electrónica ecuatoriana y un
  aviso de consumo de banco son formatos reconocibles; pedirle a un modelo que
  distinga uno de una promoción no requiere mostrarle ejemplos tuyos primero.

Lo que **sí** hace falta el corpus es para *medir* —afinar con números en vez de
con impresiones, y repetir mañana la prueba de hoy—, y eso llega solo:

- `lila.guardar()`, un comando de diagnóstico en la consola de Gmail junto a
  `lila.revisar()`, descarga lo que la tanda **acaba de leer**: asunto,
  remitente, texto y cada adjunto en base64 con su tipo, un JSON por correo;
- corre **durante el primer repaso de verdad**, el que ibas a hacer de todos
  modos. El corpus es un residuo de usar la extensión, no una tarea previa;
- va a `tests/fixtures/correos/`, **ignorado por git**: son facturas reales con
  identificadores reales. Nunca se publica;
- `1804573770001_Recibidos.txt` da la verdad conocida para los correos que se
  emparejen por clave de acceso. El emparejamiento es automático: la clave es
  única.

Hasta entonces, los fixtures sintéticos de hoy sostienen los tests de `ai.js`.

### 10.2 Los dos niveles

**Sin red — lo que corre en `npm test`.** Todo sobre `ai.js`, que es puro:

- que el cuerpo de la petición se arme bien: adjuntos en su sitio, lecciones del
  emisor incluidas, esquema correcto;
- que una respuesta del modelo (fixtures JSON guardados, una por correo real) se
  valide, se verifique contra la clave de acceso, se clasifique y produzca el TSV
  esperado;
- que una respuesta cuyo `valorSinImpuestos + iva` no cuadra con el total caiga
  en «sin datos suficientes»;
- que un JSON roto o un campo de más no rompan la tanda;
- `clave.js` y `cedulaOk` siguen con sus tests de hoy.

**Con red — a mano, nunca en `npm test`.** Un script que manda los correos del
corpus y reporta cuántos salen completos y cuántos coinciden con la verdad
conocida. Es lo único que dice si el prompt sirve. Cuesta dinero: se corre
cuando se cambia el prompt.

### 10.3 El listón para soltar esto

El camino elegido borra `xml.js`, que hoy es **exacto por construcción** para los
correos que traen XML. Los verificadores de §7 no lo reemplazan del todo: la
clave de acceso respalda fecha, RUC y serie, pero nadie respalda la razón social,
la identificación del comprador ni los montos más allá de que cuadren entre sí
—y un modelo que copie base e IVA de la factura equivocada pasa esa prueba.

Por eso el plan lleva un punto de control explícito, no una decisión que el
constructor tome solo al final: cuando el corpus exista y el prompt esté afinado,
se mide **aparte** el grupo de correos con XML y se compara con lo que saca el
código de hoy. Si sale peor, se reporta el número y se para. Volver al híbrido
del camino A es una decisión del dueño del proyecto, no del que programa.

## 11. Riesgos

1. **CORS desde el service worker.** Un service worker MV3 con `host_permissions`
   normalmente no está sujeto a CORS, pero no lo doy por hecho. La documentación
   pública de Anthropic no menciona CORS ni el encabezado, pero el **código del
   SDK oficial sí**: `@anthropic-ai/sdk` 1.8.0 manda
   `anthropic-dangerous-direct-browser-access: true` en cada petición cuando se
   construye con `dangerouslyAllowBrowser` (`src/client.ts:2098`). O sea: el
   permiso existe y es explícito. Detalle que importa: el SDK decide «esto es un
   navegador» mirando `window` y `window.document`
   (`src/internal/detect-platform.ts:3`), y un service worker MV3 no tiene
   ninguno de los dos — así que **el SDK no mandaría ese encabezado desde ahí**.
   Por eso la petición de prueba manda las dos variantes, con y sin.
   **Si las dos fallan en el navegador, el plan se detiene y se vuelve a hablar.**
   No hay rama de proxy: contradiría §3 y es un segundo producto, no un parche.
2. **La forma exacta de `output_config.format` y de `fallbacks`** se confirma
   contra la documentación viva antes de escribir el cliente, no de memoria. Si
   `betas: ["server-side-fallback-2026-07-01"]` no existiera en la versión
   `2026-10-21`, se quita y la única red de seguridad ante un rechazo es la fila
   de `stop_reason: "refusal"` de §8.7 — que basta, porque un correo rechazado
   cae en «sin datos suficientes» y no entra mal a Lila.
3. **Un modelo puede cambiar un dígito.** Para eso están los verificadores, y por
   eso la clave de acceso manda sobre lo que diga el modelo.
4. **El costo es real y por repaso.** La caché por correo es lo que lo hace
   soportable; si falla, cada vez que mires la bandeja pagas de nuevo.

## 12. Lo que queda al constructor

- **El texto del system prompt.** Es lo que antes eran las listas de palabras;
  ahora es prosa. Se afina con el banco de pruebas, no de una sentada.
- Si el filtro de bandeja y la extracción comparten un prompt o son dos.
- Cómo se dibuja la edición de campos en el panel.
- La conversión de fechas entre el `YYYY-MM-DD` del esquema y el `DD/MM/YYYY` del
  TSV, la forma interna de `ai.js` y las constantes de precio para mostrar gasto.
- El orden: (0) la petición de prueba — **si falla, nada más empieza**;
  (1) el cliente en el service worker, el prompt escrito desde el formato del SRI
  y la extracción por correo, con `lila.guardar()` montado desde el principio;
  (2) el filtro de bandeja a pedido; (3) la caché y los rechazados; (4) el primer
  repaso de verdad, que deja el corpus, y con él el punto de control de §10.3
  sobre los correos con XML; (5) las lecciones y la edición en el panel.
  La (5) es la única que se puede dejar para después sin que lo demás quede a
  medias; la (0) no se puede saltar.
