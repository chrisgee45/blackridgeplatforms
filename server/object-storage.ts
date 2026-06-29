/**
 * Object storage with two interchangeable backends:
 *
 *   - **S3**     (production) — chosen when AWS_S3_BUCKET (or the override
 *                  AWS_S3_DOCUMENTS_BUCKET) and AWS region/keys are set.
 *                  Survives container restarts; this is the "documents
 *                  cannot be lost" requirement.
 *   - **local**  (dev) — falls back to disk under STORAGE_ROOT when no
 *                  S3 bucket is configured.
 *
 * The surface the rest of the app consumes is identical in either mode:
 *
 *   objectStorageClient.bucket(name).file(path).save(buffer, { contentType })
 *   new ObjectStorageService().getPrivateObjectDir()
 *   service.getObjectEntityUploadURL()
 *   service.normalizeObjectEntityPath(rawPath)
 *   service.getObjectEntityFile(requestPath)        // throws ObjectNotFoundError
 *   service.downloadObject(file, res, cacheTtlSec?)
 *   registerObjectStorageRoutes(app)                // /api/uploads/* + /objects/*
 *
 * Environment:
 *   AWS_S3_DOCUMENTS_BUCKET  S3 bucket for app uploads. Falls back to
 *                            AWS_S3_BUCKET (the same one used for backups)
 *                            when not set. Different prefixes keep
 *                            backups/ and the document tree separated.
 *   AWS_S3_REGION            e.g. "us-east-2"
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   PRIVATE_OBJECT_DIR       Logical path prefix used for private uploads
 *                            (e.g. "/blackridge/private"). Translates to
 *                            an S3 key prefix in S3 mode and a directory
 *                            tree under STORAGE_ROOT locally.
 *   PUBLIC_OBJECT_SEARCH_PATHS
 *                            Comma-separated logical paths consulted for
 *                            public lookups (optional).
 *   STORAGE_ROOT             Local-only — base dir for buckets when S3
 *                            isn't configured (default: ./storage).
 */
import type { Express, Response } from "express";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "./storage");

const S3_DOC_BUCKET = (process.env.AWS_S3_DOCUMENTS_BUCKET || process.env.AWS_S3_BUCKET || "").trim();
const S3_REGION = (process.env.AWS_S3_REGION || "").trim();
const S3_ACCESS_KEY = (process.env.AWS_ACCESS_KEY_ID || "").trim();
const S3_SECRET_KEY = (process.env.AWS_SECRET_ACCESS_KEY || "").trim();
const USE_S3 = !!(S3_DOC_BUCKET && S3_REGION && S3_ACCESS_KEY && S3_SECRET_KEY);

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: S3_REGION,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    });
  }
  return s3Client;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function resolveFsPath(bucketName: string, objectName: string): string {
  const safeBucket = bucketName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeObject = objectName.replace(/\.\.(\/|\\|$)/g, "");
  return path.join(STORAGE_ROOT, safeBucket, safeObject);
}

function toS3Key(bucketName: string, objectName: string): string {
  // The "bucketName" from the logical hierarchy becomes a prefix inside
  // the single real S3 bucket. Strip any leading slashes that could land
  // an object at "//path".
  const safeObject = objectName.replace(/^\/+/, "");
  return `${bucketName}/${safeObject}`;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

interface SaveOptions {
  contentType?: string;
}

/** Behavioral surface every file backend must provide. */
interface StorageFile {
  name: string;
  save(data: Buffer, options?: SaveOptions): Promise<void>;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[{ contentType?: string; size: number }]>;
  download(res: Response, cacheTtlSec?: number): Promise<void>;
  readBuffer(): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Local disk implementation (dev fallback)
// ---------------------------------------------------------------------------

class LocalFile implements StorageFile {
  constructor(private bucketName: string, public name: string) {}

  private get fsPath(): string {
    return resolveFsPath(this.bucketName, this.name);
  }

  private get metaPath(): string {
    return this.fsPath + ".meta.json";
  }

  async save(data: Buffer, options: SaveOptions = {}): Promise<void> {
    const full = this.fsPath;
    await ensureDir(path.dirname(full));
    await fs.writeFile(full, data);
    if (options.contentType) {
      await fs.writeFile(
        this.metaPath,
        JSON.stringify({ contentType: options.contentType, size: data.length }),
      );
    }
  }

  async exists(): Promise<[boolean]> {
    try {
      await fs.access(this.fsPath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size: number }]> {
    const stat = await fs.stat(this.fsPath);
    let contentType: string | undefined;
    try {
      const raw = await fs.readFile(this.metaPath, "utf8");
      contentType = JSON.parse(raw).contentType;
    } catch {
      /* no sidecar — best-effort */
    }
    return [{ contentType, size: stat.size }];
  }

  async readBuffer(): Promise<Buffer> {
    return fs.readFile(this.fsPath);
  }

  async download(res: Response, cacheTtlSec = 3600): Promise<void> {
    const [metadata] = await this.getMetadata();
    res.set({
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Content-Length": String(metadata.size),
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    });
    const stream = createReadStream(this.fsPath);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
    });
    stream.pipe(res);
  }
}

class LocalBucket {
  constructor(private bucketName: string) {}
  file(objectName: string): LocalFile {
    return new LocalFile(this.bucketName, objectName);
  }
}

class LocalStorageClient {
  bucket(bucketName: string): LocalBucket {
    return new LocalBucket(bucketName);
  }
}

// ---------------------------------------------------------------------------
// S3 implementation (production)
// ---------------------------------------------------------------------------

function isS3NotFound(err: any): boolean {
  return (
    err?.name === "NotFound" ||
    err?.Code === "NoSuchKey" ||
    err?.$metadata?.httpStatusCode === 404
  );
}

class S3File implements StorageFile {
  constructor(private bucketName: string, public name: string) {}

  private get key(): string {
    return toS3Key(this.bucketName, this.name);
  }

  async save(data: Buffer, options: SaveOptions = {}): Promise<void> {
    await getS3().send(new PutObjectCommand({
      Bucket: S3_DOC_BUCKET,
      Key: this.key,
      Body: data,
      ContentType: options.contentType || "application/octet-stream",
      ServerSideEncryption: "AES256",
    }));
  }

  async exists(): Promise<[boolean]> {
    try {
      await getS3().send(new HeadObjectCommand({ Bucket: S3_DOC_BUCKET, Key: this.key }));
      return [true];
    } catch (err: any) {
      if (isS3NotFound(err)) return [false];
      throw err;
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size: number }]> {
    const head = await getS3().send(new HeadObjectCommand({ Bucket: S3_DOC_BUCKET, Key: this.key }));
    return [{ contentType: head.ContentType, size: head.ContentLength ?? 0 }];
  }

  async readBuffer(): Promise<Buffer> {
    const result = await getS3().send(new GetObjectCommand({ Bucket: S3_DOC_BUCKET, Key: this.key }));
    const body = result.Body as Readable | undefined;
    if (!body) throw new ObjectNotFoundError();
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async download(res: Response, cacheTtlSec = 3600): Promise<void> {
    const result = await getS3().send(new GetObjectCommand({ Bucket: S3_DOC_BUCKET, Key: this.key }));
    const headers: Record<string, string> = {
      "Content-Type": result.ContentType || "application/octet-stream",
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (typeof result.ContentLength === "number") {
      headers["Content-Length"] = String(result.ContentLength);
    }
    res.set(headers);

    const body = result.Body;
    if (!body) {
      if (!res.headersSent) res.status(500).json({ error: "Empty S3 response body" });
      return;
    }
    // AWS SDK v3 returns a Node Readable on Node runtimes.
    const stream = body as Readable;
    stream.on("error", (err) => {
      console.error("S3 stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
    });
    stream.pipe(res);
  }
}

class S3Bucket {
  constructor(private bucketName: string) {}
  file(objectName: string): S3File {
    return new S3File(this.bucketName, objectName);
  }
}

class S3StorageClient {
  bucket(bucketName: string): S3Bucket {
    return new S3Bucket(bucketName);
  }
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export const objectStorageClient: { bucket: (n: string) => { file: (o: string) => StorageFile } } =
  USE_S3 ? new S3StorageClient() : new LocalStorageClient();

function parseLogicalPath(logical: string): { bucketName: string; objectName: string } {
  const cleaned = logical.replace(/^\/+/, "");
  const parts = cleaned.split("/");
  if (parts.length < 1 || !parts[0]) {
    throw new Error(`Invalid storage path: ${logical}`);
  }
  return {
    bucketName: parts[0],
    objectName: parts.slice(1).join("/"),
  };
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR;
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR is not set. Set it to a logical path like '/blackridge/private'.",
      );
    }
    return dir;
  }

  getPublicObjectSearchPaths(): string[] {
    const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    return Array.from(
      new Set(
        raw
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
  }

  /**
   * Allocate a new opaque object path the client will PUT to.
   *
   * In both S3 and local modes the client uploads through our server (the
   * PUT route below). We could swap this for S3 presigned URLs later — but
   * presigned uploads require browser-CORS on the S3 bucket. Server-relay
   * works out of the box with zero S3 config beyond what backups already
   * needs.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    return `/api/uploads/${encodeURIComponent(privateDir)}/${objectId}`;
  }

  /**
   * Write a buffer directly to storage server-side and return the
   * /objects/... path that the rest of the app uses as storageKey.
   * Used for files that arrive on the server (Jake inbound email
   * attachments, etc.) instead of via the browser uploader.
   */
  async saveBuffer(buffer: Buffer, contentType: string): Promise<{ storageKey: string }> {
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const logical = `${privateDir}/${objectId}`;
    const { bucketName, objectName } = parseLogicalPath(logical);
    await objectStorageClient.bucket(bucketName).file(objectName).save(buffer, { contentType });
    return { storageKey: `/objects${logical}`.replace(/\/+/g, "/") };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("/api/uploads/")) return rawPath;
    const encoded = rawPath.replace("/api/uploads/", "");
    const [privateDirEncoded, objectId] = encoded.split("/");
    const privateDir = decodeURIComponent(privateDirEncoded || "").replace(/\/$/, "");
    return `/objects${privateDir}/${objectId}`.replace(/\/+/g, "/");
  }

  /**
   * Resolve a request path like "/objects/blackridge/private/uploads/abc"
   * to a file handle. Throws ObjectNotFoundError if absent.
   */
  async getObjectEntityFile(requestPath: string): Promise<StorageFile> {
    if (!requestPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const logical = requestPath.replace(/^\/objects/, "");
    const { bucketName, objectName } = parseLogicalPath(logical);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  /**
   * Read a stored object fully into memory. Used when the bytes need to
   * travel somewhere other than an HTTP response — e.g. attaching an
   * uploaded proposal file to an outgoing email. Throws
   * ObjectNotFoundError if the object is absent.
   */
  async readObjectBuffer(requestPath: string): Promise<Buffer> {
    const file = await this.getObjectEntityFile(requestPath);
    return file.readBuffer();
  }

  async downloadObject(file: StorageFile, res: Response, cacheTtlSec = 3600) {
    try {
      await file.download(res, cacheTtlSec);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
    }
  }
}

/**
 * HTTP routes:
 *   POST /api/uploads/request-url   — allocate a path the client will PUT to
 *   PUT  /api/uploads/:dir/:id      — receive raw body bytes, persist them
 *   GET  /objects/<path>            — stream a stored object back
 */
export function registerObjectStorageRoutes(app: Express): void {
  const service = new ObjectStorageService();

  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body || {};
      if (!name) return res.status(400).json({ error: "Missing required field: name" });
      const uploadURL = await service.getObjectEntityUploadURL();
      const objectPath = service.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.put(/^\/api\/uploads\/([^/]+)\/([^/]+)$/, async (req, res) => {
    try {
      const match = req.path.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/)!;
      const privateDirEncoded = match[1];
      const objectId = match[2];
      const privateDir = decodeURIComponent(privateDirEncoded);
      const logical = `${privateDir}/${objectId}`;
      const { bucketName, objectName } = parseLogicalPath(logical);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        try {
          const buf = Buffer.concat(chunks);
          await objectStorageClient.bucket(bucketName).file(objectName).save(buf, {
            contentType: String(req.headers["content-type"] || "application/octet-stream"),
          });
          res.status(200).json({ ok: true, path: `/objects${logical}` });
        } catch (err: any) {
          console.error("Upload save error:", err);
          if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
        }
      });
      req.on("error", (err) => {
        console.error("Upload error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
      });
    } catch (error) {
      console.error("Error handling upload:", error);
      if (!res.headersSent) res.status(500).json({ error: "Failed to handle upload" });
    }
  });

  app.get(/^\/objects\/(.+)$/, async (req, res) => {
    try {
      const file = await service.getObjectEntityFile(req.path);
      await service.downloadObject(file, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      console.error("Error serving object:", error);
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  console.log(`Object storage backend: ${USE_S3 ? `S3 (${S3_DOC_BUCKET}, ${S3_REGION})` : `local (${STORAGE_ROOT})`}`);
}
