import { getDashboard } from "../backend/core.mjs";
import { sendJson } from "./_shared.js";

export default async function handler(request, response) {
  try {
    const date = typeof request.query?.date === "string" ? request.query.date : undefined;
    return sendJson(response, 200, await getDashboard(date));
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
}
