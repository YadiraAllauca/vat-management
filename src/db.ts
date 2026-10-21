import {
  keyFor,
  recurringKey,
  validateInvoice,
  validateRecurring,
  type Invoice,
  type RecurringExpense,
} from "./domain.ts";
let connection: Promise<IDBDatabase> | undefined;
function open() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lila-invoices", 2);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) {
        const store = request.result.createObjectStore("invoices", {
          keyPath: "id",
        });
        store.createIndex("numberKey", "numberKey", { unique: true });
      }
      request
        .transaction!.objectStore("invoices")
        .createIndex("recurringKey", "recurringKey", { unique: true });
      request.result.createObjectStore("recurring", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error("Cierra otras pestañas de Lila e intenta de nuevo."));
    };
  }));
}
export async function allInvoices(): Promise<Invoice[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("invoices").objectStore("invoices").getAll();
    request.onsuccess = () => resolve(request.result.map(validateInvoice));
    request.onerror = () => reject(request.error);
  });
}
export async function saveInvoices(
  records: Invoice[],
  templates: RecurringExpense[] = [],
) {
  const clean = records.map(validateInvoice);
  const cleanTemplates = templates.map(validateRecurring);
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["invoices", "recurring"], "readwrite");
    const store = tx.objectStore("invoices");
    clean.forEach((r) =>
      store.put({
        ...r,
        numberKey: keyFor(r.number),
        ...(recurringKey(r) ? { recurringKey: recurringKey(r) } : {}),
      }),
    );
    const recurringStore = tx.objectStore("recurring");
    cleanTemplates.forEach((r) => {
      // Restore only missing templates, preserving the current global settings.
      const request = recurringStore.get(r.id);
      request.onsuccess = () => {
        if (!request.result) recurringStore.add(r);
      };
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("No se pudieron guardar los datos."));
    tx.onerror = () => {};
  });
}

export async function allRecurring(): Promise<RecurringExpense[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("recurring")
      .objectStore("recurring")
      .getAll();
    request.onsuccess = () => resolve(request.result.map(validateRecurring));
    request.onerror = () => reject(request.error);
  });
}
export async function saveRecurring(template: RecurringExpense) {
  const clean = validateRecurring(template);
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("recurring", "readwrite");
    tx.objectStore("recurring").put(clean);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export async function deleteRecurring(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("recurring", "readwrite");
    tx.objectStore("recurring").delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export async function deleteInvoice(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("invoices", "readwrite");
    tx.objectStore("invoices").delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("El mes no es válido.");
  }
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("invoices", "readwrite");
    const request = tx.objectStore("invoices").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.month === month) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("No se pudo eliminar el mes."));
  });
}
