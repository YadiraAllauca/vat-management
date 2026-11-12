export const categories = [
  "APLICABLE IVA",
  "ACTIVIDADES SIN IVA",
  "GASTOS PERSONALES",
] as const;
export type Category = (typeof categories)[number];
export interface Invoice {
  id: string;
  number: string;
  month: string;
  category: Category;
  detail: string;
  cents: number;
  recipient?: string;
  createdAt: string;
  recurringId?: string;
}
export interface RecurringExpense {
  id: string;
  name: string;
  category: Category;
  detail: string;
  cents: number;
  createdAt: string;
}
export function validateRecurring(value: unknown): RecurringExpense {
  if (!value || typeof value !== "object")
    throw new Error("Plantilla recurrente inválida.");
  const r = value as RecurringExpense;
  if (
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 100 ||
    typeof r.id !== "string" ||
    !r.id ||
    r.id.length > 100
  )
    throw new Error("La plantilla necesita un nombre válido.");
  const checked = validateInvoice({
    ...r,
    number: "template",
    month: "2000-01",
  });
  return {
    id: r.id,
    name: r.name.trim(),
    category: checked.category,
    detail: checked.detail,
    cents: checked.cents,
    createdAt: checked.createdAt,
  };
}
export const recurringKey = (r: Invoice) =>
  r.recurringId ? `${r.recurringId}|${r.month}` : undefined;
export function pendingRecurring(
  templates: RecurringExpense[],
  records: Invoice[],
  month: string,
) {
  const used = new Set(
    records.filter((r) => r.month === month).map((r) => r.recurringId),
  );
  return templates.filter((t) => !used.has(t.id));
}
export const keyFor = (number: string) =>
  number.trim().replace(/[\s-]/g, "").toUpperCase();
// An invoice number is unique within its month, not across months.
export const monthNumberKey = (r: Invoice) => `${r.month}|${keyFor(r.number)}`;
export function amountToCents(value: string): number {
  const trimmed = value.trim();
  // Decimals use a period. A comma is read as a thousands separator when it
  // groups digits in threes ("1,234.56"); otherwise it is a decimal comma.
  const normalized = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(trimmed)
    ? trimmed.replace(/,/g, "")
    : trimmed.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error("Ingresa un valor positivo con hasta dos decimales.");
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new Error("El valor es demasiado grande.");
  return cents;
}
export function validateInvoice(value: unknown): Invoice {
  if (!value || typeof value !== "object")
    throw new Error("Registro inválido.");
  const r = value as Invoice;
  if (
    typeof r.id !== "string" ||
    !r.id ||
    typeof r.number !== "string" ||
    !keyFor(r.number) ||
    r.number.length > 100 ||
    typeof r.month !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) ||
    !categories.includes(r.category) ||
    typeof r.detail !== "string" ||
    r.detail.length > 2000 ||
    !Number.isSafeInteger(r.cents) ||
    r.cents < 0 ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    (r.recurringId !== undefined &&
      (typeof r.recurringId !== "string" ||
        !r.recurringId ||
        r.recurringId.length > 100)) ||
    (r.recipient !== undefined && typeof r.recipient !== "string")
  )
    throw new Error("Hay un registro con campos o valores inválidos.");
  return {
    id: r.id,
    number: r.number.trim(),
    month: r.month,
    category: r.category,
    detail: r.detail,
    cents: r.cents,
    createdAt: r.createdAt,
    ...(r.recurringId ? { recurringId: r.recurringId } : {}),
    ...(r.recipient ? { recipient: r.recipient } : {}),
  };
}
export function parseReport(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines
    .shift()!
    .split("\t")
    .map((s) => s.trim());
  const required = [
    "SERIE_COMPROBANTE",
    "FECHA_EMISION",
    "IDENTIFICACION_RECEPTOR",
    "VALOR_SIN_IMPUESTOS",
    "IMPORTE_TOTAL",
    "RAZON_SOCIAL_EMISOR",
    "TIPO_COMPROBANTE",
  ];
  if (!required.every((h) => header.includes(h)))
    throw new Error(
      "El archivo no tiene el formato de comprobantes recibidos del SRI.",
    );
  const records: Invoice[] = [];
  const errors: string[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = line.split("\t");
    const field = (name: string) => (cells[header.indexOf(name)] ?? "").trim();
    try {
      if (field("TIPO_COMPROBANTE").toLowerCase() !== "factura")
        throw new Error("Tipo de comprobante distinto de factura.");
      const recipient = field("IDENTIFICACION_RECEPTOR");
      if (!/^\d{10}(\d{3})?$/.test(recipient))
        throw new Error("El receptor debe tener 10 o 13 dígitos.");
      const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(field("FECHA_EMISION"));
      if (!date) throw new Error("Fecha de emisión inválida.");
      const [, day, month, year] = date;
      const parsed = new Date(`${year}-${month}-${day}T12:00:00Z`);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.getUTCDate() !== Number(day) ||
        parsed.getUTCMonth() + 1 !== Number(month)
      )
        throw new Error("Fecha de emisión inválida.");
      const personal = recipient.length === 10;
      records.push(
        validateInvoice({
          id: crypto.randomUUID(),
          number: field("SERIE_COMPROBANTE"),
          month: `${year}-${month}`,
          category: personal ? "GASTOS PERSONALES" : "APLICABLE IVA",
          detail: field("RAZON_SOCIAL_EMISOR"),
          cents: amountToCents(
            field(personal ? "IMPORTE_TOTAL" : "VALOR_SIN_IMPUESTOS"),
          ),
          recipient,
          createdAt: new Date().toISOString(),
        }),
      );
    } catch (e) {
      errors.push(`Línea ${index + 2}: ${(e as Error).message}`);
    }
  });
  return { records, errors };
}
export function uniqueRecords(incoming: Invoice[], existing: Invoice[]) {
  const seen = new Set(existing.map(monthNumberKey));
  const recurringSeen = new Set(existing.map(recurringKey).filter(Boolean));
  let duplicates = 0;
  const records = incoming.filter((r) => {
    const key = monthNumberKey(r);
    const recurring = recurringKey(r);
    if (seen.has(key) || (recurring && recurringSeen.has(recurring))) {
      duplicates++;
      return false;
    }
    seen.add(key);
    if (recurring) recurringSeen.add(recurring);
    return true;
  });
  return { records, duplicates };
}
export function parseBackup(text: string): Invoice[] {
  return parseBackupData(text).records;
}
export function parseBackupData(text: string): {
  records: Invoice[];
  recurring: RecurringExpense[];
  cedula: string | null;
  overrides: Overrides;
} {
  const data = JSON.parse(text);
  if (
    data?.app !== "lila" ||
    ![1, 2, 3, 4].includes(data.version) ||
    !Array.isArray(data.records) ||
    (data.version >= 2 && !Array.isArray(data.recurring))
  )
    throw new Error(
      "La copia de seguridad no es válida o su versión no es compatible.",
    );
  return {
    records: data.records.map(validateInvoice),
    recurring: data.version >= 2 ? data.recurring.map(validateRecurring) : [],
    cedula: /^\d{10}$/.test(data.cedula ?? "") ? data.cedula : null,
    overrides: data.version >= 4 ? validateOverrides(data.overrides) : {},
  };
}
export function totals(records: Invoice[]) {
  return Object.fromEntries(
    categories.map((c) => [
      c,
      records
        .filter((r) => r.category === c)
        .reduce((sum, r) => sum + r.cents, 0),
    ]),
  ) as Record<Category, number>;
}
export const yearOf = (month: string) => month.slice(0, 4);
export const semesterOf = (month: string) =>
  Number(month.slice(5, 7)) <= 6 ? 1 : 2;
export function availableYears(records: Invoice[]): string[] {
  return [...new Set(records.map((r) => yearOf(r.month)))].sort().reverse();
}
export interface PeriodTotals {
  totals: Record<Category, number>;
  total: number;
  count: number;
  // Categories whose total was written by hand instead of summed from records.
  edited: Category[];
}
// A manual total replaces what the records add up to, for one month and
// one category. Months without records can still carry a total this way.
export type Overrides = Record<string, number>;
export const overrideKey = (month: string, category: Category) =>
  `${month}|${category}`;
export function validateOverrides(value: unknown): Overrides {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Los totales editados no son válidos.");
  const clean: Overrides = {};
  for (const [key, cents] of Object.entries(value as Record<string, unknown>)) {
    const [month, category] = key.split("|");
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") ||
      !categories.includes(category as Category) ||
      !Number.isSafeInteger(cents) ||
      (cents as number) < 0
    )
      throw new Error(
        "Hay un total editado con mes, categoría o valor inválido.",
      );
    clean[key] = cents as number;
  }
  return clean;
}
export function monthTotals(
  records: Invoice[],
  month: string,
  overrides: Overrides = {},
): PeriodTotals {
  const ofMonth = records.filter((r) => r.month === month);
  const sums = totals(ofMonth);
  const edited: Category[] = [];
  const amounts = Object.fromEntries(
    categories.map((c) => {
      const manual = overrides[overrideKey(month, c)];
      if (manual === undefined) return [c, sums[c]];
      edited.push(c);
      return [c, manual];
    }),
  ) as Record<Category, number>;
  return {
    totals: amounts,
    total: categories.reduce((sum, c) => sum + amounts[c], 0),
    count: ofMonth.length,
    edited,
  };
}
function addUp(periods: PeriodTotals[]): PeriodTotals {
  return {
    totals: Object.fromEntries(
      categories.map((c) => [
        c,
        periods.reduce((sum, p) => sum + p.totals[c], 0),
      ]),
    ) as Record<Category, number>,
    total: periods.reduce((sum, p) => sum + p.total, 0),
    count: periods.reduce((sum, p) => sum + p.count, 0),
    edited: categories.filter((c) => periods.some((p) => p.edited.includes(c))),
  };
}
export function yearSummary(
  records: Invoice[],
  year: string,
  overrides: Overrides = {},
) {
  const ofYear = records.filter((r) => yearOf(r.month) === year);
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, ...monthTotals(ofYear, month, overrides) };
  });
  const semesters = ([1, 2] as const).map((semester) => ({
    semester,
    months: [
      `${year}-${semester === 1 ? "01" : "07"}`,
      `${year}-${semester === 1 ? "06" : "12"}`,
    ] as [string, string],
    ...addUp(months.filter((m) => semesterOf(m.month) === semester)),
  }));
  return { year, months, semesters, annual: addUp(months) };
}
