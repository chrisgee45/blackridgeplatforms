import { exec } from "child_process";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "./db";
import { backups } from "@shared/schema";
import { desc, sql } from "drizzle-orm";

const BACKUP_HOUR = 3;
const MAX_BACKUPS_KEPT = 30;
const S3_PREFIX = "backups";

// Catches typos like "us-east-2-an" (was breaking outbound DNS to S3).
// Accepts forms like us-east-2, eu-west-1, ap-southeast-3.
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/;

function normalizeRegion(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!AWS_REGION_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function getS3Client() {
  const region = normalizeRegion(process.env.AWS_S3_REGION);
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!region) {
    const raw = process.env.AWS_S3_REGION || "<unset>";
    throw new Error(`AWS_S3_REGION is invalid (got "${raw}"). Expected format like "us-east-2".`);
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS S3 credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)");
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) throw new Error("AWS_S3_BUCKET not configured");
  return bucket;
}

function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/postgres(ql)?:\/\/[^\s"']*/gi, "postgres://***")
    .replace(/password=[^\s&]*/gi, "password=***")
    .replace(/sslmode=[^\s&]*/gi, "")
    .replace(/AKIA[A-Z0-9]{16}/g, "AKIA***")
    .replace(/[A-Za-z0-9/+=]{40}/g, "***")
    .slice(0, 500);
}

function sanitizeDatabaseUrl(raw: string): string {
  // Strip whole-string whitespace and a trailing-space-in-path typo
  // like "postgres://host/postgres " that caused dumps to fail with
  // 'database "postgres " does not exist'.
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const cleanDbName = dbName.trim();
    if (cleanDbName !== dbName) {
      u.pathname = "/" + encodeURIComponent(cleanDbName);
      return u.toString();
    }
  } catch {
    // Not a parseable URL — leave it; pg_dump will surface the real error.
  }
  return trimmed;
}

function runPgDump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const rawUrl = process.env.DATABASE_URL || "";
    const dbUrl = sanitizeDatabaseUrl(rawUrl);
    if (!dbUrl) {
      reject(new Error("DATABASE_URL is not set"));
      return;
    }
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = exec(
      `set -o pipefail; pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists | gzip`,
      {
        maxBuffer: 100 * 1024 * 1024,
        timeout: 120000,
        env: { ...process.env, DATABASE_URL: dbUrl } as NodeJS.ProcessEnv,
        shell: "/bin/bash",
      },
    );
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("close", (code) => {
      if (code === 0) {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) {
          reject(new Error("pg_dump produced empty output"));
          return;
        }
        resolve(buf);
      } else {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        let detail = stderr ? `: ${stderr.slice(0, 400)}` : "";
        // Surface a clearer hint for the very common
        // "aborting because of server version mismatch" failure.
        if (/server version mismatch/i.test(stderr)) {
          detail += " — install a matching pg_dump (the server is newer than the client).";
        }
        if (/pg_dump: command not found|pg_dump:.*not found/i.test(stderr) || code === 127) {
          detail = `: pg_dump binary not found on the backup runner. Install postgresql-client matching the server version.`;
        }
        reject(new Error(`pg_dump exited ${code}${detail}`));
      }
    });
    child.on("error", (err) => reject(new Error(`pg_dump process error: ${err.message}`)));
  });
}

export async function performBackup(triggerType: "scheduled" | "manual" = "scheduled"): Promise<{ success: boolean; filename?: string; error?: string }> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `blackridge-backup-${timestamp}.sql.gz`;

  let recordId: string | null = null;

  try {
    const backupRecord = await db.insert(backups).values({
      filename,
      storagePath: "",
      status: "in_progress",
      triggerType,
      sizeBytes: 0,
    }).returning();
    recordId = backupRecord[0].id;
  } catch (insertErr: any) {
    console.error("Failed to create backup record:", sanitizeErrorMessage(insertErr.message));
    return { success: false, error: "Failed to initialize backup record" };
  }

  try {
    const dumpBuffer = await runPgDump();

    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const s3Key = `${S3_PREFIX}/${filename}`;

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: dumpBuffer,
      ContentType: "application/gzip",
      ServerSideEncryption: "AES256",
    }));

    const storagePath = `s3://${bucket}/${s3Key}`;
    const sizeBytes = dumpBuffer.length;

    await db.update(backups)
      .set({ status: "completed", storagePath, sizeBytes, completedAt: new Date() })
      .where(sql`id = ${recordId}`);

    console.log(`Backup completed: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB) → ${storagePath}`);

    await pruneOldBackups();

    return { success: true, filename };
  } catch (error: any) {
    const msg = sanitizeErrorMessage(error.message || "Unknown backup error");
    try {
      await db.update(backups)
        .set({ status: "failed", errorMessage: msg, completedAt: new Date() })
        .where(sql`id = ${recordId}`);
    } catch {}
    console.error(`Backup failed: ${msg}`);
    return { success: false, error: msg };
  }
}

async function pruneOldBackups() {
  try {
    const allBackups = await db.select().from(backups)
      .where(sql`${backups.status} = 'completed'`)
      .orderBy(desc(backups.createdAt));

    if (allBackups.length <= MAX_BACKUPS_KEPT) return;

    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const toDelete = allBackups.slice(MAX_BACKUPS_KEPT);

    for (const b of toDelete) {
      try {
        let storageDeleted = false;
        if (b.storagePath?.startsWith("s3://")) {
          const s3Key = b.storagePath.replace(`s3://${bucket}/`, "");
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
          storageDeleted = true;
        }
        if (storageDeleted || !b.storagePath?.startsWith("s3://")) {
          await db.delete(backups).where(sql`id = ${b.id}`);
        }
      } catch {
      }
    }
  } catch (error) {
    console.error("Error pruning old backups:", error);
  }
}

export async function getBackupHistory() {
  return db.select().from(backups).orderBy(desc(backups.createdAt)).limit(50);
}

export async function getBackupStats() {
  const allBackups = await db.select().from(backups)
    .where(sql`${backups.status} = 'completed'`)
    .orderBy(desc(backups.createdAt));

  const lastBackup = allBackups[0] || null;
  const totalBackups = allBackups.length;
  const totalSizeBytes = allBackups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);

  const failedRecent = await db.select().from(backups)
    .where(sql`${backups.status} = 'failed' AND ${backups.createdAt} > now() - interval '7 days'`);
  const recentFailures = failedRecent.length;

  const lastCompletedAgeHours = lastBackup
    ? (Date.now() - new Date(lastBackup.createdAt).getTime()) / 3600000
    : Infinity;

  // "Protected" only when we have a recent successful backup AND no failures
  // in the last 7 days. Any recent failure flips us to "At Risk" so the green
  // pill stops masking an actually-broken pipeline.
  let health: "protected" | "at_risk" | "critical" | "unknown";
  let healthReason: string;
  if (!lastBackup) {
    health = "critical";
    healthReason = "No successful backups on record";
  } else if (lastCompletedAgeHours > 48) {
    health = "critical";
    healthReason = `Last successful backup was ${Math.floor(lastCompletedAgeHours / 24)}d ago`;
  } else if (recentFailures > 0) {
    health = "at_risk";
    healthReason = `${recentFailures} backup failure${recentFailures === 1 ? "" : "s"} in the last 7 days`;
  } else if (lastCompletedAgeHours > 25) {
    health = "at_risk";
    healthReason = "Last successful backup is more than 25 hours old";
  } else {
    health = "protected";
    healthReason = "Recent backups completed successfully";
  }

  return {
    lastBackup: lastBackup ? {
      filename: lastBackup.filename,
      createdAt: lastBackup.createdAt,
      sizeBytes: lastBackup.sizeBytes,
    } : null,
    totalBackups,
    totalSizeBytes,
    recentFailures,
    maxBackups: MAX_BACKUPS_KEPT,
    health,
    healthReason,
  };
}

export function startDailyBackupScheduler() {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(BACKUP_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();

    console.log(`Daily backup scheduled for ${next.toISOString()} (in ${(delay / 3600000).toFixed(1)}h)`);

    setTimeout(() => {
      console.log("Starting scheduled daily backup to AWS S3...");
      performBackup("scheduled")
        .catch((err) => console.error("Scheduled backup error:", sanitizeErrorMessage(err.message)))
        .finally(() => scheduleNext());
    }, delay);
  }

  scheduleNext();
}
