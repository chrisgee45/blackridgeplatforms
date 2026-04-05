/**
 * Local-disk object storage, a drop-in replacement for the old
 * Replit/Google Cloud Storage client used throughout the codebase.
 *
 * This preserves the surface the rest of the app relies on:
 *   - objectStorageClient.bucket(name).file(path).save(buffer, { contentType })
 *   - new ObjectStorageService().getPrivateObjectDir()
 *   - registerObjectStorageRoutes(app) serving /objects/:path(*)
 *   - ObjectNotFoundError
 *
 * Files are written under `<STORAGE_ROOT>/<bucketName>/<path>` with a sidecar
 * `.meta.json` for contentType so downloads can set the right header.
 *
 * Configuration (env):
 *   STORAGE_ROOT           base directory for all buckets (default: ./storage)
 *   PRIVATE_OBJECT_DIR     logical "/<bucket>/<prefix>" used for private uploads
 *                          (e.g. "/blackridge/private")
 *   PUBLIC_OBJECT_SEARCH_PATHS
 *                          comma-separated list of "/<bucket>/<prefix>" for
 *                          public lookups (optional)
 *
 * Swap this for S3/GCS later by re-implementing the same exported surface.
 */
import type { Express, Response } from "express";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "./storage");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function resolveFsPath(bucketName: string, objectName: string): string {
  const safeBucket = bucketName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeObject = objectName.replace(/\.\.(\/|\\|$)/g, "");
  return path.join(STORAGE_ROOT, safeBucket, safeObject);
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

class LocalFile {
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
      // no sidecar — best-effort
    }
    return [{ contentType, size: stat.size }];
  }

  createReadStream() {
    return createReadStream(this.fsPath);
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

export const objectStorageClient = new LocalStorageClient();

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
   * Generates a new opaque object path for a direct upload. In this local
   * implementation we don't do presigned URLs — the caller uploads via the
   * POST /api/uploads endpoint below.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    // The "URL" we return is actually a relative API path the client POSTs to.
    return `/api/uploads/${encodeURIComponent(privateDir)}/${objectId}`;
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
   * to a LocalFile handle, throwing ObjectNotFoundError if absent.
   */
  async getObjectEntityFile(requestPath: string): Promise<LocalFile> {
    if (!requestPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const logical = requestPath.replace(/^\/objects/, "");
    const { bucketName, objectName } = parseLogicalPath(logical);
    const file = new LocalBucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async downloadObject(file: LocalFile, res: Response, cacheTtlSec = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size),
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      });
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
    }
  }
}

/**
 * Register object-storage HTTP routes:
 *   POST /api/uploads/request-url   — allocate a path the client will PUT/POST to
 *   PUT  /api/uploads/:dir/:id      — receive raw body bytes, store on disk
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
      const [, privateDirEncoded, objectId] = req.path.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/)!;
      const privateDir = decodeURIComponent(privateDirEncoded);
      const logical = `${privateDir}/${objectId}`;
      const { bucketName, objectName } = parseLogicalPath(logical);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const buf = Buffer.concat(chunks);
        await new LocalBucket(bucketName).file(objectName).save(buf, {
          contentType: String(req.headers["content-type"] || "application/octet-stream"),
        });
        res.status(200).json({ ok: true, path: `/objects${logical}` });
      });
      req.on("error", (err) => {
        console.error("Upload error:", err);
        res.status(500).json({ error: "Upload failed" });
      });
    } catch (error) {
      console.error("Error handling upload:", error);
      res.status(500).json({ error: "Failed to handle upload" });
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
}
