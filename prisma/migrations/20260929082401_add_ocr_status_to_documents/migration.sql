-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "ocr_completed_at" TIMESTAMP(3),
ADD COLUMN     "ocr_engine" TEXT,
ADD COLUMN     "ocr_error" TEXT,
ADD COLUMN     "ocr_status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "documents_ocr_status_idx" ON "documents"("ocr_status");
