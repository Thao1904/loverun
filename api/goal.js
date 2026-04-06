import { saveGoal } from "../backend/core.mjs";
import { readBody, sendJson } from "./_shared.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "PUT") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    const body = await readBody(request);
    return sendJson(response, 200, await saveGoal(body?.goalKm));
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
}
