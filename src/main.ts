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

const paths: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 7h6M9 11h6M9 15h3"/>',
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
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
let records: Invoice[] = [];
let templates: RecurringExpense[] = [];
let month = nowMonth();
let category = "all";
let query = "";
let page = 1;
let view: "records" | "backup" | "recurring" = "records";
let pending: Invoice[] = [];
let busy = false;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="/" aria-label="Lila, inicio"><span class="brand-mark">l<span>•</span></span><span>lila<span class="brand-sub">TUS CUENTAS, EN CALMA</span></span></a><div class="workspace"><span class="workspace-icon">${icon("receipt")}</span><div>Mi espacio personal<small>Gestión de facturas</small></div><span class="status-dot"></span></div><span class="nav-label">MI ORGANIZACIÓN</span><button class="nav-item active" id="records-nav">${icon("grid")} Mis facturas</button><div class="months-heading"><span>CARPETAS MENSUALES</span><button class="icon-button" id="add-month" aria-label="Ir a un mes">${icon("plus")}</button></div><nav id="months" aria-label="Carpetas mensuales"></nav><button class="nav-item backup-nav" id="backup-nav">${icon("shield")} Copias de seguridad</button><button class="nav-item" id="recurring-nav">${icon("receipt")} Gastos recurrentes</button><div class="local-note">${icon("shield")}<div>Solo en tu dispositivo<small>Tus datos se guardan en este navegador.</small></div></div><div class="sidebar-footer"><span class="avatar">M</span><div>Mi contabilidad<small>Un poco más de tranquilidad</small></div></div></aside><main><header class="topbar"><div class="breadcrumb">Mi espacio <span>/</span> <strong id="crumb">Mis facturas</strong></div><span class="device-status"><i></i> Guardado en este dispositivo</span></header><div id="content"></div><footer class="main-footer"><span>Hecho para que tus cuentas sean más simples.</span><span>Lila <span class="footer-dot">✦</span> Tu espacio de claridad</span></footer></main></div><dialog id="modal"></dialog><div id="toast" role="status" aria-live="polite"></div><input type="file" id="report-file" accept=".txt,text/plain" hidden><input type="file" id="backup-file" accept=".json,application/json" hidden>`;
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
function render() {
  const months = [...new Set(records.map((r) => r.month))].sort().reverse();
  document.querySelector("#months")!.innerHTML = months
    .map(
      (m) =>
        `<button class="month-item ${m === month && view === "records" ? "selected" : ""}" data-month="${m}">${icon("folder")}<span>${titleCase(monthName(m))}</span><span class="count">${records.filter((r) => r.month === m).length}</span></button>`,
    )
    .join("");
  document
    .querySelector("#records-nav")!
    .classList.toggle("active", view === "records");
  document
    .querySelector("#backup-nav")!
    .classList.toggle("active", view === "backup");
  document
    .querySelector("#recurring-nav")!
    .classList.toggle("active", view === "recurring");
  document.querySelector("#crumb")!.textContent =
    view === "records"
      ? "Mis facturas"
      : view === "backup"
        ? "Copias de seguridad"
        : "Gastos recurrentes";
  if (view === "recurring")
    return renderRecurringPage(recurringUI(), templates);
  if (view === "backup") return renderBackup();
  const current = records.filter((r) => r.month === month);
  const sums = totals(current);
  const availableRecurring = pendingRecurring(templates, records, month).length;
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">UN POCO DE ORDEN, MUCHA TRANQUILIDAD</div><h1>Mis facturas<span class="heading-dot">.</span></h1><p>Todo en su mes. Cada gasto en su lugar.</p></div><div class="heading-actions"><button class="button secondary" id="import">${icon("upload")} Importar informe</button><button class="button primary" id="new">${icon("plus")} Nuevo registro</button></div></div><section class="month-banner"><div class="month-title"><span class="calendar-icon">${icon("folder")}</span><div><span class="overline">ESTÁS REVISANDO</span><h2>${titleCase(monthName(month))}</h2></div></div><div class="month-actions">${templates.length ? `<button class="button secondary" id="apply-recurring" ${availableRecurring ? "" : "disabled"}>${icon("plus")} Añadir recurrentes (${availableRecurring})</button>` : ""}<label class="month-picker">Cambiar mes <input aria-label="Mes de emisión" type="month" id="month-picker" value="${month}" required></label>${current.length ? `<button class="button secondary month-delete" id="delete-month">${icon("trash")} Eliminar mes</button>` : ""}</div></section><section class="stats" aria-label="Totales del mes">${categories.map((c, i) => `<article class="stat stat-${i}"><div class="stat-top"><span>${["Aplicable IVA", "Actividades sin IVA", "Gastos personales"][i]}</span><span class="stat-icon">${icon(["receipt", "chart", "heart"][i])}</span></div><strong>${money(sums[c])}</strong><div class="stat-bottom"><span>${current.filter((r) => r.category === c).length} registros</span><span>${["Base sin impuestos", "Total registrado", "Importe total"][i]}</span></div></article>`).join("")}</section><section class="records-panel"><div class="panel-heading"><div><h2>Registros del mes <span class="pill">${current.length}</span></h2><p>Un lugar para todas tus facturas.</p></div><div class="month-total"><span>Total registrado</span><strong>${money(current.reduce((s, r) => s + r.cents, 0))}</strong></div></div><div class="table-toolbar"><div class="tabs" role="group" aria-label="Filtrar por categoría">${["all", ...categories].map((c, i) => `<button class="tab ${category === c ? "chosen" : ""}" data-category="${c}">${["Todos", "Aplicable IVA", "Sin IVA", "Personales"][i]}</button>`).join("")}</div><label class="search">${icon("search")}<input id="search" placeholder="Buscar factura o detalle…" aria-label="Buscar factura o detalle" value="${escape(query)}"></label></div><div id="table-content"></div></section><div class="tip">${icon("info")}<span><strong>Tu información, contigo.</strong> Crea una copia de seguridad para conservar tus registros o llevarlos a otro dispositivo.</span><button id="quick-backup">Crear copia ${icon("arrow")}</button></div>`;
  renderTable();
  document.querySelector("#apply-recurring")?.addEventListener("click", () => {
    void applyRecurring(recurringUI(), month, monthName(month));
  });
  document
    .querySelector("#delete-month")
    ?.addEventListener("click", confirmDeleteMonth);
  document.querySelector("#new")!.addEventListener("click", () => editRecord());
  document
    .querySelector("#import")!
    .addEventListener("click", () =>
      document.querySelector<HTMLInputElement>("#report-file")!.click(),
    );
  document.querySelector("#month-picker")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      month = value;
      page = 1;
      render();
    }
  });
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
    ? `<div class="table-scroll"><table><thead><tr><th>N.º DE FACTURA</th><th>DETALLE</th><th>CATEGORÍA</th><th class="amount">TOTAL</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${filtered
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
      if (
        records.some(
          (r) => r.id !== record?.id && keyFor(r.number) === keyFor(number),
        )
      )
        throw new Error("Este número de factura ya está registrado.");
      const entry: Invoice = {
        id: record?.id ?? crypto.randomUUID(),
        number,
        month: String(form.get("month")),
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
      month = entry.month;
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
function confirmDeleteMonth() {
  const targetMonth = month;
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
      month =
        records
          .map((r) => r.month)
          .sort()
          .at(-1) ?? nowMonth();
      query = "";
      category = "all";
      page = 1;
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
            month = toSave
              .map((r) => r.month)
              .sort()
              .at(-1)!;
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
function renderBackup() {
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">TU INFORMACIÓN, SIEMPRE CONTIGO</div><h1>Copias de seguridad<span class="heading-dot">.</span></h1><p>Guarda una copia hoy. Retoma con tranquilidad mañana.</p></div></div><div class="backup-grid"><article class="backup-card"><span class="dialog-icon">${icon("download")}</span><h2>Descargar mis datos</h2><p>Guarda todas tus facturas en un archivo JSON. Incluye todos los meses, categorías y la configuración de gastos recurrentes.</p><div class="backup-meta">${records.length} registros · ${new Set(records.map((r) => r.month)).size} meses · ${templates.length} recurrentes</div><button class="button primary" id="download-backup">${icon("download")} Descargar copia</button></article><article class="backup-card"><span class="dialog-icon">${icon("upload")}</span><h2>Recuperar una copia</h2><p>Selecciona una copia de Lila para añadir sus registros a este navegador. Las facturas repetidas se omiten.</p><div class="backup-meta">Archivo .json · Vista previa antes de guardar</div><button class="button secondary" id="restore-backup">${icon("upload")} Seleccionar copia</button></article></div><div class="storage-explainer">${icon("shield")}<div><h3>Tus datos se guardan en este navegador</h3><p>Lila usa IndexedDB en tu dispositivo. Si cambias de navegador, borras los datos del sitio o usas una ventana privada, necesitarás una copia para recuperar tu información. Descarga una copia con regularidad y guárdala en un lugar seguro.</p></div></div>`;
  document
    .querySelector("#download-backup")!
    .addEventListener("click", exportBackup);
  document
    .querySelector("#restore-backup")!
    .addEventListener("click", () =>
      document.querySelector<HTMLInputElement>("#backup-file")!.click(),
    );
}
document.querySelector("#months")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-month]");
  if (button) {
    month = button.dataset.month!;
    view = "records";
    page = 1;
    render();
  }
});
document.querySelector("#records-nav")!.addEventListener("click", () => {
  view = "records";
  render();
});
document.querySelector("#recurring-nav")!.addEventListener("click", () => {
  view = "recurring";
  render();
});
document.querySelector("#backup-nav")!.addEventListener("click", () => {
  view = "backup";
  render();
});
document.querySelector("#add-month")!.addEventListener("click", () => {
  showModal(
    `<h2>Ir a un mes</h2><p class="dialog-description">Cada registro se organiza en su mes de emisión.</p><form id="month-form"><label>Mes de emisión<input name="month" type="month" value="${month}" required></label><div class="dialog-actions"><button class="button primary">Abrir carpeta ${icon("arrow")}</button></div></form>`,
  );
  document.querySelector<HTMLFormElement>("#month-form")!.onsubmit = (e) => {
    e.preventDefault();
    const value = String(
      new FormData(e.currentTarget as HTMLFormElement).get("month"),
    );
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      toast("Selecciona un mes con año de cuatro dígitos.", true);
      return;
    }
    month = value;
    view = "records";
    page = 1;
    modal.close();
    render();
  };
});
for (const [id, backup] of [
  ["report-file", false],
  ["backup-file", true],
] as const)
  document.querySelector<HTMLInputElement>(`#${id}`)!.onchange = (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) void previewImport(input.files[0], backup);
    input.value = "";
  };
modal.addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
try {
  [records, templates] = await Promise.all([allInvoices(), allRecurring()]);
  if (records.length)
    month = records
      .map((r) => r.month)
      .sort()
      .at(-1)!;
  render();
} catch (e) {
  content.innerHTML = `<div class="empty"><h1>No pudimos abrir tus datos</h1><p>Verifica que este navegador permita el almacenamiento local y vuelve a cargar la página.</p><p>${escape(readableError(e))}</p><button class="button primary" id="reload">Reintentar</button></div>`;
  document
    .querySelector("#reload")!
    .addEventListener("click", () => location.reload());
}
