import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { clearSessionCookie, createSessionCookie, readSessionTokenFromRequest, verifySessionToken } from "./backend/auth.mjs";
import {
  createPairingCodeForUser,
  disconnectUserStrava,
  env,
  exchangeCodeForUser,
  getContentType,
  getDashboardForUser,
  getSessionUser,
  joinPairingCodeForUser,
  loginUser,
  registerUser,
  saveGoalForUser,
  saveUserDisplayName,
  saveUserStravaAppCredentials,
} from "./backend/core.mjs";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const host = process.env.API_HOST ?? "0.0.0.0";
const webOrigin = process.env.APP_WEB_ORIGIN ?? "http://localhost:5173";
const allowedOrigins = new Set([webOrigin, "http://localhost:4173"]);

const server = http.createServer(async (request, response) => {
  try {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, { ok: true });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const body = await readJsonBody(request);
      const auth = await registerUser(body);
      response.setHeader("Set-Cookie", createSessionCookie(auth.token));
      return sendJson(response, 200, { user: auth.user });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJsonBody(request);
      const auth = await loginUser(body);
      response.setHeader("Set-Cookie", createSessionCookie(auth.token));
      return sendJson(response, 200, { user: auth.user });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      response.setHeader("Set-Cookie", clearSessionCookie());
      return sendJson(response, 200, { ok: true });
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = verifySessionToken(readSessionTokenFromRequest(request));
      const user = await getSessionUser(session);
      return sendJson(response, 200, { user });
    }

    const session = verifySessionToken(readSessionTokenFromRequest(request));
    const user = await getSessionUser(session);

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      return sendJson(response, 200, await getDashboardForUser(user.id, url.searchParams.get("date") ?? undefined));
    }

    if (url.pathname === "/api/goal" && request.method === "PUT") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      const body = await readJsonBody(request);
      return sendJson(response, 200, await saveGoalForUser(user.id, body?.goalKm));
    }

    if (url.pathname === "/api/nicknames" && request.method === "PUT") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      const body = await readJsonBody(request);
      return sendJson(response, 200, await saveUserDisplayName(user.id, body));
    }

    if (url.pathname === "/api/strava/apps" && request.method === "PUT") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      const body = await readJsonBody(request);
      return sendJson(response, 200, await saveUserStravaAppCredentials(user.id, body));
    }

    if (url.pathname === "/api/pairing/create" && request.method === "POST") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      return sendJson(response, 200, await createPairingCodeForUser(user.id));
    }

    if (url.pathname === "/api/pairing/join" && request.method === "POST") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      const body = await readJsonBody(request);
      return sendJson(response, 200, await joinPairingCodeForUser(user.id, body?.code));
    }

    if (url.pathname === "/api/strava/exchange" && request.method === "POST") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      const body = await readJsonBody(request);
      return sendJson(response, 200, await exchangeCodeForUser(user.id, body));
    }

    if (url.pathname === "/api/strava/disconnect" && request.method === "POST") {
      if (!user) {
        return sendJson(response, 401, { error: "Authentication required." });
      }
      return sendJson(response, 200, await disconnectUserStrava(user.id));
    }

    return serveApp(url.pathname, response);
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Love Running API listening on http://${host}:${port}`);
});

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }

  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function serveApp(pathname, response) {
  const targetPath = pathname === "/" || pathname === "/dashboard" ? "/index.html" : pathname;
  const absolutePath = path.join(env.distDir, targetPath);

  try {
    await access(absolutePath);
    response.writeHead(200, { "Content-Type": getContentType(absolutePath) });
    createReadStream(absolutePath).pipe(response);
    return;
  } catch {
    if (pathname.startsWith("/api/")) {
      return sendJson(response, 404, { error: "Not found" });
    }

    const indexPath = path.join(env.distDir, "index.html");

    try {
      await access(indexPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(indexPath).pipe(response);
      return;
    } catch {
      return sendJson(response, 404, {
        error: "App build not found. Run `npm run build` first.",
      });
    }
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
