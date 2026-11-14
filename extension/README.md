# Lila · Gastos desde el correo

Extensión de Chrome que encuentra facturas y gastos en tu Gmail y los entrega a
Lila. Un modelo de Anthropic lee cada correo, con tu propia key.

## Tus correos salen de este navegador

El asunto, el remitente, el cuerpo y los adjuntos de los correos que elijas
revisar viajan a la API de Anthropic para que un modelo los lea. Tenlo presente
antes de usarla.

Lo que no sale: no hay servidor propio, no hay OAuth, no hay llamadas a la API
de Google. La extensión lee lo que Gmail ya dibujó con tu sesión, y la key vive
solo en este navegador. A Lila no llega nunca.

Nada se manda sin que lo pidas: el panel solo aparece cuando pulsas.

## Cómo funciona

1. **Pulsas el icono de Lila** en la barra de Chrome. Una sola consulta con las
   filas visibles de la bandeja —remitente, asunto, fragmento— pregunta cuáles
   parecen un gasto. Una consulta, no cincuenta.
2. Aparece el panel abajo a la derecha: «7 correos parecen gastos».
3. **Leer y extraer** abre cada candidato en una **pestaña en segundo plano**
   que no vas a ver, lee su texto y sus adjuntos y la cierra. Tu bandeja no
   navega. Se leen dos a la vez.
4. Cada correo va al modelo con todo lo que traía —texto, XML y PDF adjuntos— y
   vuelve con los campos del comprobante. El modelo decide de dónde saca cada
   dato: si hay XML, manda el XML; si solo hay RIDE, lo lee; si no hay nada
   adjunto, se arregla con el cuerpo.
5. El panel lista lo que quedó completo y, aparte, lo que no. **Puedes corregir
   el emisor y el importe ahí mismo**: lo que escribes manda sobre lo que dijo
   el modelo. La «×» quita una línea y no vuelve a ofrecerse.
6. **Enviar a Lila** las entrega y te deja donde estabas.
7. Al pie, lo que costó la tanda.

## Lo que comprueba el código

El modelo lee; el código comprueba. Nada de esto adivina:

- **La clave de acceso de 49 dígitos.** Se busca también por cuenta propia en el
  texto y en el XML, exigiendo el **dígito verificador módulo 11**. Si aparece,
  de ella salen la fecha, el RUC del emisor y la serie **sin ambigüedad**, y lo
  que diga el modelo sobre esos tres campos no cuenta. Una clave que no pasa el
  módulo 11 se descarta entera y se avisa.
- **El dígito verificador del registro civil** sobre el receptor de 10 dígitos.
  Un RUC de 13 no pasa por ahí: el de sociedades y el del sector público usan
  otro algoritmo.
- **La aritmética**: `valor sin impuestos + IVA` tiene que dar el importe total.
  Si no cuadra, el correo cae en «sin datos suficientes» en vez de entrar mal.
- **El formato**: el RUC del emisor son trece dígitos o no es nada.
- **La clasificación**, que es la regla de Lila y no una opinión: receptor de
  **13 dígitos** → `APLICABLE IVA` con el valor sin impuestos; de **10 dígitos**
  → `GASTOS PERSONALES` con el importe total.
- **La factura que emitiste tú**: si el RUC del emisor empieza con tu cédula, no
  es un gasto.

Cuando el correo no dice a nombre de quién está —el caso típico de un aviso de
banco— se usa tu cédula y entra como gasto personal con el importe total.
Equivocarse hacia ese lado no infla una deducción de IVA.

## Lo que se guarda

- **Un correo ya leído no se vuelve a pagar.** El resultado se guarda por correo,
  con un hash del remitente, el asunto, el cuerpo y el contenido de los
  adjuntos; el segundo repaso de la misma bandeja no llama a nadie.
- Los que el modelo descartó quedan recordados con su motivo.
- Las facturas que quitaste con la «×».

## El número del registro

Lila exige un número único por mes. En orden: la **serie** del comprobante; la
**referencia del banco**; o, si no hay ninguna, un número armado con la fecha y
el remitente (`SN-20261109-CAFETERIANAN-7F3A`), marcado en el panel como
«número que le puse yo».

**Consecuencia:** un registro numerado con la referencia del banco o con un
número armado **no** se reconoce como duplicado cuando después importes el
informe del SRI, porque ese informe usa la serie.

## Instalar

1. Abre `chrome://extensions`, activa **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta `extension/`.
3. Crea tu archivo de key a partir de la plantilla:

   ```sh
   cp extension/key.local.example.js extension/key.local.js
   ```

   Dentro, `LILA_KEY` es tu key —se crea en console.anthropic.com → Settings →
   API keys, y solo se ve entera al crearla— y `LILA_MODEL` el modelo.
   `key.local.js` está en `.gitignore`. **La key no va en
   `key.local.example.js`**, que es la plantilla y sí se sube al repositorio.
4. Vuelve a `chrome://extensions` y **recarga** la extensión: el service worker
   lee ese archivo al arrancar. Cada vez que lo edites, recarga.
5. Ponle un límite de gasto mensual en Settings → Limits. Esto cuesta dinero.
6. Recarga Lila y pulsa **Usar en Gmail**.

Tu cédula se escribe en Lila → **Configuración**, y solo si quieres; el modelo
suele deducirla del propio documento.

## Lo que cuesta

Con `claude-sonnet-5-5`, el modelo por defecto:

| | aproximado |
| --- | --- |
| una pasada de bandeja, 50 filas | $0,008 |
| un correo de texto | $0,005 |
| un correo con RIDE en PDF | $0,01–0,025 |
| una tanda de 30 facturas | ~$0,50 |

Son estimaciones. El panel te dice lo que costó de verdad cada tanda. En
`key.local.js` puedes cambiar a `claude-opus-5-5` (el doble de caro, el más
exacto) o `claude-haiku-5-5` (el más barato); ten presente que lo que se
equivoca aquí termina en una declaración.

## La conexión entre Lila y la extensión

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

### Cómo llegan las facturas a Lila

La extensión **no puede escribir en la base de datos de Lila** desde Gmail: es
otro origen. «Enviar a Lila» deja el informe en el almacenamiento de la
extensión, y de ahí lo recoge el puente, que vive dentro de la propia página de
Lila. Por eso **Lila tiene que abrirse en algún momento**. Si ya está abierta,
entra en segundos; si no, la cola espera y sobrevive a cerrar Gmail y a
reiniciar el navegador.

**Si tienes Lila abierta dos veces** —producción y `localhost`— los registros se
los lleva la primera pestaña que alcance la cola. Cierra la que no uses.

### Si tu Lila vive en un dominio propio

`manifest.json` solo inyecta el puente en `localhost`, `127.0.0.1` y
`*.vercel.app`. Agrega tu dominio al segundo bloque de `content_scripts`.

## Volver a buscar

Dos formas, las dos a pedido:

- **El icono de Lila en la barra de Chrome.** Si no estás en Gmail, lo abre.
- **«Buscar otra vez»** en el panel.

Cambiar de etiqueta cierra el panel y espera a que lo llames. Mirar la bandeja
cuesta dinero, así que nunca ocurre solo.

## Diagnóstico

En la consola de Gmail:

```js
lila.revisar(); // qué selector encontró para cada cosa, y cuántas filas ve
lila.escanear(); // fuerza una nueva pasada (cuesta dinero)
lila.guardar(); // descarga los correos de la última tanda, para los tests
lila.discarded(); // las que quitaste de la lista
lila.forgetDiscarded(); // las devuelve todas
```

`lila.guardar()` es cómo se arma el banco de pruebas: haces un repaso normal y
descarga lo que acaba de leer —texto y adjuntos— a archivos JSON. Van a
`tests/fixtures/correos/`, que git ignora porque son tus facturas reales. Con
ellos, `node scripts/measure.mjs` compara lo que saca el modelo contra tu informe
del SRI, emparejando por clave de acceso.

Si el panel no aparece o no logra abrir los correos, un `null` en
`lila.revisar()` dice exactamente qué selector hay que actualizar en
`src/gmail-dom.js`. Esto es mantenimiento recurrente: Gmail no promete sus
clases CSS.

## Archivos

| Archivo              | Qué hace                                                      |
| -------------------- | ------------------------------------------------------------- |
| `key.local.js`       | Tu key y el modelo. Ignorado por git; lo lee solo el service worker. |
| `src/ai.js`          | El contrato con el modelo: esquema, prompts, verificadores. Puro. |
| `src/claude.js`      | La única pieza que llama a `api.anthropic.com`.                 |
| `src/clave.js`       | Decodifica y verifica la clave de acceso de 49 dígitos.         |
| `src/parse.js`       | Aplica la regla de Lila y escribe el formato del SRI.           |
| `src/gmail-dom.js`   | Todo lo que toca el DOM de Gmail, y nada más.                   |
| `src/panel.js`       | El panel, en un shadow root, con los colores de Lila.           |
| `src/gmail.js`       | Orquesta mirar, ofrecer, leer y enviar; también hace de lectora. |
| `src/bridge.js`      | Entrega el informe a Lila por un evento del documento.          |
| `background.js`      | Dueño de la key. Abre las pestañas lectoras y guarda la cola.   |
| `options.html/.js`   | Dirección de Lila, cédula y RUC.                                |

`npm test` cubre las piezas que no dependen del navegador: la clave de acceso,
los verificadores, el armado de las peticiones, la lectura de las respuestas y
el ZIP de los adjuntos. Ninguna prueba toca la red.

## Límites, sin adornos

- **Cuesta dinero, y por repaso.** La caché por correo es lo que lo hace
  soportable.
- **Sin key no hace nada.** No hay respaldo por palabras clave: mantener dos
  caminos sería mantener dos cosas que pueden discrepar.
- **La key está en claro en `key.local.js`.** Si comprimes la carpeta
  `extension/` para pasársela a alguien, la key va dentro.
- **Solo Gmail en computadora.** En el celular no hay extensiones de Chrome.
- **Toma tiempo visible.** Los correos se leen de uno en uno: con treinta
  facturas, «Leer y extraer» son varios minutos y no hay contador ni forma de
  cancelar.
- **Gmail marca como leídos los correos que abre.** Es inevitable leyendo el DOM.
- **Un modelo puede cambiar un dígito.** Para eso están los verificadores, y por
  eso la clave de acceso manda sobre lo que diga el modelo. Pero lo que ningún
  verificador cubre —la razón social, el nombre del comercio— va sin red.
- **Una nota de crédito no entra**: los importes negativos se descartan.
- **El informe del SRI sigue siendo la fuente autoritativa.** Esto adelanta el
  registro; no lo reemplaza.
