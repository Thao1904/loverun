import { head, put } from "@vercel/blob";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const useBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function readStoredJson({ blobPath, filePath, fallback }) {
  if (useBlobStorage) {
    try {
      const blob = await head(blobPath);
      const downloadResponse = await fetch(blob.downloadUrl);

      if (!downloadResponse.ok) {
        return fallback;
      }

      const content = await downloadResponse.text();
      return JSON.parse(content);
    } catch {
      return fallback;
    }
  }

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

export async function writeStoredJson({ blobPath, filePath, value }) {
  if (useBlobStorage) {
    await put(blobPath, JSON.stringify(value, null, 2), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    });
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
