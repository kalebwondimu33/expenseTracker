const { connectDb, databaseName } = require("../../server/db");
const {
  getData,
  createEarning,
  deleteEarning,
  createExpense,
  deleteExpense,
  saveSettings,
  importData,
} = require("../../server/store");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function apiPath(event) {
  let path = event.path || event.rawPath || "/";
  if (path.startsWith("/.netlify/functions/api")) {
    path = `/api${path.slice("/.netlify/functions/api".length)}`;
  }
  if (!path.startsWith("/api")) {
    path = `/api${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path.replace(/\/+$/, "") || "/api";
}

function parseBody(event) {
  if (event.body == null || event.body === "") return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const method = (
    event.httpMethod ||
    event.requestContext?.http?.method ||
    "GET"
  ).toUpperCase();
  const path = apiPath(event);

  if (path === "/api/health" && method === "GET") {
    try {
      await connectDb();
      return json(200, { connected: true, database: databaseName(), error: "" });
    } catch (error) {
      return json(200, {
        connected: false,
        database: "",
        error: error.message || "MongoDB Atlas is not configured yet.",
      });
    }
  }

  try {
    await connectDb();
    const body = parseBody(event);
    if (path === "/api/data" && method === "GET") {
      return json(200, await getData());
    }
    if (path === "/api/earnings" && method === "POST") {
      await createEarning(body);
      return json(201, { ok: true });
    }
    if (path === "/api/expenses" && method === "POST") {
      await createExpense(body);
      return json(201, { ok: true });
    }
    if (path === "/api/settings" && method === "PUT") {
      return json(200, await saveSettings(body));
    }
    if (path === "/api/import" && method === "POST") {
      await importData(body);
      return json(200, { ok: true });
    }

    const earningMatch = path.match(/^\/api\/earnings\/([^/]+)$/);
    if (earningMatch && method === "DELETE") {
      await deleteEarning(decodeURIComponent(earningMatch[1]));
      return json(200, { ok: true });
    }

    const expenseMatch = path.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch && method === "DELETE") {
      await deleteExpense(decodeURIComponent(expenseMatch[1]));
      return json(200, { ok: true });
    }

    return json(404, { error: `Not found: ${method} ${path}` });
  } catch (error) {
    return json(error.status || 500, {
      connected: false,
      error: error.message || "Request failed.",
    });
  }
};
