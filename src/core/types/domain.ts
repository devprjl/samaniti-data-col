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

export interface DocumentData {
    fileName: string;
    fileType?: string | null;
    originalUrl: string;
    storagePath?: string | null;
    /** "ok" when file saved, "failed" with downloadError when it errored, "skipped" when SKIP_FILE_DOWNLOADS=true */
    downloadStatus: DownloadStatus;
    /** Human-readable error message when downloadStatus is "failed" */
    downloadError?: string | null;
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
