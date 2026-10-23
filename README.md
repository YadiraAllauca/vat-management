# Lila — Personal invoice organizer

A lightweight, Spanish-language invoice manager with a soft lilac interface. Built with TypeScript, Vite, and native IndexedDB. No backend, account, or runtime framework is required.

## Getting started

Requirements: Node.js 22.18+ within the 22.x release line and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

Serve `dist/` with any static HTTP server. Use the same hostname and port to retain access to the same browser database; development and preview URLs have separate storage. Opening `index.html` directly with `file://` is not supported.

## Deploying to Vercel

The repository includes `vercel.json` with the Vite preset, `npm ci` installation, `npm run build`, and the `dist` output directory. Node.js is pinned to 22.x in `package.json`. No environment variables, backend, Vercel tokens, or GitHub Actions workflow are needed for this app.

1. Push this project to your Git provider with a `master` branch, including `package-lock.json` and `vercel.json`.
2. In Vercel, choose **Add New → Project**, import the Git repository, and set the Root Directory to the directory containing `package.json` (`./` if the app is at the repository root).
3. Verify the detected Vite preset, then deploy. The build and install settings are supplied by `vercel.json`.
4. In the project settings, set the production environment's **Branch Tracking / Production Branch** to `master`. This is a Vercel project setting, not a `vercel.json` property.
5. Every subsequent push or merged pull request to `master` triggers a production deployment. Other branches normally create preview deployments.

The Git integration must be connected to the repository in Vercel. Repository configuration alone does not activate automatic deployments. See [Vercel Git deployments](https://vercel.com/docs/git) and [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Use the stable production URL for everyday work: IndexedDB belongs to each browser and origin. Localhost, preview URLs, the production URL, and a custom domain have separate data. Export a backup from your current URL and restore it on the production URL when moving. Deploying new code on the same production origin does not itself clear existing browser data.

## Features

- Create, edit, and delete invoices with invoice number, emission month, category, description, and USD amount.
- Delete a complete month from its own folder: the three-dot button in the sidebar opens the folder menu, and the confirmation states the month's name, record count, and total. This removes all categories regardless of active filters; other months are preserved, and deleting a month you are not currently viewing keeps you where you are. Empty months disappear from the folder list.
- Monthly folders grouped into year folders in the sidebar, each year collapsible and showing its record count; the year holding the open month is marked. The sidebar opens on the month folders themselves, without a separate invoices entry.
- Open any month from the folder header's **Cambiar de mes** or the sidebar's **+**, both opening the same picker: the twelve months of a year in Spanish, each showing how many invoices it holds, with year arrows and a shortcut to the current month. Months without invoices open empty.
- The open folder states what it holds: its name, how many invoices it has, and their total.
- Independent totals for all three categories, category filters, text search, and pagination.
- Preview and import tab-separated SRI received-invoice reports, with line-level validation and duplicate detection.
- Drag a report or a backup anywhere onto the window: `.txt` is read as an SRI report and `.json` as a backup, both through the usual preview.
- Yearly summary with per-month totals for each category, both calendar-semester subtotals, and the yearly total.
- Global recurring-expense templates: add, edit, remove with confirmation, and apply selected templates once per month.
- Download a complete JSON backup and merge a backup into the current device without overwriting existing invoices.
- Responsive layouts, labeled controls, keyboard-accessible dialogs, and explicit storage errors. On phones each invoice reads as a card with its amount and actions in view, and the yearly summary keeps the month column pinned while the amounts scroll.

## Import rules

Use **Importar informe** to select a tab-separated SRI received-invoice `.txt` report, or drop the file onto the window. Keep personal reports and backups outside Git. Tests use generated fictional records.

| Report field                       | Stored value                                 |
| ---------------------------------- | -------------------------------------------- |
| `SERIE_COMPROBANTE`                | Invoice number                               |
| `FECHA_EMISION`                    | Emission month, derived from `DD/MM/YYYY`    |
| `RAZON_SOCIAL_EMISOR`              | Description                                  |
| 10-digit `IDENTIFICACION_RECEPTOR` | `GASTOS PERSONALES`, using `IMPORTE_TOTAL`   |
| 13-digit `IDENTIFICACION_RECEPTOR` | `APLICABLE IVA`, using `VALOR_SIN_IMPUESTOS` |

`ACTIVIDADES SIN IVA` is available for manual entries and edits. For manual applicable-VAT entries, enter the amount excluding taxes. Classification follows these recipient-length rules only; it is not inferred from the VAT value. Only `Factura` rows are imported. Other document types, invalid dates, invalid amounts, and unsupported recipient IDs are reported and skipped. The preview shows new rows, duplicates, rejected rows, totals, and affected months before saving. UTF-8 and Windows-1252 reports are supported. The maximum input file size is 20 MB.

Duplicate matching is per emission month and covers every category, using the invoice number with spaces and hyphens removed and letters uppercased. The same invoice number may therefore be recorded in different months, but not twice within one month. Existing invoices are preserved. A unique IndexedDB index on month and invoice number also prevents concurrent duplicate writes. Amounts are stored as integer cents, avoiding decimal rounding during aggregation. The combined monthly total is the sum of the stored amounts; it is not a tax calculation.

## Monthly, semester, and yearly totals

Open **Resumen anual** in the sidebar and pick a year. The table lists every month of that year with a column per category, the month's total, and its record count. The subtotal after June covers the **first semester (January–June)**, the subtotal after December the **second semester (July–December)**, and the table footer the whole year. Semesters follow the calendar. Months without records are shown as zero so years stay comparable. Every figure is a sum of the stored integer cents, not a tax calculation.

## Dragging files in

Drop a file anywhere on the window to import it: `.txt` is read as an SRI received-invoice report and `.json` as a Lila backup. The records panel accepts reports and the **Recuperar una copia** card accepts backups; dropping the wrong kind on either reports the mismatch and imports nothing. Dropping more than one file at a time, or any other extension, is also refused. Every drop opens the same preview as the buttons, so nothing is saved before confirmation.

## Recurring expenses

Open **Gastos recurrentes** in the sidebar to manage global templates. Each template stores a name, category, description, and monthly USD amount. Add, edit, or remove templates as your expenses change. Removing a template requires confirmation. Changes affect future applications only; existing invoices are preserved.

In **Mis facturas**, select a month and choose **Añadir recurrentes**. Select the templates to use, enter the actual invoice numbers, adjust amounts if necessary, and confirm the batch. Invoice numbers are intentionally not fabricated or reused across months. Unchecked templates remain available for later. Generation is explicit; opening a month does not create invoices automatically.

A template can be applied once per month, enforced by a unique IndexedDB index in addition to invoice-number checks. Editing the invoice number keeps its recurrence link. Deleting the generated invoice or its entire month makes the template available again for that month. Editing a generated invoice's emission month moves its recurrence link to the new month, provided that template has not already been used there.

## Storage and backups

All records are stored in the `lila-invoices` IndexedDB database in the browser for the current origin. No invoice information is sent to a server. Font styles are requested from Google Fonts, with local fallback fonts. Clearing site data, changing browser profiles, or ending a private session may remove access to records. Keep regular backups outside the browser.

Go to **Copias de seguridad → Descargar copia** to export every month and all recurring templates. To restore on another device, open Lila there, choose **Seleccionar copia**, review the preview, and confirm. Restoration merges new invoices and templates, preserving existing records and templates with matching IDs. Existing recurrence-and-month combinations are also skipped. Backups contain invoice data in readable JSON; store them appropriately.

Backup format:

```json
{
  "app": "lila",
  "version": 2,
  "exportedAt": "2026-10-21T12:00:00.000Z",
  "records": [],
  "recurring": []
}
```

Version 1 backups (invoices only) remain supported. The IndexedDB schema upgrades from version 1 or 2 to version 3 without deleting existing invoices; the version 3 upgrade rekeys stored invoices so uniqueness applies within each month. Template IDs and invoice recurrence links are preserved across backups.

The complete backup is validated before a transaction begins. Writes are atomic: a failed batch does not partially import. Backup record IDs are regenerated during restoration to prevent ID collisions with existing data.

## Validation

```sh
npm test
npm run build
```

Tests cover generated fictional reports, recipient classification, integer-cent totals, malformed rows, per-month duplicates, month, semester and yearly totals, backup validation and round trips, schema migration, recurring settings, monthly recurrence uniqueness, backup compatibility, transactional rollback, and actual IndexedDB operations using `fake-indexeddb`.

## Project structure

- `src/main.ts`: interface and workflows.
- `src/recurring.ts`: global recurring-expense settings and monthly application.
- `src/summary.ts`: month, semester, and yearly totals page.
- `src/domain.ts`: validation, parsing, duplicate detection, and totals.
- `src/db.ts`: transactional IndexedDB persistence.
- `src/style.css`: responsive lilac theme.
- `tests/domain.test.ts`: data and persistence tests.

Runtime dependencies: none. Development dependencies: TypeScript, Vite, and fake-indexeddb.
