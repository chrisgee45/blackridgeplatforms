import { objectStorageClient } from "./object-storage";
import { randomUUID } from "crypto";

function parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const parts = fullPath.replace(/^\//, "").split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

export async function captureScreenshot(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const buffer = await page.screenshot({ type: "png", fullPage: false });
    await browser.close();

    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateDir) {
      console.warn("No PRIVATE_OBJECT_DIR configured, skipping screenshot upload");
      return null;
    }

    const entityId = `screenshots/${randomUUID()}.png`;
    const fullPath = `${privateDir}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: "image/png" });

    return `/objects/${entityId}`;
  } catch (err: any) {
    console.warn(`Screenshot capture failed for ${url}: ${err.message}`);
    return null;
  }
}
