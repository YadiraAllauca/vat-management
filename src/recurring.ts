import {
  amountToCents,
  categories,
  keyFor,
  pendingRecurring,
  type Invoice,
  type RecurringExpense,
} from "./domain.ts";
import {
  allInvoices,
  allRecurring,
  saveRecurring,
  deleteRecurring,
  saveInvoices,
} from "./db.ts";

export interface RecurringUI {
  content: HTMLElement;
  modal: HTMLDialogElement;
  showModal: (html: string) => void;
  icon: (name: string) => string;
  escape: (value: string) => string;
  money: (cents: number) => string;
  toast: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
  setBusy: (value: boolean) => void;
  isBusy: () => boolean;
}
function errorMessage(error: unknown) {
  return error instanceof DOMException && error.name === "ConstraintError"
    ? "Una factura o recurrente ya está registrado en este mes. Cierra esta ventana y vuelve a revisar."
    : error instanceof Error
      ? error.message
      : "No se pudo completar la operación.";
}
export function renderRecurringPage(
  ui: RecurringUI,
  templates: RecurringExpense[],
) {
  const { icon, escape, money, content } = ui;
  content.innerHTML = `<div class="page-heading"><div><div class="eyebrow">CONFIGURA UNA VEZ, REUTILIZA CADA MES</div><h1>Gastos recurrentes<span class="heading-dot">.</span></h1><p>Tus gastos habituales, listos para el próximo mes.</p></div><button class="button primary" id="new-recurring">${icon("plus")} Agregar recurrente</button></div><div class="storage-explainer recurring-explainer">${icon("info")}<div><h3>Una configuración para todos tus meses</h3><p>Guarda el detalle, la categoría y el importe de tus gastos habituales. En Mis facturas, elige un mes y pulsa «Añadir recurrentes» para seleccionar los que correspondan y completar sus números de factura. Cada plantilla se añade una sola vez por mes.</p></div></div><section class="recurring-list">${templates.length ? templates.map((t) => `<article class="recurring-card"><span class="dialog-icon">${icon("receipt")}</span><div class="recurring-info"><h2>${escape(t.name)}</h2><p>${escape(t.detail || "Sin detalle")}</p><span class="badge badge-${categories.indexOf(t.category)}">${escape(t.category)}</span></div><div class="recurring-price"><strong>${money(t.cents)}</strong><small>Cada mes</small></div><div class="row-actions"><button class="icon-button" data-edit-recurring="${escape(t.id)}" aria-label="Editar ${escape(t.name)}">${icon("edit")}</button><button class="icon-button delete" data-delete-recurring="${escape(t.id)}" aria-label="Quitar ${escape(t.name)}">${icon("trash")}</button></div></article>`).join("") : `<div class="empty"><span class="empty-icon">${icon("receipt")}</span><h3>Menos trabajo cada mes</h3><p>Agrega gastos como internet, arriendo o una suscripción.<br>Sus datos quedarán listos para reutilizarlos.</p></div>`}</section>`;
  content
    .querySelector("#new-recurring")!
    .addEventListener("click", () => editRecurring(ui));
  content.querySelectorAll<HTMLElement>("[data-edit-recurring]").forEach(
    (b) =>
      (b.onclick = () =>
        editRecurring(
          ui,
          templates.find((t) => t.id === b.dataset.editRecurring),
        )),
  );
  content.querySelectorAll<HTMLElement>("[data-delete-recurring]").forEach(
    (b) =>
      (b.onclick = () =>
        removeRecurring(
          ui,
          templates.find((t) => t.id === b.dataset.deleteRecurring)!,
        )),
  );
}
function editRecurring(ui: RecurringUI, template?: RecurringExpense) {
  const { modal, icon, escape } = ui;
  ui.showModal(
    `<span class="dialog-icon">${icon("receipt")}</span><h2>${template ? "Editar recurrente" : "Nuevo gasto recurrente"}</h2><p class="dialog-description">Estos datos estarán disponibles para todos los meses.</p><form id="recurring-form"><label>Nombre<input name="name" required maxlength="100" placeholder="Ej. Internet de casa" value="${escape(template?.name ?? "")}"></label><div class="form-row"><label>Categoría<select name="category">${categories.map((c) => `<option ${c === template?.category ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Importe mensual (USD)<input name="amount" inputmode="decimal" required placeholder="0.00" value="${template ? (template.cents / 100).toFixed(2) : ""}"></label></div><p class="field-hint">Para Aplicable IVA, ingresa el valor sin impuestos. Podrás ajustar el importe al añadirlo a cada mes.</p><label>Detalle<textarea name="detail" maxlength="2000" rows="3" placeholder="Proveedor o descripción">${escape(template?.detail ?? "")}</textarea></label>${template ? '<p class="field-hint">Los cambios se usarán al añadir futuros registros. Los que ya guardaste conservarán sus datos.</p>' : ""}<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-recurring">Cancelar</button><button class="button primary" type="submit">${icon("check")} Guardar recurrente</button></div></form>`,
  );
  modal.querySelector("#cancel-recurring")!.addEventListener("click", () => {
    if (!ui.isBusy()) modal.close();
  });
  modal.querySelector<HTMLFormElement>("#recurring-form")!.onsubmit = async (
    e,
  ) => {
    e.preventDefault();
    if (ui.isBusy()) return;
    const form = new FormData(e.currentTarget as HTMLFormElement);
    try {
      ui.setBusy(true);
      await saveRecurring({
        id: template?.id ?? crypto.randomUUID(),
        name: String(form.get("name")).trim(),
        detail: String(form.get("detail")).trim(),
        category: String(form.get("category")) as RecurringExpense["category"],
        cents: amountToCents(String(form.get("amount"))),
        createdAt: template?.createdAt ?? new Date().toISOString(),
      });
      await ui.refresh();
      modal.close();
      ui.toast("Configuración recurrente guardada.");
    } catch (e) {
      modal.querySelector(".form-error")!.textContent = errorMessage(e);
    } finally {
      ui.setBusy(false);
    }
  };
}
function removeRecurring(ui: RecurringUI, template: RecurringExpense) {
  ui.showModal(
    `<span class="dialog-icon">${ui.icon("trash")}</span><h2>¿Quitar este recurrente?</h2><p class="dialog-description">«${ui.escape(template.name)}» dejará de aparecer al añadir recurrentes. Las facturas que ya registraste se conservarán.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" id="keep-recurring">Conservar</button><button class="button danger" id="remove-recurring">Quitar recurrente</button></div>`,
  );
  ui.modal.querySelector("#keep-recurring")!.addEventListener("click", () => {
    if (!ui.isBusy()) ui.modal.close();
  });
  ui.modal
    .querySelector("#remove-recurring")!
    .addEventListener("click", async () => {
      if (ui.isBusy()) return;
      ui.setBusy(true);
      try {
        await deleteRecurring(template.id);
        await ui.refresh();
        ui.modal.close();
        ui.toast("Recurrente eliminado de la configuración.");
      } catch (e) {
        ui.modal.querySelector(".form-error")!.textContent = errorMessage(e);
      } finally {
        ui.setBusy(false);
      }
    });
}
export async function applyRecurring(
  ui: RecurringUI,
  month: string,
  monthLabel: string,
) {
  try {
    const [templates, records] = await Promise.all([
      allRecurring(),
      allInvoices(),
    ]);
    const available = pendingRecurring(templates, records, month);
    const { icon, escape, money, modal } = ui;
    if (!available.length) {
      ui.toast("Todos los recurrentes ya están añadidos a este mes.");
      await ui.refresh();
      return;
    }
    ui.showModal(
      `<span class="dialog-icon">${icon("receipt")}</span><h2>Recurrentes de ${escape(monthLabel)}</h2><p class="dialog-description">Selecciona tus gastos, completa los números de factura y ajusta los importes si hace falta. ${templates.length - available.length} ya registrados se omiten.</p><form id="apply-recurring-form"><div class="recurring-entries">${available.map((t, i) => `<fieldset class="recurring-entry"><legend><label class="recurring-check"><input type="checkbox" name="include-${i}" checked><span>${escape(t.name)}</span></label></legend><span class="badge badge-${categories.indexOf(t.category)}">${escape(t.category)}</span><p class="field-hint">${escape(t.detail || "Sin detalle")}</p><div class="form-row"><label>Número de factura<input name="number-${i}" required maxlength="100" placeholder="001-001-000000001"></label><label>Importe (USD)<input name="amount-${i}" inputmode="decimal" required value="${(t.cents / 100).toFixed(2)}"></label></div><span class="field-hint">Importe configurado: ${money(t.cents)}</span></fieldset>`).join("")}</div><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" id="cancel-apply">Cancelar</button><button type="submit" class="button primary">${icon("check")} Añadir al mes</button></div></form>`,
    );
    modal.querySelector("#cancel-apply")!.addEventListener("click", () => {
      if (!ui.isBusy()) modal.close();
    });
    modal.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(
      (box) =>
        (box.onchange = () => {
          box
            .closest("fieldset")!
            .querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')
            .forEach((input) => (input.disabled = !box.checked));
        }),
    );
    modal.querySelector<HTMLFormElement>("#apply-recurring-form")!.onsubmit =
      async (e) => {
        e.preventDefault();
        if (ui.isBusy()) return;
        try {
          ui.setBusy(true);
          const form = new FormData(e.currentTarget as HTMLFormElement);
          const fresh = await allInvoices();
          const eligible = new Set(
            pendingRecurring(available, fresh, month).map((t) => t.id),
          );
          const numbers = new Set(
            fresh.filter((r) => r.month === month).map((r) => keyFor(r.number)),
          );
          const entries: Invoice[] = [];
          available.forEach((t, i) => {
            if (!form.has(`include-${i}`)) return;
            if (!eligible.has(t.id))
              throw new Error(
                `«${t.name}» ya se añadió a este mes. Cierra y vuelve a revisar.`,
              );
            const number = String(form.get(`number-${i}`)).trim();
            if (!keyFor(number))
              throw new Error(`Completa el número de factura de «${t.name}».`);
            if (numbers.has(keyFor(number)))
              throw new Error(
                `La factura ${number} ya está registrada en este mes o se repite en la selección.`,
              );
            numbers.add(keyFor(number));
            entries.push({
              id: crypto.randomUUID(),
              number,
              month,
              category: t.category,
              detail: t.detail || t.name,
              cents: amountToCents(String(form.get(`amount-${i}`))),
              createdAt: new Date().toISOString(),
              recurringId: t.id,
            });
          });
          if (!entries.length)
            throw new Error("Selecciona al menos un recurrente.");
          await saveInvoices(entries);
          await ui.refresh();
          modal.close();
          ui.toast(`${entries.length} recurrentes añadidos al mes.`);
        } catch (e) {
          modal.querySelector(".form-error")!.textContent = errorMessage(e);
        } finally {
          ui.setBusy(false);
        }
      };
  } catch (e) {
    ui.toast(errorMessage(e), true);
  }
}
