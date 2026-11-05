# Lila · Gastos desde el correo

Extensión de Chrome que detecta facturas electrónicas en Gmail y las entrega a
Lila. Nada sale de tu navegador: no hay servidor, no hay OAuth, no hay llamadas
a la API de Google. La extensión lee lo que Gmail ya dibujó en la pantalla con
tu propia sesión.

## Cómo funciona

1. Al abrir la bandeja, recorre las filas visibles y marca las que parecen
   facturas, usando remitente, asunto y fragmento.
2. Si encuentra alguna, aparece un panel abajo a la derecha: «7 correos parecen
   facturas».
3. **Leer y extraer** abre cada candidato en una **pestaña en segundo plano**
   que no vas a ver, lee su texto y la cierra. Tu bandeja no navega ni se mueve.
   Se leen dos a la vez.
4. El panel lista lo que quedó completo, con emisor, monto, serie y mes, y
   aparte lo que le faltaron datos.
5. **Enviar a Lila** abre o enfoca la pestaña de Lila y **las guarda ahí
   mismo**, sin pedir confirmación otra vez: ya revisaste la lista en el panel.
   Lila se abre en el mes afectado y un aviso dice cuántas entraron, cuántas se
   omitieron por repetidas y cuántas no tenían datos válidos.

## De dónde salen los datos, en orden de preferencia

1. **El XML adjunto.** Si el correo trae el XML de la factura electrónica, se
   baja y se lee: RUC del emisor, razón social, estab, punto de emisión,
   secuencial, fecha, identificación del comprador, subtotal, IVA e importe
   total. Exacto, sin adivinar, sin reglas por emisor. El panel te dice cuántas
   vinieron por aquí.
2. **El PDF adjunto (el RIDE).** Sin XML, se extrae el texto del PDF con lo que
   el navegador ya trae: se localizan sus flujos de contenido, se descomprimen
   con `DecompressionStream` y se leen las cadenas de texto. De ahí suele salir
   la clave de acceso, y con ella la serie y la fecha exactas.
3. **La clave de acceso en el texto.** Ver abajo.
4. **Las etiquetas del texto.** Montos junto a «IMPORTE TOTAL», «SUBTOTAL SIN
   IMPUESTOS», «IVA 15%», las variantes de los bancos («débito por», «consumo
   de») y las inglesas («Total», «Amount paid»). Es la fuente menos fiable y la
   que hay que afinar por emisor.

Dos cosas del texto de un RIDE, verificadas contra 26 facturas reales:

- **El importe se dibuja antes que su etiqueta**: sale `34.99 VALOR TOTAL`, no
  `VALOR TOTAL 34.99`. El documento mismo decide de qué lado mirar (`sideOf`),
  porque el cuerpo de un correo sí escribe `Total: $10.00`.
- **El flujo comprimido casi nunca termina donde terminan sus datos**: entre
  ellos y `endstream` queda un salto de línea, y `DecompressionStream` lanza
  «trailing junk» *después* de haber entregado todo el contenido. Por eso se lee
  por partes y se conserva lo ya descomprimido en vez de descartarlo.

Los adjuntos se identifican por sus **primeros bytes**, no por su nombre:
`%PDF` es un PDF, `<?xml` o `<factura` un XML, `PK` un `.zip` (que todavía no se
abre).

Del PDF no siempre se saca algo: si está escaneado el texto es una imagen, y si
está cifrado o guarda todo en *object streams* no hay nada que leer. En esos
casos se cae al texto del correo. La clave de acceso se busca también sobre el
texto sin espacios, exigiendo el **dígito verificador módulo 11** para que
juntar números vecinos no fabrique una clave falsa.

Si recargas la extensión con Gmail o Lila abiertos, esas pestañas se quedan con
un script huérfano («Extension context invalidated»). Ahora lo dicen en vez de
fallar en silencio: Lila vuelve a «sin conectar» y el panel pide recargar.

## Clasificación

Vale la regla de Lila: receptor de **13 dígitos** → `APLICABLE IVA` con el valor
sin impuestos; de **10 dígitos** → `GASTOS PERSONALES` con el importe total.

Cuando el correo **no dice** a nombre de quién está —el caso típico de un aviso
del banco— se trata como **gasto personal con el importe total**, usando la
cédula de los ajustes. Equivocarse hacia ese lado no infla una deducción de IVA,
porque los gastos personales no se deducen.

Si no has configurado tu cédula, esos correos quedan en «sin datos
suficientes» diciendo justamente eso, y el panel te ofrece el campo ahí mismo:
al guardarla, la lista se recalcula sin reabrir ningún correo. También se puede
escribir en Lila, en **Facturas por correo**.

## El número del registro

Lila exige un número único por mes. En orden:

1. La **serie del comprobante**, del XML o de la clave de acceso.
2. La **referencia del banco** (número de transacción, autorización,
   comprobante), cuando no hay serie. Es un identificador real, no inventado.
3. Si no hay ninguno de los dos, el correo **no se envía**.

**Consecuencia que conviene tener presente:** un registro numerado con la
referencia del banco **no** se reconoce como duplicado cuando después importes
el informe del SRI, porque ese informe usa la serie. Ese mismo gasto puede
quedar dos veces. Con serie real —o con el XML— el duplicado sí se detecta.

## La clave de acceso es el centro de todo

El cuerpo de un correo rara vez escribe la serie del comprobante, pero casi
siempre incluye la **clave de acceso** de 49 dígitos. Sus posiciones son fijas:

```
ddmmaaaa  tipo  ruc            amb  estab ptoEmi secuencial  numérico  emisión  verif.
   8       2     13             1     3     3        9           8        1        1
```

De ahí salen, sin ambigüedad, la fecha de emisión, el RUC del emisor y la serie
completa. Con la serie real, Lila reconoce la factura cuando después importes el
informe mensual del SRI y no la duplica: su índice único por mes y número hace
el trabajo.

Del texto se leen además la identificación del receptor y los montos. Si el
correo solo trae total e IVA, la base sin impuestos se deduce restando.

La clasificación es la misma regla de Lila, sin excepciones: receptor de **10
dígitos** entra como `GASTOS PERSONALES` con el importe total; de **13 dígitos**
como `APLICABLE IVA` con el valor sin impuestos.

Cuando falta algo, el correo **no** se envía: aparece en «sin datos
suficientes» diciendo qué falta, para que lo agregues a mano. La extensión no
inventa números de factura.

## Instalar

Lila te guía: abre **Facturas por correo** en su menú lateral y sigue los pasos
de la tarjeta. En resumen:

1. Abre `chrome://extensions`, activa **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta `extension/`.
3. Vuelve a Lila. La tarjeta pasa a «Conectada en este navegador» sola.
4. Escribe tu **cédula** y tu **RUC** en esa misma tarjeta y guarda. Se
   guardan en la extensión, en este navegador. La dirección de Lila y el resto
   están en **Más ajustes de la extensión**.
5. Pulsa **Usar en Gmail**. Si la bandeja tiene facturas, el panel aparece solo.

### La conexión entre Lila y la extensión

Las dos se hablan por eventos del documento, que solo puede disparar código del
mismo documento. Ninguna página ajena entra por ahí.

| Evento                    | Quién lo dispara | Qué provoca                               |
| ------------------------- | ---------------- | ----------------------------------------- |
| `lila:ready`              | Lila             | El puente entrega lo que tenga en cola.    |
| `lila:gmail-report`       | El puente        | Lila guarda los registros y avisa.         |
| `lila:extension-ready`    | El puente        | Lila se muestra conectada.                 |
| `lila:extension-ping`     | Lila             | El puente vuelve a anunciarse.             |
| `lila:extension-options`  | Lila             | La extensión abre sus propios ajustes.     |
| `lila:extension-identity` | Lila             | La extensión guarda la cédula y el RUC.    |

Además el puente marca `<html data-lila-extension="versión">`, para que Lila
sepa si está puesta aunque la app cargue después.

### Si tu Lila vive en un dominio propio

`manifest.json` solo inyecta el puente en `localhost`, `127.0.0.1` y
`*.vercel.app`. Agrega tu dominio al segundo bloque de `content_scripts` y
recarga la extensión.

## Diagnóstico

El panel escribe una línea en la consola de Gmail al arrancar y otra con lo que
vio en la bandeja:

```
[Lila] extensión activa en Gmail.
[Lila] bandeja leída: 47 filas, 6 parecen facturas.
```

Si no aparece la primera, el content script no se inyectó: recarga Gmail después
de instalar o recargar la extensión. Si la segunda dice **0 filas**, los
selectores cambiaron.

## Cuando Gmail cambie

Gmail no publica una API de su maquetado ni promete sus clases CSS. Todos los
selectores viven en un solo archivo, `src/gmail-dom.js`, como listas de
candidatos que se prueban en orden. Si el panel deja de aparecer o no logra
abrir los correos, en la consola de Gmail:

```js
lila.revisar(); // qué selector encontró para cada cosa, y cuántas filas ve
lila.escanear(); // fuerza una nueva pasada por la bandeja
```

Un `null` en el reporte dice exactamente qué selector hay que actualizar. Esto
es mantenimiento recurrente, no una instalación de una sola vez.

## Archivos

| Archivo              | Qué hace                                                      |
| -------------------- | ------------------------------------------------------------- |
| `src/clave.js`       | Decodifica la clave de acceso de 49 dígitos.                   |
| `src/xml.js`         | Lee el XML de la factura electrónica, la mejor fuente.          |
| `src/pdf.js`         | Saca texto del PDF sin librerías, de mejor esfuerzo.            |
| `src/parse.js`       | Extrae los campos del texto y los escribe en formato SRI.       |
| `src/gmail-dom.js`   | Todo lo que toca el DOM de Gmail, y nada más.                   |
| `src/panel.js`       | El panel, en un shadow root, con los colores de Lila.           |
| `src/gmail.js`       | Orquesta mirar, ofrecer, leer y enviar; también hace de lectora. |
| `src/bridge.js`      | Entrega el informe a Lila por un evento del documento.          |
| `background.js`      | Abre y cierra las pestañas lectoras, guarda la cola, abre Lila.  |
| `options.html/.js`   | Dirección de Lila, cédula y RUC.                                |

Las piezas que no dependen del navegador se prueban con el resto del proyecto:
`npm test` cubre la clave de acceso, los montos, la clasificación y el ida y
vuelta por `parseReport`.

## Límites, sin adornos

- **Solo Gmail en computadora.** En el celular no hay extensiones de Chrome.
- **Toma tiempo visible.** Entre uno y tres segundos por correo; con treinta
  facturas, «Leer y extraer» es una barra de progreso, no algo instantáneo.
- **Gmail marca como leídos los correos que abre.** Es inevitable leyendo el
  DOM: para que el cuerpo exista, el correo tiene que abrirse.
- **Depende del identificador del hilo.** Si Gmail deja de exponerlo en la
  fila, ese correo se reporta como no legible en vez de abrirse a ciegas.
- **Cada emisor escribe distinto.** Las palabras que disparan la detección
  están en `KEYWORDS`, y las etiquetas de montos en `TOTAL_LABELS`,
  `BASE_LABELS`, `IVA_LABELS` y `BANK_LABELS`, todas en `src/parse.js`. Si un
  emisor tuyo queda siempre incompleto, agrega su etiqueta ahí. Para probar si
  un asunto se detectaría: `lila.probar("Débito a su cuenta por $15")`.
- **Las palabras amplias traen falsos positivos.** «pago» o «consumo» aparecen
  en promociones. Cuestan una pestaña abierta y un correo marcado como leído.
- **Las facturas ya enviadas no se reenvían solas.** Se listan aparte, en «ya
  enviaste antes», con un enlace para incluirlas igual. Antes se descartaban en
  silencio, que es peor que no hacerlo.
- **El informe del SRI sigue siendo la fuente autoritativa.** Esto adelanta el
  registro; no lo reemplaza.
