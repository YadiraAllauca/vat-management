import {
  availableYears,
  categories,
  yearOf,
  yearSummary,
  type Invoice,
  type PeriodTotals,
} from "./domain.ts";

export interface SummaryUI {
  content: HTMLElement;
  icon: (name: string) => string;
  money: (cents: number) => string;
  titleCase: (value: string) => string;
  onYear: (year: string) => void;
}
const labels = ["Aplicable IVA", "Actividades sin IVA", "Gastos personales"];
const monthOnly = (month: string) =>
  new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
export const currentYear = () => String(new Date().getFullYear());
export function summaryYears(records: Invoice[], selected: string) {
  return [...new Set([...availableYears(records), currentYear(), selected])]
    .sort()
    .reverse();
}
export function renderSummaryPage(
  ui: SummaryUI,
  records: Invoice[],
  year: string,
) {
  const { content, icon, money, titleCase } = ui;
  const summary = yearSummary(records, year);
  const years = summaryYears(records, year);
  const cells = (period: PeriodTotals) =>
    `${categories.map((c) => `<td class="amount">${money(period.totals[c])}</td>`).join("")}<td class="amount row-amount">${money(period.total)}</td><td class="amount count-cell">${period.count}</td>`;
  const semesterRow = (index: number) => {
    const semester = summary.semesters[index];
    return `<tr class="summary-subtotal"><th scope="row"><span class="summary-period">${index === 0 ? "Primer" : "Segundo"} semestre</span><small>${titleCase(monthOnly(semester.months[0]))}–${monthOnly(semester.months[1])} ${year}</small></th>${cells(semester)}</tr>`;
  };
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">TUS TOTALES, DE UN VISTAZO</div><h1>Resumen anual<span class="heading-dot">.</span></h1><p>Cada mes, cada semestre y el año completo.</p></div><div class="heading-actions"><label class="month-picker">Año <select id="summary-year" aria-label="Año del resumen">${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select></label></div></div><section class="stats" aria-label="Totales del año ${year}">${categories
    .map(
      (c, i) =>
        `<article class="stat stat-${i}"><div class="stat-top"><span>${labels[i]}</span><span class="stat-icon">${icon(["receipt", "chart", "heart"][i])}</span></div><strong>${money(summary.annual.totals[c])}</strong><div class="stat-bottom"><span>${summary.annual.count ? `${records.filter((r) => yearOf(r.month) === year && r.category === c).length} registros` : "Sin registros"}</span><span>Año ${year}</span></div></article>`,
    )
    .join(
      "",
    )}</section><section class="records-panel"><div class="panel-heading"><div><h2>Mes a mes <span class="pill">${year}</span></h2><p>Los meses sin registros se muestran en cero.</p></div><div class="month-total"><span>Total del año</span><strong>${money(summary.annual.total)}</strong></div></div>${
    summary.annual.count
      ? `<div class="table-scroll"><table class="summary-table"><thead><tr><th>MES</th>${categories.map((_, i) => `<th class="amount">${labels[i].toUpperCase()}</th>`).join("")}<th class="amount">TOTAL</th><th class="amount">REGISTROS</th></tr></thead><tbody>${summary.months
          .slice(0, 6)
          .map(
            (m) =>
              `<tr class="${m.count ? "" : "summary-empty"}"><th scope="row"><span class="summary-period">${titleCase(monthOnly(m.month))}</span></th>${cells(m)}</tr>`,
          )
          .join("")}${semesterRow(0)}${summary.months
          .slice(6)
          .map(
            (m) =>
              `<tr class="${m.count ? "" : "summary-empty"}"><th scope="row"><span class="summary-period">${titleCase(monthOnly(m.month))}</span></th>${cells(m)}</tr>`,
          )
          .join("")}${semesterRow(1)}</tbody><tfoot><tr class="summary-annual"><th scope="row"><span class="summary-period">Total del año</span><small>Enero–diciembre ${year}</small></th>${cells(summary.annual)}</tr></tfoot></table></div>`
      : `<div class="empty"><span class="empty-icon">${icon("chart")}</span><h3>Todavía no hay nada que sumar en ${year}</h3><p>Importa un informe o agrega registros en ese año<br>y aquí verás sus totales por mes, semestre y año.</p></div>`
  }</section><div class="tip">${icon("info")}<span><strong>Semestres del calendario.</strong> El primer semestre suma de enero a junio y el segundo de julio a diciembre, en las tres categorías.</span></div>`;
  content
    .querySelector<HTMLSelectElement>("#summary-year")!
    .addEventListener("change", (e) =>
      ui.onYear((e.target as HTMLSelectElement).value),
    );
}
