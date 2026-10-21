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
- Delete a complete month after confirming its name, record count, and total. This removes all categories regardless of active filters; other months are preserved. Empty months disappear from the folder list.
- Monthly folders, independent totals for all three categories, category filters, text search, and pagination.
- Preview and import tab-separated SRI received-invoice reports, with line-level validation and duplicate detection.
- Global recurring-expense templates: add, edit, remove with confirmation, and apply selected templates once per month.
- Download a complete JSON backup and merge a backup into the current device without overwriting existing invoices.
- Responsive layouts, labeled controls, keyboard-accessible dialogs, and explicit storage errors.

## Import rules

Use **Importar informe** to select a tab-separated SRI received-invoice `.txt` report. Keep personal reports and backups outside Git. Tests use generated fictional records.

| Report field                       | Stored value                                 |
| ---------------------------------- | -------------------------------------------- |
| `SERIE_COMPROBANTE`                | Invoice number                               |
| `FECHA_EMISION`                    | Emission month, derived from `DD/MM/YYYY`    |
| `RAZON_SOCIAL_EMISOR`              | Description                                  |
| 10-digit `IDENTIFICACION_RECEPTOR` | `GASTOS PERSONALES`, using `IMPORTE_TOTAL`   |
| 13-digit `IDENTIFICACION_RECEPTOR` | `APLICABLE IVA`, using `VALOR_SIN_IMPUESTOS` |

`ACTIVIDADES SIN IVA` is available for manual entries and edits. For manual applicable-VAT entries, enter the amount excluding taxes. Classification follows these recipient-length rules only; it is not inferred from the VAT value. Only `Factura` rows are imported. Other document types, invalid dates, invalid amounts, and unsupported recipient IDs are reported and skipped. The preview shows new rows, duplicates, rejected rows, totals, and affected months before saving. UTF-8 and Windows-1252 reports are supported. The maximum input file size is 20 MB.

Duplicate matching is global across months and categories, using the invoice number with spaces and hyphens removed and letters uppercased. Existing invoices are preserved. A unique IndexedDB index also prevents concurrent duplicate writes. Amounts are stored as integer cents, avoiding decimal rounding during aggregation. The combined monthly total is the sum of the stored amounts; it is not a tax calculation.

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

Version 1 backups (invoices only) remain supported. The IndexedDB schema upgrades from version 1 to version 2 without deleting existing invoices. Template IDs and invoice recurrence links are preserved across backups.

The complete backup is validated before a transaction begins. Writes are atomic: a failed batch does not partially import. Backup record IDs are regenerated during restoration to prevent ID collisions with existing data.

## Validation

```sh
npm test
npm run build
```

Tests cover generated fictional reports, recipient classification, integer-cent totals, malformed rows, duplicates, backup validation and round trips, schema migration, recurring settings, monthly recurrence uniqueness, backup compatibility, transactional rollback, and actual IndexedDB operations using `fake-indexeddb`.

## Project structure

- `src/main.ts`: interface and workflows.
- `src/recurring.ts`: global recurring-expense settings and monthly application.
- `src/domain.ts`: validation, parsing, duplicate detection, and totals.
- `src/db.ts`: transactional IndexedDB persistence.
- `src/style.css`: responsive lilac theme.
- `tests/domain.test.ts`: data and persistence tests.

Runtime dependencies: none. Development dependencies: TypeScript, Vite, and fake-indexeddb.
