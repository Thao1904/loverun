import { sendJson } from "./_shared.js";

export default async function handler(_request, response) {
  return sendJson(response, 200, { ok: true });
}
