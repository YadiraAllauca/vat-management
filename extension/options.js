const fields = ["lilaUrl", "cedula", "ruc"];
const status = document.querySelector("#status");

chrome.storage.local.get(fields).then((stored) => {
  for (const name of fields)
    document.querySelector(`#${name}`).value = stored[name] ?? "";
});

document.querySelector("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = {};
  for (const name of fields)
    values[name] = document.querySelector(`#${name}`).value.trim();

  status.classList.remove("error");
  try {
    new URL(values.lilaUrl);
  } catch {
    status.textContent = "La dirección de Lila no es una URL válida.";
    status.classList.add("error");
    return;
  }
  if (values.cedula && !/^\d{10}$/.test(values.cedula)) {
    status.textContent = "La cédula debe tener diez dígitos.";
    status.classList.add("error");
    return;
  }
  if (values.ruc && !/^\d{13}$/.test(values.ruc)) {
    status.textContent = "El RUC debe tener trece dígitos.";
    status.classList.add("error");
    return;
  }

  await chrome.storage.local.set(values);
  status.textContent = "Ajustes guardados.";
});
