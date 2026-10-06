-- AlterTable
--
-- "metadata" holds facts about the file itself that are cheap to learn once and
-- expensive to learn again. The only field written today is "pageCount", which is
-- the number of pages in a PDF. The OCR queue orders by it so that short documents
-- are converted first: a one-page notice should not sit behind a two-hundred-page
-- gazette, because a document's cost is known before it is queued and there is no
-- reason to spend an hour on the small one second.
--
-- JSONB rather than a page_count column because the useful metadata is not a fixed
-- list -- file size, whether the PDF has an extractable text layer, and the HTTP
-- status last seen all belong here too, and none of them justify a migration each.
-- Rows written before this column existed have NULL here, which the ordering treats
-- as "unknown" and sorts last, so the queue degrades to arrival order rather than
-- breaking.
ALTER TABLE "documents" ADD COLUMN "metadata" JSONB;

-- Both indexes use CAST(... AS int) rather than the shorter `::int`. Inside an
-- index expression list the cast operator is ambiguous -- `ON t ((col->>'k')::int)`
-- is a syntax error, because the parenthesis is read as an expression list rather
-- than as a grouping -- and CAST is the form that parses unambiguously. The same
-- cast written with :: in the ORDER BY clauses is fine, because there it is an
-- ordinary expression and not an index expression.

-- The queue's first sort key.
CREATE INDEX "documents_metadata_page_count_idx" ON "documents" (CAST(metadata ->> 'pageCount' AS int));

-- The claim filters on ocr_status and then wants the rows in page-count order
-- within that, so a composite index lets one scan satisfy both instead of sorting
-- every eligible row on each enqueue call.
CREATE INDEX "documents_ocr_status_page_count_idx" ON "documents" ("ocr_status", CAST(metadata ->> 'pageCount' AS int));