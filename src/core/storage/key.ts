import { getS3RootFolder } from "./config.js";

/**
 * Converts a path segment into a URL-safe slug.
 *
 * Municipality codes are single words ("LAKSHMINIYA") while categories may be
 * several words joined by underscores ("annual_progress_report"). Every run of
 * non-alphanumeric characters -- including underscores -- collapses into a
 * single hyphen, so the same value always produces the same folder.
 */
function toSlugSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Builds the S3 object key (the path a document is stored at):
 *
 *   <S3_FOLDER_ROOT>/<municipality>/<category>/<fileName>
 *
 * The root folder is read from the environment (S3_FOLDER_ROOT); the municipality
 * and category segments are slugified and omitted when empty. The file name is
 * kept as-is and URI-encoded later by getS3PublicUrl.
 */
export function buildS3Key(
    municipality: string,
    category: string | null | undefined,
    fileName: string,
): string {
    const segments = [
        getS3RootFolder(),
        toSlugSegment(municipality),
        category ? toSlugSegment(category) : "",
    ].filter((segment) => segment.length > 0);
    return [...segments, fileName.replace(/^\/+/, "")].join("/");
}
