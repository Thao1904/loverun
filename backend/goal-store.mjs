import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { readStoredJson, writeStoredJson } from "./storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const appStateFile = path.resolve(
  rootDir,
  process.env.APP_STATE_STORAGE_PATH ?? "./data/app-state.json",
);
const appStateBlobPath = process.env.APP_STATE_BLOB_PATH ?? "love-running/app-state.json";

const defaultGoalKm = Number(process.env.DEFAULT_SHARED_GOAL_KM ?? 18);
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
const goalRange = process.env.GOOGLE_SHEETS_GOAL_RANGE ?? "Settings!B2";
const updatedAtRange = process.env.GOOGLE_SHEETS_UPDATED_AT_RANGE ?? "Settings!B3";

export async function readGoalState() {
  if (isGoogleSheetsConfigured()) {
    try {
      const sheets = await getSheetsClient();
      const [goalResponse, updatedAtResponse] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: goalRange,
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: updatedAtRange,
        }),
      ]);

      const rawGoal = goalResponse.data.values?.[0]?.[0];
      const rawUpdatedAt = updatedAtResponse.data.values?.[0]?.[0] ?? null;
      const numericGoal = Number(rawGoal);

      return {
        goalKm: Number.isFinite(numericGoal) && numericGoal > 0 ? numericGoal : defaultGoalKm,
        updatedAt: typeof rawUpdatedAt === "string" ? rawUpdatedAt : null,
      };
    } catch (error) {
      console.warn("Falling back from Google Sheets goal storage:", error);
    }
  }

  return readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {
      goalKm: defaultGoalKm,
      updatedAt: null,
    },
  });
}

export async function writeGoalState(value) {
  if (isGoogleSheetsConfigured()) {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: goalRange,
            values: [[String(value.goalKm)]],
          },
          {
            range: updatedAtRange,
            values: [[value.updatedAt ?? ""]],
          },
        ],
      },
    });

    return;
  }

  return writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value,
  });
}

function isGoogleSheetsConfigured() {
  return Boolean(
    spreadsheetId &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY ?? ""),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}
