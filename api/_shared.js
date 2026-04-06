export function sendJson(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}

export async function readBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  return {};
}
