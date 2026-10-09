import { S3Client } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

/**
 * The S3 bucket name. Matches AWS_BUCKET_NAME in .env.
 */
export const S3_BUCKET = process.env.AWS_BUCKET_NAME ?? "";

/**
 * The root folder (S3 key prefix) every uploaded document lives under.
 * Configured via `S3_FOLDER_ROOT`, defaulting to "lgwebscraper". Read lazily so
 * it reflects the environment after dotenv has loaded.
 */
export function getS3RootFolder(): string {
    return (process.env.S3_FOLDER_ROOT || "lgwebscraper").replace(/^\/+|\/+$/g, "");
}

/**
 * Returns a shared S3Client instance, initialised from environment variables.
 *
 * Environment variables (all defined in .env / .env.example):
 *   AWS_REGION           – e.g. "us-east-1"
 *   AWS_ENDPOINT         – Custom endpoint URL (optional). Required for non-AWS
 *                          S3-compatible services (MinIO, Localstack, etc.).
 *                          Leave blank to use the standard AWS endpoint.
 *   AWS_ACCESS_KEY_ID    – IAM access key or S3-compatible equivalent.
 *   AWS_SECRET_ACCESS_KEY – Corresponding secret.
 *   AWS_FORCE_PATH_STYLE – Set to "true" only when using MinIO / Localstack.
 *                          AWS S3 and Cloudflare R2 use virtual-hosted style (false).
 *   AWS_BUCKET_NAME      – Name of the bucket to upload files into.
 *
 * The client is created once and reused for every upload within a process.
 */
export function getS3Client(): S3Client {
    if (!s3Client) {
        const region = process.env.AWS_REGION ?? "us-east-1";
        const endpoint = process.env.AWS_ENDPOINT || undefined;
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
        const forcePathStyle = process.env.AWS_FORCE_PATH_STYLE === "true";

        s3Client = new S3Client({
            region,
            ...(endpoint ? { endpoint } : {}),
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
            forcePathStyle,
        });
    }
    return s3Client;
}

/**
 * Constructs a normalized, reliable public URL for an S3 object key based on
 * the current environment configuration.
 *
 * Handles:
 * - Custom CDN / public domain (S3_PUBLIC_URL_PREFIX or AWS_PUBLIC_URL)
 * - Custom S3 endpoints (MinIO, Localstack, Cloudflare R2) with virtual-hosted or path-style
 * - Standard AWS S3 regions (us-east-1, ap-south-1, etc.)
 * - URI encoding of filename characters (spaces, unicode/Nepali characters, special chars)
 */
export function getS3PublicUrl(s3Key: string): string {
    const cleanKey = s3Key.replace(/^\/+/, "");
    // URI-encode path segments so spaces, Nepali script, and symbols produce a valid URL
    const encodedKey = cleanKey
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");

    const publicPrefix = process.env.S3_PUBLIC_URL_PREFIX?.replace(/\/+$/, "");
    if (publicPrefix) {
        return `${publicPrefix}/${encodedKey}`;
    }

    const bucket = S3_BUCKET;
    const region = process.env.AWS_REGION ?? "us-east-1";
    const endpoint = process.env.AWS_ENDPOINT?.replace(/\/+$/, "");
    const forcePathStyle = process.env.AWS_FORCE_PATH_STYLE === "true";

    // 2. Custom S3-compatible endpoint (MinIO, Localstack, R2, etc.)
    if (endpoint) {
        if (forcePathStyle) {
            return `${endpoint}/${bucket}/${encodedKey}`;
        }
        try {
            const parsed = new URL(endpoint);
            parsed.hostname = `${bucket}.${parsed.hostname}`;
            return `${parsed.origin}/${encodedKey}`;
        } catch {
            return `${endpoint}/${bucket}/${encodedKey}`;
        }
    }

    // 3. Standard AWS S3 virtual-hosted URL
    if (region === "us-east-1") {
        return `https://${bucket}.s3.amazonaws.com/${encodedKey}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}
