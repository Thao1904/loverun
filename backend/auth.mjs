import crypto from "node:crypto";

const encoder = new TextEncoder();
const jwtSecret = process.env.JWT_SECRET ?? "love-running-dev-secret";
const jwtIssuer = "love-running";
const sessionCookieName = "love_running_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
const isSecureCookie = (process.env.APP_WEB_ORIGIN ?? "").startsWith("https://");

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return {
    salt,
    hash,
  };
}

export function verifyPassword(password, salt, expectedHash) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");

  if (candidate.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidate, expected);
}

export function createSessionToken(user) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: jwtIssuer,
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds,
    }),
  );
  const signature = signToken(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  const [header, payload, signature] = token.split(".");

  if (!header || !payload || !signature) {
    return null;
  }

  const expectedSignature = signToken(`${header}.${payload}`);

  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));

    if (decoded.iss !== jwtIssuer || Number(decoded.exp ?? 0) < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function createSessionCookie(token) {
  return serializeCookie(sessionCookieName, token, sessionMaxAgeSeconds);
}

export function clearSessionCookie() {
  return serializeCookie(sessionCookieName, "", 0);
}

export function readSessionTokenFromRequest(request) {
  const raw = request.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );

  return cookies[sessionCookieName] ?? null;
}

function serializeCookie(name, value, maxAge) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  if (isSecureCookie) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function signToken(value) {
  return base64UrlEncode(
    crypto.createHmac("sha256", encoder.encode(jwtSecret)).update(value).digest(),
  );
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
