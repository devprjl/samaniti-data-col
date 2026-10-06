/** Lifecycle of a document's OCR pass, mirrored into `documents.ocr_status`. */
export type OcrStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "skipped";

export interface OcrJobPayload {
    document_id: string;
    source_url: string;
    file_name: string;
    file_type?: string | null;
    engine?: "auto" | "paddleocr" | "suryaocr" | "easyocr" | "vlm";
    max_pages?: number | null;
    scale?: number;
}

export interface OcrJobEvent {
    event: "job_started" | "job_completed" | "job_failed";
    document_id: string;
    source_url?: string;
    engine?: string;
    duration_s?: number;
    char_count?: number;
    error?: string;
    timestamp: number;
}
