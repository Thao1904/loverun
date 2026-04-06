import { createPairingCode } from "../../backend/core.mjs";
import { sendJson } from "../_shared.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    return sendJson(response, 200, await createPairingCode());
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
}
