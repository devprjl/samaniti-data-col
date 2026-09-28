/**
 * Query shapes shared by the API and the static snapshot exporter.
 *
 * The deployed portal can be served either from this API or from a JSON snapshot
 * written by `scripts/export-snapshot.ts`. Both have to return byte-identical
 * records or a page that works against one will break against the other, so the
 * selects live here instead of being written twice.
 */

export const municipalitySelect = {
    id: true,
    code: true,
    nameEn: true,
    nameNe: true,
    province: true,
    district: true,
};

/**
 * Document fields for a list row.
 *
 * The stored copy of a file lives on the scraper's own disk and never reaches a
 * deployment, so `storagePath` and `downloadError` are of no use to a reader and
 * are left to the detail endpoint.
 */
export const documentListSelect = {
    id: true,
    fileName: true,
    originalUrl: true,
    downloadStatus: true,
};

/**
 * Municipality reference carried on a list row.
 *
 * The full row is fetched separately by `/api/municipalities` and joined in the
 * client, and a list row only ever displays the local government's name, so
 * repeating all six fields on every one of a few thousand records is pure weight.
 */
const municipalityNameSelect = {
    nameEn: true,
    nameNe: true,
};

/**
 * Everything a list row needs, and nothing more.
 *
 * `/api/policies` returns one of these per record. Everything that only the detail
 * page renders — the body, the budget figure, ward, status and last-modified stamp
 * — is left out on purpose: a full collection is about 5 MB, and a serverless
 * response is rejected above 4.5 MB, so carrying those fields here would take the
 * portal down as the data grew. `GET /api/policies/:id` serves one complete record.
 */
export const policyListSelect = {
    id: true,
    municipalityId: true,
    category: true,
    titleNe: true,
    titleEn: true,
    type: true,
    fiscalYear: true,
    publishedDate: true,
    sourceUrl: true,
    createdAt: true,
    municipality: { select: municipalityNameSelect },
    documents: { select: documentListSelect, orderBy: { createdAt: "asc" } },
};

/** A single complete record, for the detail page. */
export const policySelect = {
    ...policyListSelect,
    contentNe: true,
    contentEn: true,
    budgetAmount: true,
    status: true,
    wardNo: true,
    updatedAt: true,
    metadata: true,
    documents: {
        select: {
            ...documentListSelect,
            fileType: true,
            storagePath: true,
            downloadError: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    },
};
