import { exec } from "child_process";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "./db";
import { backups } from "@shared/schema";
import { desc, sql } from "drizzle-orm";

const BACKUP_HOUR = 3;
const MAX_BACKUPS_KEPT = 30;
const S3_PREFIX = "backups";

function getS3Client() {
  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("AWS S3 credentials not configured (AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)");
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
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

function runPgDump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = exec(
      `pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists | gzip`,
      { maxBuffer: 100 * 1024 * 1024, timeout: 120000, env: process.env as NodeJS.ProcessEnv },
    );
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error("Database dump failed"));
    });
    child.on("error", () => reject(new Error("Database dump process error")));
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

  return {
    lastBackup: lastBackup ? {
      filename: lastBackup.filename,
      createdAt: lastBackup.createdAt,
      sizeBytes: lastBackup.sizeBytes,
    } : null,
    totalBackups,
    totalSizeBytes,
    recentFailures: failedRecent.length,
    maxBackups: MAX_BACKUPS_KEPT,
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
