import "./style.css";
import {
  categories,
  amountToCents,
  keyFor,
  parseReport,
  parseBackupData,
  pendingRecurring,
  type RecurringExpense,
  totals,
  uniqueRecords,
  yearOf,
  type Invoice,
} from "./domain.ts";
import {
  allInvoices,
  saveInvoices,
  deleteInvoice,
  deleteMonth,
  allRecurring,
} from "./db.ts";
import {
  renderRecurringPage,
  applyRecurring,
  type RecurringUI,
} from "./recurring.ts";
import { renderSummaryPage, currentYear } from "./summary.ts";

const paths: Record<string, string> = {
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  dots: '<path d="M12 5h.01M12 12h.01M12 19h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 7h6M9 11h6M9 15h3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.8 7.2 7.1 5.2a2 2 0 0 0 2.2 0l7.1-5.2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  heart:
    '<path d="M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-4 4 1 10 8 15 7-5 12-11 8-15z"/>',
  chart: '<path d="M4 3v18h17M8 16v-5M13 16V6M18 16v-8"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.receipt}</svg>`;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (cents: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const nowMonth = () =>
  `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const monthName = (month: string) =>
  new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
const shiftMonth = (value: string, delta: number) => {
  const [y, m] = value.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthAlone = (month: string) =>
  new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
let records: Invoice[] = [];
let templates: RecurringExpense[] = [];
let month = nowMonth();
// Year folders stay as the user leaves them; opening a month opens its year.
const openYears = new Set<string>([yearOf(nowMonth())]);
function selectMonth(value: string) {
  month = value;
  openYears.add(yearOf(value));
}
let category = "all";
let query = "";
let page = 1;
let view: "records" | "backup" | "recurring" | "summary" | "email" =
  "records";
let year = currentYear();
let pending: Invoice[] = [];
let busy = false;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="/" aria-label="Lila, inicio"><span class="brand-mark">l<span>•</span></span><span>lila<span class="brand-sub">TUS CUENTAS, EN CALMA</span></span></a><div class="months-heading"><span>CARPETAS MENSUALES</span><button class="icon-button" id="add-month" aria-label="Abrir un mes" title="Abrir un mes">${icon("plus")}</button></div><nav id="months" aria-label="Carpetas mensuales"></nav><button class="nav-item" id="summary-nav">${icon("chart")} Resumen anual</button><button class="nav-item backup-nav" id="backup-nav">${icon("shield")} Copias de seguridad</button><button class="nav-item" id="recurring-nav">${icon("receipt")} Gastos recurrentes</button><button class="nav-item" id="email-nav">${icon("mail")} Facturas por correo</button><div class="local-note">${icon("shield")}<div>Solo en tu dispositivo<small>Tus datos se guardan en este navegador.</small></div></div><div class="sidebar-footer"><span class="avatar">M</span><div>Mi contabilidad<small>Un poco más de tranquilidad</small></div></div></aside><main><header class="topbar"><div class="breadcrumb">Mi espacio <span>/</span> <strong id="crumb">Mis facturas</strong></div><span class="device-status"><i></i> Guardado en este dispositivo</span></header><div id="content"></div><footer class="main-footer"><span>Hecho para que tus cuentas sean más simples.</span><span>Lila <span class="footer-dot">✦</span> Tu espacio de claridad</span></footer></main></div><div id="dropzone" class="dropzone" aria-hidden="true"><div class="dropzone-card">${icon("upload")}<strong>Suelta tu archivo aquí</strong><span>.txt informe del SRI · .json copia de seguridad</span></div></div><div id="month-menu" role="menu" hidden></div><dialog id="modal"></dialog><div id="toast" role="status" aria-live="polite"></div><input type="file" id="report-file" accept=".txt,text/plain" hidden><input type="file" id="backup-file" accept=".json,application/json" hidden>`;
const content = document.querySelector<HTMLDivElement>("#content")!;
const modal = document.querySelector<HTMLDialogElement>("#modal")!;
function toast(message: string, error = false) {
  const node = document.querySelector<HTMLDivElement>("#toast")!;
  node.textContent = message;
  node.className = `visible ${error ? "error" : ""}`;
  setTimeout(() => (node.className = ""), 6000);
}
function showModal(html: string) {
  modal.innerHTML = `<button class="modal-close icon-button" aria-label="Cerrar">${icon("x")}</button>${html}`;
  modal.querySelector("button")!.addEventListener("click", () => {
    if (!busy) modal.close();
  });
  const heading = modal.querySelector("h2");
  if (heading) {
    heading.id = "dialog-title";
    modal.setAttribute("aria-labelledby", "dialog-title");
  }
  modal.showModal();
  modal.querySelector<HTMLInputElement>("input")?.focus();
}
function recurringUI(): RecurringUI {
  return {
    content,
    modal,
    showModal,
    icon,
    escape,
    money,
    toast,
    isBusy: () => busy,
    setBusy: (value) => {
      busy = value;
    },
    refresh: async () => {
      [records, templates] = await Promise.all([allInvoices(), allRecurring()]);
      render();
    },
  };
}
function summaryUI() {
  return {
    content,
    icon,
    money,
    titleCase,
    onYear: (value: string) => {
      year = value;
      render();
    },
  };
}
function render() {
  closeMonthMenu();
  const months = [...new Set(records.map((r) => r.month))].sort().reverse();
  const years = [...new Set(months.map(yearOf))];
  document.querySelector("#months")!.innerHTML = years
    .map((y) => {
      const open = openYears.has(y);
      return `<div class="year-group"><button class="year-item ${y === yearOf(month) && view === "records" ? "current" : ""}" data-year="${y}" aria-expanded="${open}">${icon("chevron")}<span>${y}</span><span class="count">${records.filter((r) => yearOf(r.month) === y).length}</span></button><div class="year-months" ${open ? "" : "hidden"}>${months
        .filter((m) => yearOf(m) === y)
        .map(
          (m) =>
            `<div class="month-row ${m === month && view === "records" ? "selected" : ""}"><button class="month-item" data-month="${m}">${icon("folder")}<span>${titleCase(monthAlone(m))}</span></button><span class="count">${records.filter((r) => r.month === m).length}</span><button class="icon-button month-dots" data-menu="${m}" aria-haspopup="true" aria-expanded="false" aria-label="Opciones de ${escape(titleCase(monthName(m)))}">${icon("dots")}</button></div>`,
        )
        .join("")}</div></div>`;
    })
    .join("");
  document
    .querySelector("#backup-nav")!
    .classList.toggle("active", view === "backup");
  document
    .querySelector("#summary-nav")!
    .classList.toggle("active", view === "summary");
  document
    .querySelector("#recurring-nav")!
    .classList.toggle("active", view === "recurring");
  document
    .querySelector("#email-nav")!
    .classList.toggle("active", view === "email");
  document.querySelector("#crumb")!.textContent = {
    records: "Mis facturas",
    backup: "Copias de seguridad",
    recurring: "Gastos recurrentes",
    summary: "Resumen anual",
    email: "Facturas por correo",
  }[view];
  if (view === "summary") return renderSummaryPage(summaryUI(), records, year);
  if (view === "recurring")
    return renderRecurringPage(recurringUI(), templates);
  if (view === "backup") return renderBackup();
  if (view === "email") return renderEmail();
  const current = records.filter((r) => r.month === month);
  const sums = totals(current);
  const monthTotal = current.reduce((sum, r) => sum + r.cents, 0);
  const availableRecurring = pendingRecurring(templates, records, month).length;
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">UN POCO DE ORDEN, MUCHA TRANQUILIDAD</div><h1>Mis facturas<span class="heading-dot">.</span></h1><p>Todo en su mes. Cada gasto en su lugar.</p></div><div class="heading-actions"><button class="button secondary" id="import">${icon("upload")} Importar informe</button><button class="button primary" id="new">${icon("plus")} Nuevo registro</button></div></div><section class="month-banner"><div class="month-title"><span class="calendar-icon">${icon("folder")}</span><div><span class="overline">CARPETA ABIERTA</span><h2>${titleCase(monthName(month))}</h2><p class="month-summary">${current.length ? `${current.length} ${current.length === 1 ? "factura guardada" : "facturas guardadas"} · ${money(monthTotal)} en total` : "Todavía sin facturas. Agrega un registro o importa un informe."}</p></div></div><div class="month-actions">${templates.length ? `<button class="button secondary" id="apply-recurring" ${availableRecurring ? "" : "disabled"}>${icon("plus")} Añadir recurrentes (${availableRecurring})</button>` : ""}<button class="button secondary" id="change-month">${icon("calendar")} Cambiar de mes</button></div></section><section class="stats" aria-label="Totales del mes">${categories.map((c, i) => `<article class="stat stat-${i}"><div class="stat-top"><span>${["Aplicable IVA", "Actividades sin IVA", "Gastos personales"][i]}</span><span class="stat-icon">${icon(["receipt", "chart", "heart"][i])}</span></div><strong>${money(sums[c])}</strong><div class="stat-bottom"><span>${current.filter((r) => r.category === c).length} registros</span><span>${["Base sin impuestos", "Total registrado", "Importe total"][i]}</span></div></article>`).join("")}</section><section class="records-panel" data-drop="report"><div class="panel-heading"><div><h2>Registros del mes <span class="pill">${current.length}</span></h2><p>Un lugar para todas tus facturas.</p></div><div class="month-total"><span>Total registrado</span><strong>${money(monthTotal)}</strong></div></div><div class="table-toolbar"><div class="tabs" role="group" aria-label="Filtrar por categoría">${["all", ...categories].map((c, i) => `<button class="tab ${category === c ? "chosen" : ""}" data-category="${c}">${["Todos", "Aplicable IVA", "Sin IVA", "Personales"][i]}</button>`).join("")}</div><label class="search">${icon("search")}<input id="search" placeholder="Buscar factura o detalle…" aria-label="Buscar factura o detalle" value="${escape(query)}"></label></div><div id="table-content"></div></section><div class="tip">${icon("info")}<span><strong>Tu información, contigo.</strong> Crea una copia de seguridad para conservar tus registros o llevarlos a otro dispositivo.</span><button id="quick-backup">Crear copia ${icon("arrow")}</button></div>`;
  renderTable();
  document.querySelector("#apply-recurring")?.addEventListener("click", () => {
    void applyRecurring(recurringUI(), month, monthName(month));
  });
  document.querySelector("#new")!.addEventListener("click", () => editRecord());
  document
    .querySelector("#import")!
    .addEventListener("click", () =>
      document.querySelector<HTMLInputElement>("#report-file")!.click(),
    );
  document
    .querySelector("#change-month")!
    .addEventListener("click", openMonthDialog);
  document.querySelector("#search")!.addEventListener("input", (e) => {
    query = (e.target as HTMLInputElement).value;
    page = 1;
    renderTable();
  });
  document.querySelectorAll<HTMLElement>("[data-category]").forEach((b) =>
    b.addEventListener("click", () => {
      category = b.dataset.category!;
      page = 1;
      render();
    }),
  );
  document
    .querySelector("#quick-backup")!
    .addEventListener("click", exportBackup);
}
function renderTable() {
  const filtered = records
    .filter(
      (r) =>
        r.month === month &&
        (category === "all" || r.category === category) &&
        `${r.number} ${r.detail}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  page = Math.min(page, pages);
  document.querySelector("#table-content")!.innerHTML = filtered.length
    ? `<div class="table-scroll records-scroll"><table class="records-table"><thead><tr><th>N.º DE FACTURA</th><th>DETALLE</th><th>CATEGORÍA</th><th class="amount">TOTAL</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${filtered
        .slice((page - 1) * 8, page * 8)
        .map(
          (r) =>
            `<tr><td><div class="invoice-number"><span class="row-icon">${icon("receipt")}</span><span>${escape(r.number)}<small>${titleCase(monthName(r.month))}</small></span></div></td><td class="detail-cell">${escape(r.detail || "Sin detalle")}</td><td><span class="badge badge-${categories.indexOf(r.category)}"><i></i>${escape(r.category)}</span></td><td class="amount row-amount">${money(r.cents)}</td><td><div class="row-actions"><button class="icon-button" data-edit="${escape(r.id)}" aria-label="Editar factura ${escape(r.number)}">${icon("edit")}</button><button class="icon-button delete" data-delete="${escape(r.id)}" aria-label="Eliminar factura ${escape(r.number)}">${icon("trash")}</button></div></td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><div class="pagination"><span>Mostrando ${(page - 1) * 8 + 1}–${Math.min(page * 8, filtered.length)} de ${filtered.length} registros</span><div><button class="button small secondary" id="prev" ${page === 1 ? "disabled" : ""}>Anterior</button><span>${page} / ${pages}</span><button class="button small secondary" id="next" ${page === pages ? "disabled" : ""}>Siguiente</button></div></div>`
    : `<div class="empty"><span class="empty-icon">${icon(query || category !== "all" ? "search" : "receipt")}</span><h3>${query || category !== "all" ? "Sin resultados por aquí" : "Un mes listo para organizar"}</h3><p>${query || category !== "all" ? "Prueba otra búsqueda o cambia la categoría." : "Agrega tu primera factura o importa un informe del SRI.<br>Nosotros nos encargamos de sumar."}</p>${!query && category === "all" ? '<button class="button secondary" id="empty-add">Agregar mi primera factura</button>' : ""}</div>`;
  document.querySelector("#prev")?.addEventListener("click", () => {
    page--;
    renderTable();
  });
  document.querySelector("#next")?.addEventListener("click", () => {
    page++;
    renderTable();
  });
  document
    .querySelector("#empty-add")
    ?.addEventListener("click", () => editRecord());
  document
    .querySelectorAll<HTMLElement>("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          editRecord(records.find((r) => r.id === b.dataset.edit))),
    );
  document
    .querySelectorAll<HTMLElement>("[data-delete]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          confirmDelete(records.find((r) => r.id === b.dataset.delete)!)),
    );
}
function editRecord(record?: Invoice) {
  showModal(
    `<span class="dialog-icon">${icon("receipt")}</span><h2>${record ? "Editar registro" : "Un nuevo registro"}</h2><p class="dialog-description">Los pequeños detalles hacen las cuentas claras.</p><form id="record-form"><label>Número de factura<input name="number" required maxlength="100" placeholder="001-001-000000001" value="${escape(record?.number ?? "")}"></label><div class="form-row"><label>Mes de emisión<input type="month" name="month" required value="${record?.month ?? month}"></label><label>Total (USD)<input name="amount" type="text" inputmode="decimal" required placeholder="0.00" value="${record ? (record.cents / 100).toFixed(2) : ""}"></label></div><label>Categoría<select name="category">${categories.map((c) => `<option ${record?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><div class="field-hint">En Aplicable IVA, ingresa el valor sin impuestos.</div><label>Detalle<textarea name="detail" rows="3" maxlength="2000" placeholder="Proveedor o descripción del gasto">${escape(record?.detail ?? "")}</textarea></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" id="cancel">Cancelar</button><button class="button primary" type="submit">${icon("check")} Guardar registro</button></div></form>`,
  );
  document
    .querySelector("#cancel")!
    .addEventListener("click", () => modal.close());
  document.querySelector<HTMLFormElement>("#record-form")!.onsubmit = async (
    e,
  ) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget as HTMLFormElement);
    try {
      const number = String(form.get("number")).trim();
      if (!keyFor(number))
        throw new Error("Ingresa un número de factura válido.");
      const emission = String(form.get("month"));
      if (
        records.some(
          (r) =>
            r.id !== record?.id &&
            r.month === emission &&
            keyFor(r.number) === keyFor(number),
        )
      )
        throw new Error(
          "Este número de factura ya está registrado en ese mes.",
        );
      const entry: Invoice = {
        id: record?.id ?? crypto.randomUUID(),
        number,
        month: emission,
        category: String(form.get("category")) as Invoice["category"],
        detail: String(form.get("detail")).trim(),
        cents: amountToCents(String(form.get("amount"))),
        createdAt: record?.createdAt ?? new Date().toISOString(),
        ...(record?.recurringId ? { recurringId: record.recurringId } : {}),
        ...(record?.recipient ? { recipient: record.recipient } : {}),
      };
      busy = true;
      await saveInvoices([entry]);
      records = await allInvoices();
      selectMonth(entry.month);
      modal.close();
      render();
      toast("Registro guardado. Tus totales están actualizados.");
    } catch (err) {
      modal.querySelector(".form-error")!.textContent = readableError(err);
    } finally {
      busy = false;
    }
  };
}
function openMonthDialog() {
  let shown = Number(yearOf(month));
  const openFolder = (value: string) => {
    selectMonth(value);
    view = "records";
    page = 1;
    modal.close();
    render();
  };
  showModal(
    `<span class="dialog-icon">${icon("calendar")}</span><h2>Abrir un mes</h2><p class="dialog-description">Elige el mes que quieres revisar. Si todavía no tiene facturas, se abre vacío y listo para llenarlo.</p><div class="picker-head"><button type="button" class="icon-button flip" id="prev-year" aria-label="Año anterior">${icon("chevron")}</button><strong id="picker-year" aria-live="polite">${shown}</strong><button type="button" class="icon-button" id="next-year" aria-label="Año siguiente">${icon("chevron")}</button></div><div class="month-grid" id="month-grid"></div><button type="button" class="button secondary" id="this-month">${icon("calendar")} Ir al mes actual</button>`,
  );
  const grid = modal.querySelector<HTMLDivElement>("#month-grid")!;
  const draw = () => {
    modal.querySelector("#picker-year")!.textContent = String(shown);
    grid.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const value = `${shown}-${String(i + 1).padStart(2, "0")}`;
      const count = records.filter((r) => r.month === value).length;
      return `<button type="button" class="month-option ${value === month ? "chosen" : ""}" data-jump="${value}" ${value === month ? 'aria-current="true"' : ""}>${titleCase(monthAlone(value))}<small>${count ? `${count} ${count === 1 ? "factura" : "facturas"}` : "Vacío"}</small></button>`;
    }).join("");
  };
  const step = (delta: number) => {
    shown = Math.min(9999, Math.max(1970, shown + delta));
    draw();
  };
  grid.addEventListener("click", (e) => {
    const option = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
    if (option) openFolder(option.dataset.jump!);
  });
  modal.querySelector("#prev-year")!.addEventListener("click", () => step(-1));
  modal.querySelector("#next-year")!.addEventListener("click", () => step(1));
  modal
    .querySelector("#this-month")!
    .addEventListener("click", () => openFolder(nowMonth()));
  draw();
}
function readableError(err: unknown) {
  return err instanceof DOMException && err.name === "ConstraintError"
    ? "La factura o el recurrente ya existe en ese mes. Actualiza la página para ver los últimos datos."
    : err instanceof Error
      ? err.message
      : "No se pudo completar la operación.";
}
function confirmDelete(r: Invoice) {
  showModal(
    `<span class="dialog-icon">${icon("trash")}</span><h2>¿Eliminar esta factura?</h2><p class="dialog-description">Se eliminará ${escape(r.number)} por ${money(r.cents)} y se actualizarán los totales del mes.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" id="cancel">Conservar</button><button class="button danger" id="confirm-delete">Eliminar factura</button></div>`,
  );
  document
    .querySelector("#cancel")!
    .addEventListener("click", () => modal.close());
  document
    .querySelector("#confirm-delete")!
    .addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      try {
        await deleteInvoice(r.id);
        records = await allInvoices();
        modal.close();
        render();
        toast("Factura eliminada.");
      } catch (e) {
        modal.querySelector(".form-error")!.textContent = readableError(e);
      } finally {
        busy = false;
      }
    });
}
function confirmDeleteMonth(targetMonth: string) {
  const entries = records.filter((r) => r.month === targetMonth);
  showModal(
    `<span class="dialog-icon">${icon("trash")}</span><h2>¿Eliminar ${escape(monthName(targetMonth))}?</h2><p class="dialog-description">Se eliminarán todos los registros de este mes, de las tres categorías, aunque tengas una búsqueda o un filtro activo.</p><div class="month-delete-summary"><strong>${entries.length} registros</strong><span>Total registrado: ${money(entries.reduce((sum, r) => sum + r.cents, 0))}</span></div><p class="field-hint">Esta acción no se puede deshacer. Podrás recuperar los registros si tienes una copia de seguridad anterior.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" id="cancel-month-delete">Conservar mes</button><button class="button danger" id="confirm-month-delete">Eliminar mes y registros</button></div>`,
  );
  const cancel = modal.querySelector<HTMLButtonElement>(
    "#cancel-month-delete",
  )!;
  const confirm = modal.querySelector<HTMLButtonElement>(
    "#confirm-month-delete",
  )!;
  cancel.focus();
  cancel.addEventListener("click", () => {
    if (!busy) modal.close();
  });
  confirm.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      await deleteMonth(targetMonth);
      records = await allInvoices();
      if (targetMonth === month) {
        selectMonth(
          records
            .map((r) => r.month)
            .sort()
            .at(-1) ?? nowMonth(),
        );
        query = "";
        category = "all";
        page = 1;
      }
      modal.close();
      render();
      toast(
        `${titleCase(monthName(targetMonth))} y sus registros se eliminaron.`,
      );
    } catch (e) {
      modal.querySelector(".form-error")!.textContent = readableError(e);
    } finally {
      busy = false;
      confirm.disabled = false;
      cancel.disabled = false;
    }
  });
}
async function readFile(file: File) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("El archivo supera el límite de 20 MB.");
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(buffer);
  return text.includes("\uFFFD")
    ? new TextDecoder("windows-1252").decode(buffer)
    : text;
}
async function previewImport(file: File, backup: boolean) {
  try {
    const text = await readFile(file);
    const parsed = backup
      ? { ...parseBackupData(text), errors: [] as string[] }
      : { ...parseReport(text), recurring: [] as RecurringExpense[] };
    [records, templates] = await Promise.all([allInvoices(), allRecurring()]);
    const existingTemplates = new Set(templates.map((t) => t.id));
    const newTemplates = parsed.recurring.filter((t) => {
      if (existingTemplates.has(t.id)) return false;
      existingTemplates.add(t.id);
      return true;
    });
    const unique = uniqueRecords(parsed.records, records);
    pending = unique.records;
    const sums = totals(pending);
    showModal(
      `<span class="dialog-icon">${icon(backup ? "shield" : "upload")}</span><h2>${backup ? "Restaurar copia de seguridad" : "Tu informe, listo para revisar"}</h2><p class="dialog-description filename">${escape(file.name)}</p><div class="import-summary"><div><strong>${pending.length}</strong><span>Nuevos registros</span></div><div><strong>${unique.duplicates}</strong><span>Duplicados omitidos</span></div><div><strong>${parsed.errors.length}</strong><span>Filas no válidas</span></div></div><div class="import-totals">${categories.map((c, i) => `<div><span class="badge badge-${i}">${c}</span><strong>${money(sums[c])}</strong></div>`).join("")}</div><p class="field-hint">${backup ? "Los registros nuevos se añadirán a tus datos actuales. Las facturas existentes se conservarán." : "10 dígitos: gastos personales con importe total. 13 dígitos: aplicable IVA con valor sin impuestos."}</p>${
        pending.length
          ? `<p class="field-hint">Meses: ${[
              ...new Set(pending.map((r) => r.month)),
            ]
              .sort()
              .map((m) => escape(monthName(m)))
              .join(", ")}.</p>`
          : ""
      }${backup ? `<p class="field-hint">${newTemplates.length} plantillas recurrentes nuevas. La configuración existente se conservará.</p>` : ""}${parsed.errors.length ? `<details><summary>Revisar filas omitidas</summary><ul class="import-errors">${parsed.errors.map((e) => `<li>${escape(e)}</li>`).join("")}</ul></details>` : ""}<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" id="cancel">Cancelar</button><button class="button primary" id="confirm-import" ${pending.length || newTemplates.length ? "" : "disabled"}>${icon("check")} ${backup ? "Restaurar selección" : `Importar ${pending.length} registros`}</button></div>`,
    );
    document
      .querySelector("#cancel")!
      .addEventListener("click", () => modal.close());
    document
      .querySelector("#confirm-import")!
      .addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        const button =
          document.querySelector<HTMLButtonElement>("#confirm-import")!;
        button.disabled = true;
        try {
          const fresh = await allInvoices();
          const toSave = uniqueRecords(pending, fresh).records.map((r) => ({
            ...r,
            id: crypto.randomUUID(),
          }));
          await saveInvoices(toSave, newTemplates);
          [records, templates] = await Promise.all([
            allInvoices(),
            allRecurring(),
          ]);
          if (toSave.length)
            selectMonth(
              toSave
                .map((r) => r.month)
                .sort()
                .at(-1)!,
            );
          view =
            backup && !toSave.length && newTemplates.length
              ? "recurring"
              : "records";
          query = "";
          category = "all";
          page = 1;
          modal.close();
          render();
          toast(
            `${toSave.length} registros${backup ? ` y ${newTemplates.length} plantillas` : ""} guardados correctamente.`,
          );
        } catch (e) {
          modal.querySelector(".form-error")!.textContent = readableError(e);
          button.disabled = false;
        } finally {
          busy = false;
        }
      });
  } catch (e) {
    toast(readableError(e), true);
  }
}
async function exportBackup() {
  try {
    const [fresh, recurring] = await Promise.all([
      allInvoices(),
      allRecurring(),
    ]);
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "lila",
            version: 2,
            exportedAt: new Date().toISOString(),
            records: fresh,
            recurring,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lila-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(
      `Copia descargada con ${fresh.length} registros y ${recurring.length} plantillas.`,
    );
  } catch (e) {
    toast(readableError(e), true);
  }
}
const GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox";
const extensionVersion = () =>
  document.documentElement.dataset.lilaExtension ?? null;
let identity: { cedula: string; ruc: string } | null = null;

function renderEmail() {
  const version = extensionVersion();
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">TUS FACTURAS, SIN TECLEARLAS</div><h1>Facturas por correo<span class="heading-dot">.</span></h1><p>La extensión lee tus facturas en Gmail y te las trae aquí.</p></div></div><div class="backup-grid"><article class="backup-card"><span class="dialog-icon">${icon("mail")}</span><h2>Extensión de Gmail</h2><div class="extension-state ${version ? "" : "off"}"><i></i>${version ? `Conectada en este navegador · versión ${escape(version)}` : "Sin conectar en este navegador"}</div>${
    version
      ? `<p>Abre Gmail y la extensión marca los correos que parecen facturas. Cuando las envíes, vuelves aquí a confirmar la importación.</p><div class="backup-meta">Lee solo el texto del correo · Nunca guarda sin tu confirmación</div><form class="id-form" id="identity"><div class="id-fields"><label><span>Tu cédula</span><input id="cedula" inputmode="numeric" maxlength="10" placeholder="0912345678" value="${escape(identity?.cedula ?? "")}"></label><label><span>Tu RUC</span><input id="ruc" inputmode="numeric" maxlength="13" placeholder="0912345678001" value="${escape(identity?.ruc ?? "")}"></label></div><p class="field-hint" id="identity-note" aria-live="polite">Las facturas a tu cédula entran como gastos personales con el importe total; las de tu RUC, como aplicable IVA con el valor sin impuestos. Cuando un correo no dice a nombre de quién está, se usa tu cédula.</p><div class="card-actions"><button class="button primary" type="submit">${icon("check")} Guardar mis datos</button><a class="button secondary" id="open-gmail" href="${GMAIL_URL}" target="_blank" rel="noopener">${icon("mail")} Usar en Gmail</a></div><button class="link-button" type="button" id="extension-options">Más ajustes de la extensión</button></form>`
      : `<p>Cárgala una vez en este navegador y Lila la reconoce sola.</p><ol class="steps"><li>Abre <code>chrome://extensions</code> y activa el modo de desarrollador.</li><li>Pulsa «Cargar descomprimida» y elige la carpeta <code>extension/</code> del proyecto.</li><li>Vuelve a esta página.</li></ol><div class="card-actions"><button class="button primary" id="extension-retry">${icon("arrow")} Buscar la extensión</button></div>`
  }</article><article class="backup-card"><span class="dialog-icon">${icon("receipt")}</span><h2>Cómo llegan tus facturas</h2><ol class="steps"><li>Mira tu bandeja y marca los correos que parecen facturas.</li><li>Abre cada uno por detrás y lee la clave de acceso, el receptor y los montos.</li><li>Te muestra lo que quedó completo y, aparte, lo que le faltaron datos.</li><li>Al enviarlas, Lila abre la vista previa de siempre.</li></ol><div class="backup-meta">La serie real evita duplicados cuando importes el informe del SRI</div></article></div><div class="storage-explainer">${icon("shield")}<div><h3>Nada sale de este navegador</h3><p>La extensión lee lo que Gmail ya te mostró, con tu propia sesión. No hay servidor, no hay permisos de Google y los datos de tus facturas no viajan a ninguna parte: pasan de la pestaña de Gmail a la de Lila dentro de tu equipo. Las facturas a las que les falte la serie, la fecha, tu identificación o el monto no se envían: la extensión te dice qué falta en vez de inventarlo.</p></div></div>`;
  document
    .querySelector("#extension-options")
    ?.addEventListener("click", () =>
      document.dispatchEvent(new Event("lila:extension-options")),
    );
  document.querySelector("#identity")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (id: string) =>
      document.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
    const cedula = value("cedula");
    const ruc = value("ruc");
    const note = document.querySelector("#identity-note")!;
    if (cedula && !/^\d{10}$/.test(cedula))
      return void (note.textContent = "La cédula tiene diez dígitos.");
    if (ruc && !/^\d{13}$/.test(ruc))
      return void (note.textContent = "El RUC tiene trece dígitos.");
    document.dispatchEvent(
      new CustomEvent("lila:extension-identity", { detail: { cedula, ruc } }),
    );
    toast("Tus datos quedaron guardados en la extensión.");
  });
  document.dispatchEvent(new Event("lila:extension-ping"));
  document.querySelector("#extension-retry")?.addEventListener("click", () => {
    document.dispatchEvent(new Event("lila:extension-ping"));
    setTimeout(() => {
      if (view !== "email") return;
      if (extensionVersion()) render();
      else toast("Todavía no encuentro la extensión en este navegador.", true);
    }, 200);
  });
}
function renderBackup() {
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">TU INFORMACIÓN, SIEMPRE CONTIGO</div><h1>Copias de seguridad<span class="heading-dot">.</span></h1><p>Guarda una copia hoy. Retoma con tranquilidad mañana.</p></div></div><div class="backup-grid"><article class="backup-card"><span class="dialog-icon">${icon("download")}</span><h2>Descargar mis datos</h2><p>Guarda todas tus facturas en un archivo JSON. Incluye todos los meses, categorías y la configuración de gastos recurrentes.</p><div class="backup-meta">${records.length} registros · ${new Set(records.map((r) => r.month)).size} meses · ${templates.length} recurrentes</div><button class="button primary" id="download-backup">${icon("download")} Descargar copia</button></article><article class="backup-card" data-drop="backup"><span class="dialog-icon">${icon("upload")}</span><h2>Recuperar una copia</h2><p>Selecciona una copia de Lila para añadir sus registros a este navegador. Las facturas repetidas se omiten.</p><div class="backup-meta">Archivo .json · Vista previa antes de guardar</div><button class="button secondary" id="restore-backup">${icon("upload")} Seleccionar copia</button></article></div><div class="storage-explainer">${icon("shield")}<div><h3>Tus datos se guardan en este navegador</h3><p>Lila usa IndexedDB en tu dispositivo. Si cambias de navegador, borras los datos del sitio o usas una ventana privada, necesitarás una copia para recuperar tu información. Descarga una copia con regularidad y guárdala en un lugar seguro.</p></div></div>`;
  document
    .querySelector("#download-backup")!
    .addEventListener("click", exportBackup);
  document
    .querySelector("#restore-backup")!
    .addEventListener("click", () =>
      document.querySelector<HTMLInputElement>("#backup-file")!.click(),
    );
}
const monthMenu = document.querySelector<HTMLDivElement>("#month-menu")!;
function closeMonthMenu() {
  if (monthMenu.hidden) return;
  document
    .querySelector("[data-menu][aria-expanded='true']")
    ?.setAttribute("aria-expanded", "false");
  monthMenu.hidden = true;
  monthMenu.innerHTML = "";
}
function openMonthMenu(opener: HTMLElement) {
  const target = opener.dataset.menu!;
  closeMonthMenu();
  opener.setAttribute("aria-expanded", "true");
  monthMenu.innerHTML = `<p class="menu-title">${escape(titleCase(monthName(target)))}</p><button class="menu-item" data-delete-month="${target}" role="menuitem">${icon("trash")} Eliminar mes</button>`;
  monthMenu.hidden = false;
  const anchor = opener.getBoundingClientRect();
  monthMenu.style.left = `${Math.max(8, Math.min(anchor.right - monthMenu.offsetWidth, innerWidth - monthMenu.offsetWidth - 8))}px`;
  monthMenu.style.top = `${Math.min(anchor.bottom + 6, innerHeight - monthMenu.offsetHeight - 8)}px`;
  monthMenu.querySelector("button")!.focus();
}
monthMenu.addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-delete-month]",
  );
  if (!action) return;
  const target = action.dataset.deleteMonth!;
  closeMonthMenu();
  confirmDeleteMonth(target);
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#month-menu, [data-menu]"))
    closeMonthMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMonthMenu();
});
addEventListener("resize", closeMonthMenu);
document.querySelector("#months")!.addEventListener("scroll", closeMonthMenu);
document.querySelector("#months")!.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const dots = target.closest<HTMLElement>("[data-menu]");
  if (dots) {
    if (dots.getAttribute("aria-expanded") === "true") closeMonthMenu();
    else openMonthMenu(dots);
    return;
  }
  const button = target.closest<HTMLElement>("[data-month]");
  if (button) {
    selectMonth(button.dataset.month!);
    view = "records";
    page = 1;
    render();
    return;
  }
  const folder = target.closest<HTMLElement>("[data-year]");
  if (folder) {
    const year = folder.dataset.year!;
    if (!openYears.delete(year)) openYears.add(year);
    render();
  }
});
document.querySelector("#recurring-nav")!.addEventListener("click", () => {
  view = "recurring";
  render();
});
document.querySelector("#backup-nav")!.addEventListener("click", () => {
  view = "backup";
  render();
});
document.querySelector("#summary-nav")!.addEventListener("click", () => {
  view = "summary";
  render();
});
document.querySelector("#email-nav")!.addEventListener("click", () => {
  view = "email";
  render();
});
document.addEventListener("lila:extension-ready", (event) => {
  const detail = (event as CustomEvent).detail as
    | { cedula?: string; ruc?: string }
    | undefined;
  const next = { cedula: detail?.cedula ?? "", ruc: detail?.ruc ?? "" };
  const changed =
    !identity || identity.cedula !== next.cedula || identity.ruc !== next.ruc;
  identity = next;
  if (view === "email" && changed) render();
});
document.addEventListener("lila:extension-gone", () => {
  if (view !== "email") return;
  render();
  toast("La extensión se recargó. Actualiza esta página para reconectarla.", true);
});
document
  .querySelector("#add-month")!
  .addEventListener("click", openMonthDialog);
for (const [id, backup] of [
  ["report-file", false],
  ["backup-file", true],
] as const)
  document.querySelector<HTMLInputElement>(`#${id}`)!.onchange = (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) void previewImport(input.files[0], backup);
    input.value = "";
  };
document.addEventListener("lila:gmail-report", (event) => {
  const detail = (event as CustomEvent).detail as { text?: unknown } | undefined;
  if (typeof detail?.text !== "string" || !detail.text.trim()) return;
  void importFromGmail(detail.text);
});

async function importFromGmail(text: string) {
  if (busy) {
    toast("Espera a que termine la operación en curso.", true);
    return;
  }
  busy = true;
  try {
    const parsed = parseReport(text);
    const unique = uniqueRecords(parsed.records, await allInvoices());
    const saved = unique.records.map((r) => ({ ...r, id: crypto.randomUUID() }));
    if (saved.length) await saveInvoices(saved, []);
    [records, templates] = await Promise.all([allInvoices(), allRecurring()]);
    if (saved.length)
      selectMonth(
        saved
          .map((r) => r.month)
          .sort()
          .at(-1)!,
      );
    view = "records";
    query = "";
    category = "all";
    page = 1;
    render();

    const notes = [
      saved.length
        ? `${saved.length} ${saved.length === 1 ? "registro guardado" : "registros guardados"} desde Gmail`
        : "Nada nuevo desde Gmail: ya estaba todo registrado",
    ];
    if (unique.duplicates) notes.push(`${unique.duplicates} repetidos omitidos`);
    if (parsed.errors.length)
      notes.push(`${parsed.errors.length} sin datos válidos`);
    toast(`${notes.join(" · ")}.`);
  } catch (e) {
    toast(readableError(e), true);
  } finally {
    busy = false;
  }
}
const dropKinds: Record<string, "report" | "backup"> = {
  txt: "report",
  json: "backup",
};
const dropzone = document.querySelector<HTMLDivElement>("#dropzone")!;
let dropTarget: HTMLElement | null = null;
const draggingFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");
const zoneOf = (e: DragEvent) =>
  e.target instanceof Element
    ? e.target.closest<HTMLElement>("[data-drop]")
    : null;
function clearDrop() {
  dropzone.classList.remove("visible");
  dropTarget?.classList.remove("drop-target");
  dropTarget = null;
}
function openDropped(files: FileList | null, expected?: string) {
  if (!files?.length) return;
  if (busy) {
    toast("Espera a que termine la operación en curso.", true);
    return;
  }
  if (files.length > 1) {
    toast("Suelta un solo archivo a la vez.", true);
    return;
  }
  const file = files[0];
  const kind = dropKinds[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!kind) {
    toast(
      "Solo se admiten informes .txt del SRI y copias de seguridad .json.",
      true,
    );
    return;
  }
  if (expected && expected !== kind) {
    toast(
      expected === "backup"
        ? "Esta zona espera una copia de seguridad .json."
        : "Esta zona espera un informe .txt del SRI.",
      true,
    );
    return;
  }
  void previewImport(file, kind === "backup");
}
window.addEventListener("dragover", (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  dropzone.classList.add("visible");
  const zone = zoneOf(e);
  if (zone !== dropTarget) {
    dropTarget?.classList.remove("drop-target");
    zone?.classList.add("drop-target");
    dropTarget = zone;
  }
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) clearDrop();
});
window.addEventListener("dragend", clearDrop);
window.addEventListener("drop", (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  const expected = zoneOf(e)?.dataset.drop;
  clearDrop();
  openDropped(e.dataTransfer?.files ?? null, expected);
});
modal.addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
try {
  [records, templates] = await Promise.all([allInvoices(), allRecurring()]);
  if (records.length)
    selectMonth(
      records
        .map((r) => r.month)
        .sort()
        .at(-1)!,
    );
  render();
  document.dispatchEvent(new Event("lila:ready"));
} catch (e) {
  content.innerHTML = `<div class="empty"><h1>No pudimos abrir tus datos</h1><p>Verifica que este navegador permita el almacenamiento local y vuelve a cargar la página.</p><p>${escape(readableError(e))}</p><button class="button primary" id="reload">Reintentar</button></div>`;
  document
    .querySelector("#reload")!
    .addEventListener("click", () => location.reload());
}
