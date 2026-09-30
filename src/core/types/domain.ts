export interface MunicipalityData {
    code: string;
    nameNe: string;
    nameEn: string;
    province: string;
    district: string;
}

export interface MunicipalityProfileData {
    municipalityCode: string;
    establishedBs?: string | null;
    totalWards?: number | null;
    population?: number | null;
    areaSqKm?: number | null;
    includedVdcsNe?: string | null;
    email?: string | null;
    website?: string | null;
    facebookPage?: string | null;
    mobileNo?: string | null;
    twitterHandle?: string | null;
    totalSchools?: number | null;
}

/** Possible states for a document download attempt. */
export type DownloadStatus = "pending" | "ok" | "failed" | "skipped";

/**
 * Possible states for a document's OCR pass.
 *
 * "queued" is set by the producer when it claims the document and cleared by the
 * worker when it picks the job up, which is what keeps a document from being
 * queued twice.
 */
export type OcrStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "skipped";

export interface DocumentData {
    fileName: string;
    fileType?: string | null;
    originalUrl: string;
    storagePath?: string | null;
    /** "ok" when a file was saved, "failed" with downloadError when it errored, "skipped" when the run did not fetch the attachment */
    downloadStatus: DownloadStatus;
    /** Human-readable error message when downloadStatus is "failed" */
    downloadError?: string | null;
    ocrData?: string | null;
    ocrStatus?: OcrStatus;
    ocrError?: string | null;
    ocrEngine?: string | null;
    ocrCompletedAt?: Date | null;
}

export interface PolicyEntityData {
    municipalityCode: string;
    category: string; // 'notice', 'project', 'report', etc.
    titleNe: string;
    titleEn?: string | null;
    contentNe?: string | null;
    contentEn?: string | null;
    type?: string | null;
    fiscalYear?: string | null;
    budgetAmount?: number | null;
    status?: string | null;
    wardNo?: number | null;
    publishedDate?: string | null;
    sourceUrl: string;
    documents?: DocumentData[];
    metadata?: any;
}

export interface EtlPayload {
    municipality: MunicipalityData;
    profile?: MunicipalityProfileData;
    policyEntities?: PolicyEntityData[];
}
