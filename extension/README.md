# Lila · Gastos desde el correo

Extensión de Chrome que detecta facturas electrónicas en Gmail y las entrega a
Lila. Nada sale de tu navegador: no hay servidor, no hay OAuth, no hay llamadas
a la API de Google. La extensión lee lo que Gmail ya dibujó en la pantalla con
tu propia sesión.

## Cómo funciona

1. Al abrir la bandeja, recorre las filas visibles y marca las que parecen
   facturas, usando remitente, asunto y fragmento. También puedes pedírselo tú:
   **pulsa el icono de Lila en la barra de Chrome** y vuelve a mirar la bandeja
   en ese momento, aunque hayas cerrado el panel antes. Lo automático y el
   botón hacen exactamente lo mismo.
2. Si encuentra alguna, aparece un panel abajo a la derecha: «7 correos parecen
   facturas».
3. **Leer y extraer** abre cada candidato en una **pestaña en segundo plano**
   que no vas a ver, lee su texto y la cierra. Tu bandeja no navega ni se mueve.
   Se leen dos a la vez.
4. El panel lista lo que quedó completo, con emisor, monto, serie y mes, y
   aparte lo que le faltaron datos.
5. **Enviar a Lila** las entrega y te deja donde estabas: no abre ninguna
   pestaña ni te saca de Gmail. El panel dice si Lila ya las está guardando o
   si entrarán cuando la abras, y se cierra con **Listo**. No pide confirmación
   otra vez: ya revisaste la lista.
6. En Lila, cada factura entra en su mes y un aviso dice cuántas entraron,
   cuántas se omitieron por repetidas y cuántas no tenían datos válidos.

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
cédula conocida. Equivocarse hacia ese lado no infla una deducción de IVA,
porque los gastos personales no se deducen.

Si el documento no menciona IVA, no hay nada que separar: el importe total pasa
también como valor sin impuestos.

### Cómo sabe cuál es tu cédula

No hace falta configurarla antes de usarla. En orden:

1. **El XML lo dice.** `identificacionComprador` es tu número, sin ambigüedad, y
   de paso se aprende para los demás correos de la tanda.
2. **Se deduce del RIDE.** Se buscan los números de 10 o 13 dígitos del
   documento, se descarta el RUC del emisor —está dentro de la clave de
   acceso— y se exige el **dígito verificador del registro civil**, que es lo
   que descarta los teléfonos. Se adopta solo si el mismo número aparece en dos
   facturas distintas, y el panel dice cuál dedujo.
3. **La escribes tú**, en Lila → **Configuración**. Lila la guarda en su propia
   base y se la pasa a la extensión.

Mientras no haya ninguna, los correos sin receptor quedan en «sin datos
suficientes» diciendo «falta tu cédula», y el panel ofrece el campo ahí mismo:
al guardarla, la lista se recalcula sin reabrir ningún correo.

### Una factura que emitiste tú no es un gasto tuyo

Si el RUC del emisor —el que va dentro de la clave de acceso— empieza con tu
cédula, la factura es de las que tú emites a tus clientes. No entra como gasto:
queda listada con el motivo «la emitiste tú, no es un gasto».

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

Lila te guía: abre **Gastos por correo** en su menú lateral y sigue los pasos
de la tarjeta. En resumen:

1. Abre `chrome://extensions`, activa **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta `extension/`.
3. Recarga Lila. La tarjeta pasa a «Conectada en este navegador» sola.
4. Pulsa **Usar en Gmail**. Si la bandeja tiene facturas, el panel aparece solo.

Tu cédula se escribe en Lila → **Configuración**, no aquí, y solo si quieres
que el primer escaneo salga completo; si no, la extensión la deduce. La
dirección de Lila que usa la extensión vive en su página de opciones, que se
abre desde el menú de extensiones de Chrome.

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
| `lila:extension-gone`     | El puente        | Lila vuelve a «sin conectar» y pide recargar. |

El puente además le manda al service worker la dirección donde vive esa Lila,
para que «Enviar a Lila» abra la correcta.

Además el puente marca `<html data-lila-extension="versión">`, para que Lila
sepa si está puesta aunque la app cargue después.

### Cómo llegan las facturas a Lila

La extensión **no puede escribir en la base de datos de Lila** desde Gmail: es
otro origen, y ni el service worker ni el panel alcanzan el IndexedDB de la
aplicación. Lo que hace «Enviar a Lila» es dejar el informe en el
almacenamiento de la extensión. De ahí lo recoge el puente, que vive dentro de
la propia página de Lila.

Por eso **Lila tiene que abrirse en algún momento**. Si ya está abierta en otra
pestaña, el puente ve el cambio y lo guarda en segundos, sin que tú cambies de
pestaña. Si no lo está, el informe espera en la cola y entra solo la próxima vez
que la abras. Nada se pierde entre una cosa y la otra: la cola sobrevive a
cerrar Gmail y a reiniciar el navegador.

El panel lo dice con esas mismas palabras al terminar, según encuentre o no una
pestaña de Lila abierta. Para saberlo, la extensión recuerda en qué dirección
vive tu Lila: su puente se lo dice cada vez que carga. Si escribes una dirección
en la página de opciones, esa manda sobre la aprendida; las versiones anteriores
guardaban `http://localhost:5173/` ahí por su cuenta, y al actualizar ese valor
se borra.

**Si tienes Lila abierta dos veces** —producción y `localhost` a la vez— los
registros se los lleva la primera pestaña que alcance la cola. Cierra la que no
uses.

### Si tu Lila vive en un dominio propio

`manifest.json` solo inyecta el puente en `localhost`, `127.0.0.1` y
`*.vercel.app`. Agrega tu dominio al segundo bloque de `content_scripts` y
recarga la extensión.

## Volver a buscar

Tres formas, todas el mismo escaneo:

- **El icono de Lila en la barra de Chrome.** Si no estás en Gmail, lo abre; si
  estás en otra pestaña de Gmail, la enfoca. Si esa pestaña se quedó con un
  script viejo porque recargaste la extensión, la recarga para revivirlo.
- **«Buscar otra vez»** en el panel, después de enviar o cuando no encontró
  nada.
- **Solo**, cuando Gmail cambia la bandeja y el panel no está cerrado.

Cerrar el panel lo calla hasta que cambies de etiqueta o recargues; el botón lo
despierta igual. Si pulsas el icono fuera de una lista de correos —dentro de un
correo abierto, por ejemplo— te lo dice en vez de no hacer nada.

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
| `options.html/.js`   | Dirección de Lila (opcional), cédula y RUC.                     |

`lila:extension-options` sigue funcionando, pero hoy ningún botón de Lila lo
dispara: las opciones se abren desde el menú de extensiones de Chrome.

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
  `BASE_LABELS`, `IVA_LABELS` y `BANK_LABELS`, todas en `src/parse.js`. Hay
  palabras en español y en inglés, porque un recibo de GitHub o de PayPal no
  dice «pago» en ninguna parte. Si un emisor tuyo queda siempre incompleto,
  agrega su etiqueta ahí. Para probar si
  un asunto se detectaría: `lila.probar("Débito a su cuenta por $15")`.
- **Las palabras amplias traen falsos positivos.** «pago» o «consumo» aparecen
  en promociones. Cuestan una pestaña abierta y un correo marcado como leído.
- **Las facturas ya enviadas no se reenvían solas.** Se listan aparte, en «ya
  enviaste antes», con un enlace para incluirlas igual. Antes se descartaban en
  silencio, que es peor que no hacerlo.
- **El informe del SRI sigue siendo la fuente autoritativa.** Esto adelanta el
  registro; no lo reemplaza.
