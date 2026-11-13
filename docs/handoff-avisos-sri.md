# Handoff — Avisos de vencimientos tributarios (SRI, persona natural)

**Estado:** investigación terminada, listo para implementar. Sin commit.
**Fecha de la investigación:** 2026-11-12.

---

## 1. Objetivo

Mostrar en Lila avisos de las declaraciones importantes para una persona natural
(IVA, Impuesto a la Renta, Anexo de Gastos Personales), calculados a partir de la
cédula que el usuario ya configura en la app.

## 2. Conclusión de la investigación

**No existe API —ni oficial del SRI ni gratuita de terceros— que mantenga estas
fechas. Y no hace falta: la fecha se deriva del noveno dígito con una regla fija.**

Lo que se verificó:

| Fuente | Resultado |
|---|---|
| Datos Abiertos del SRI (`sri.gob.ec/datos-abiertos`, `/datasets`) | Solo descargas CSV/ZIP de catastro RUC, recaudación, F104, vehículos, empresas fantasma. **Ningún dataset de plazos o calendario.** Sin API REST. |
| Calendario tributario oficial | Existe, pero es un **XLSX** (`/calendario-responsabilidades-tributarias`). Se descargó y parseó. |
| Servicios web del SRI | Solo SOAP de facturación electrónica. No sirven para esto. |
| Terceros (EcuadorAPI y similares) | De pago, no oficiales, y consultan RUC/contribuyente — no traen calendario. |

### Qué contiene el XLSX oficial (verificado al parsearlo)

- Nombre: `Calendario Tributario 2026.xlsx`, "Actualización: 23 de diciembre de 2025".
- 2 hojas (`calendario 2026` y una `base` oculta), 46 obligaciones.
- Columnas: `Periodicidad | Mes de vencimiento | Obligación tributaria | Tipo de contribuyente | Fecha de presentación | Detalle | Base legal`.
- **No trae las fechas exactas por dígito.** Dice literalmente:
  *"Demás contribuyentes según noveno dígito del RUC desde el día 10"*.
- Nota al pie, importante para el cálculo:
  > "Cuando una fecha de vencimiento coincida con días de descanso obligatorio o
  > feriados nacionales o locales se trasladará al siguiente día hábil, siempre que
  > se mantenga dentro del mismo mes, caso contrario la fecha de vencimiento deberá
  > adelantarse al último día hábil del mes de vencimiento."

### Por qué no se puede descargar automáticamente

1. La URL lleva UUID (`…/descargar/2c35dc3d-0ee6-497a-b5b1-1c1110a745ce/…`) que
   cambia al republicar el archivo cada diciembre.
2. Lila es un sitio estático en Vercel sin backend (`vercel.json` solo buildea Vite).
   `sri.gob.ec` no manda cabeceras CORS, así que el navegador no puede hacer fetch
   directo. Haría falta una función serverless solo para esto.

### Qué se actualiza y cada cuánto

| Capa | Ritmo de cambio |
|---|---|
| Regla dígito → día (Art. 158 RALRTI para IVA, Art. 72 para Renta) | Prácticamente congelada; solo por reforma reglamentaria. |
| Mes de cada obligación | Estable (Renta PN marzo, AGP febrero, IVA mensual todo el año). |
| Fechas concretas del año | Cambian cada año por fines de semana y feriados, pero **son calculables**. |
| Prórrogas extraordinarias | Impredecibles. En 2026 el SRI corrió plazos al menos 2 veces por fallas de su plataforma, vía resoluciones NAC-DGERCGC en PDF. |

## 3. Decisión de diseño

**Codificar la regla, no las fechas.** Así el mantenimiento anual es editar una
constante de ~15 líneas, no reescribir lógica.

El aviso debe ser honesto sobre su incertidumbre: texto tipo *"vence alrededor del
18 de noviembre"* + enlace a SRI en Línea + posibilidad de corregir la fecha a mano.
Un aviso que se equivoca por una prórroga es peor que no tener aviso; uno que dice
"alrededor de" sigue siendo útil aunque el SRI mueva el plazo.

## 4. Datos a codificar

### Tabla noveno dígito → día

```
dígito: 1  2  3  4  5  6  7  8  9  0
día:   10 12 14 16 18 20 22 24 26 28
```

Para persona natural el RUC es la cédula + `001`, así que el noveno dígito del RUC
es el noveno dígito de la cédula. `Identity.cedula` ya está validado como
`/^\d{10}$/` en `src/domain.ts:241`, así que el dígito es `cedula[8]`.

### Obligaciones relevantes para persona natural (del XLSX oficial)

| Obligación | Periodicidad | Mes de vencimiento | Aplica a |
|---|---|---|---|
| Declaración mensual de IVA | Mensual | mes siguiente al período | Régimen general |
| Declaración semestral de IVA | Semestral | enero y julio | Solo quien transfiere exclusivamente bienes 0% / retención total |
| Anexo de Gastos Personales (AGP) | Anual | febrero | Quien aplica rebaja por gastos personales |
| Declaración de Impuesto a la Renta | Anual | marzo | Régimen general |
| Anexo Declaración Patrimonial | Anual | mayo | Sobre cierto monto |

Casos especiales que el XLSX menciona y que conviene **no** modelar por ahora
(no aplican al usuario típico de Lila): contribuyentes especiales (día 11),
sector público (día 20), domiciliados en Galápagos (día 28).

### Regla de traslado

Feriados nacionales (Art. 65 del Código del Trabajo, reforma 2016):

- Sábado o domingo → viernes anterior o lunes posterior.
- Martes → lunes anterior.
- Miércoles o jueves → viernes de la misma semana.
- **No se trasladan:** 1 de enero, 1 de mayo, 2 y 3 de noviembre, 25 de diciembre.

Feriados calculables desde la Pascua: Carnaval (lunes y martes = Pascua − 48 y − 47),
Viernes Santo (Pascua − 2). Pascua se calcula con el algoritmo de Meeus/Gauss.

No calculable: puentes decretados por el Presidente fuera de la ley. Van en la
constante anual.

Referencia ya computada:

| Año | Pascua | Carnaval | Viernes Santo |
|---|---|---|---|
| 2026 | 5 abr | 16–17 feb | 3 abr |
| 2027 | 28 mar | 8–9 feb | 26 mar |

## 5. Dónde va en el código

- **`src/domain.ts`** — la lógica pura, junto a `yearOf` / `semesterOf` /
  `availableYears` (final del archivo). Sin acceso a DOM ni a red, igual que el
  resto del módulo.
- **`tests/domain.test.ts`** — tests con `node:test` + `assert/strict`, importando
  desde `../src/domain.ts` como el resto.
- **`src/main.ts`** — el render del aviso. El lugar natural es la barra lateral,
  cerca del bloque de carpetas mensuales (`#months`, alrededor de `src/main.ts:194`),
  o como banner junto a `#setup-banner`.
- Persistencia de correcciones manuales: `src/db.ts`, siguiendo el patrón de
  `overrides` (que ya guarda ajustes del usuario por mes y categoría).

## 6. API propuesta

```ts
export interface Vencimiento {
  obligacion: "iva-mensual" | "iva-semestral" | "renta" | "agp" | "patrimonial";
  etiqueta: string;        // "Declaración de IVA de octubre"
  fecha: string;           // "2026-11-18" (YYYY-MM-DD)
  periodo: string;         // "2026-10" — el mes/año que se declara
  estimada: boolean;       // false solo si hay override manual
}

export function digitoNoveno(cedula: string): number | null;
export function pascua(year: number): string;
export function feriados(year: number): string[];
export function siguienteDiaHabil(fecha: string, feriados: string[]): string;
export function vencimientos(
  cedula: string,
  year: number,
  opciones?: { ivaSemestral?: boolean; aplicaAGP?: boolean; patrimonial?: boolean },
): Vencimiento[];
```

Constantes a mantener una vez al año:

```ts
const DIA_POR_DIGITO = [28, 10, 12, 14, 16, 18, 20, 22, 24, 26]; // índice = dígito
const FERIADOS_EXTRA: Record<number, string[]> = { 2027: [] };   // puentes decretados
const PRORROGAS: Record<string, string> = {};                     // "2026-03-16" → "2026-03-25"
```

## 7. Casos de prueba

Verificados con cálculo de calendario:

- Cédula terminada en dígito 5 → día 18. Noviembre 2026: 18 es miércoles, no se mueve.
- Febrero 2026: el día 14 cae **sábado** y el 22 **domingo** → ambos se trasladan.
- Febrero 2026: el 16 y 17 son Carnaval → el dígito 4 (día 16) no puede quedarse ahí.
- Traslado que se sale del mes: un vencimiento el 28 de febrero de 2026 (sábado,
  dígito 0) **no** puede pasar a marzo; se adelanta al último día hábil de febrero.
  Este es el caso que más se suele implementar mal.
- `digitoNoveno` debe devolver `null` si la cédula no tiene 10 dígitos.

> ⚠️ Las tablas que publica la prensa para febrero 2026 **no cuadran entre sí** en
> justo estos bordes (una da dígito 4 → 17 de febrero, que es martes de Carnaval;
> otra deja dígito 3 → 14 de febrero, que es sábado). **No usar notas de prensa como
> oráculo de los tests.** Validar contra el XLSX oficial del año o la resolución.

## 8. Mantenimiento anual

En enero de cada año, una sola tarea:

1. Abrir `sri.gob.ec/calendario-responsabilidades-tributarias` y descargar el XLSX nuevo.
2. Confirmar que las obligaciones y meses de la tabla de la sección 4 no cambiaron.
3. Actualizar `FERIADOS_EXTRA` con los puentes decretados del año.

Y durante el año: si el SRI publica una prórroga, agregar una entrada a `PRORROGAS`.

## 9. Pendiente de verificar antes de implementar

- **La tabla 10 → 28 en fuente primaria.** Es consistente con todo lo encontrado
  (el XLSX dice "desde el día 10" y cita el Art. 158 del Reglamento), pero las
  búsquedas solo devolvieron resoluciones de prórroga y notas de prensa, nunca el
  texto del reglamento. Confirmarla una vez contra el Registro Oficial o SRI en
  Línea. Verificación de cinco minutos que deja el cálculo tranquilo por años.
- **Carnaval 2026 y el dígito 4** (ver la advertencia de la sección 7).
- Si Lila debe modelar o no el caso Galápagos / contribuyente especial. Por ahora se
  asume que no.

## 10. Fuentes

- [Calendario tributario oficial del SRI](https://www.sri.gob.ec/calendario-responsabilidades-tributarias)
- [Datos Abiertos del SRI](https://www.sri.gob.ec/datos-abiertos) · [catálogo de datasets](https://www.sri.gob.ec/datasets)
- [Resolución NAC-DGERCGC26-00000013 — ejemplo de prórroga](https://asobanca.org.ec/wp-content/uploads/2026/03/Res.-Nro.-NAC-DGERCGC26-00000013-Ampliacion-plazo-presentacion-declaracion-impuestos.pdf)
- [El Universo — prórroga de marzo 2026](https://www.eluniverso.com/noticias/economia/sri-nuevos-plazos-declaracion-impuestos-16-marzo-ecuador-2026-nota/) · [Expreso — prórroga de abril 2026](https://www.expreso.ec/tramites-y-servicios/sri-extiende-plazos-declarar-impuestos-vencidos-20-abril-fallas-sistema-279449.html)
- [Nager.Date](https://date.nager.at/) — API gratuita de feriados, cubre EC. Evaluada y **descartada**: no conoce la regla de traslado ecuatoriana y agrega una dependencia de red por ~10 fechas al año.
- [EcuadorAPI](https://www.ecuadorapi.com/) — tercero de pago, no oficial, sin calendario. Descartada.

Copia local del XLSX parseado durante la investigación (temporal, se borra con la sesión):
`/tmp/user/1000/claude-1000/-home-yadi-dev-vat-management/b752423e-a641-4632-abd1-04e3de5306d0/scratchpad/sri-xlsx/cal.xlsx`
