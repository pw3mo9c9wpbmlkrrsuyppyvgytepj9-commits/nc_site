const { MiniDatabase } = require("./engine");

function isValidCollectionName(value) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(String(value || ""));
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (value !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

function parseFilter(queryFilter) {
  if (!queryFilter || typeof queryFilter !== "object" || Array.isArray(queryFilter)) {
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(queryFilter)) {
    if (!key) {
      continue;
    }
    out[key] = typeof value === "string" ? parseScalar(value) : value;
  }
  return out;
}

function parseSort(sortRaw) {
  if (!sortRaw || typeof sortRaw !== "string") {
    return null;
  }
  const value = sortRaw.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("-")) {
    return { field: value.slice(1), direction: "desc" };
  }
  const [fieldPart, dirPart] = value.split(":");
  const field = String(fieldPart || "").trim();
  if (!field) {
    return null;
  }
  const direction = String(dirPart || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  return { field, direction };
}

function isValidContainerName(value) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(String(value || ""));
}

function normalizeKeys(apiKeys) {
  if (!Array.isArray(apiKeys)) {
    return [];
  }
  return apiKeys
    .filter((item) => item && typeof item === "object" && item.key)
    .map((item) => ({
      name: String(item.name || "unnamed-key"),
      key: String(item.key),
      containers: Array.isArray(item.containers) ? item.containers.map((c) => String(c)) : [],
    }));
}

function createPublicDatabaseRouter(express, options = {}) {
  const router = express.Router();
  const miniDb = new MiniDatabase();
  const requireApiKey = options.requireApiKey !== false;
  const apiKeys = normalizeKeys(options.apiKeys);
  const keyMap = new Map(apiKeys.map((entry) => [entry.key, entry]));

  router.use((req, res, next) => {
    const authHeader = String(req.get("authorization") || "");
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const apiKey = bearer || String(req.get("x-api-key") || req.query.apiKey || "").trim();
    const containerRaw = String(req.get("x-db-container") || req.query.container || "default").trim();

    if (!isValidContainerName(containerRaw)) {
      return res.status(400).json({ ok: false, error: "invalid_container" });
    }

    if (!requireApiKey) {
      req.dbContext = { container: containerRaw, keyName: "public" };
      return next();
    }

    if (!apiKey) {
      return res.status(401).json({ ok: false, error: "missing_api_key" });
    }
    const keyEntry = keyMap.get(apiKey);
    if (!keyEntry) {
      return res.status(403).json({ ok: false, error: "invalid_api_key" });
    }
    const allowed = new Set(keyEntry.containers);
    if (!allowed.has("*") && !allowed.has(containerRaw)) {
      return res.status(403).json({ ok: false, error: "container_not_allowed" });
    }

    req.dbContext = {
      container: containerRaw,
      keyName: keyEntry.name,
    };
    return next();
  });

  router.get("/_whoami", (req, res) => {
    const { container, keyName } = req.dbContext;
    return res.json({
      ok: true,
      auth: {
        keyName,
        container,
      },
    });
  });

  router.get("/", (req, res) => {
    const { container, keyName } = req.dbContext;
    return res.json({
      ok: true,
      engine: "mini-db-v2",
      container,
      keyName,
      collections: miniDb.listCollections(container),
    });
  });

  router.post("/_collections/:collection", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    const created = miniDb.createCollection(container, collection);
    return res.status(created ? 201 : 200).json({ ok: true, created, collection });
  });

  router.delete("/_collections/:collection", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    const removed = miniDb.dropCollection(container, collection);
    if (!removed) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true, removed: true, collection });
  });

  router.get("/:collection", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    const filter = parseFilter(req.query.filter);
    const sort = parseSort(req.query.sort);
    const skip = req.query.skip !== undefined ? Number(req.query.skip) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    if ((skip !== undefined && (!Number.isFinite(skip) || skip < 0)) ||
        (limit !== undefined && (!Number.isFinite(limit) || limit < 0))) {
      return res.status(400).json({ ok: false, error: "invalid_pagination" });
    }
    const rows = miniDb.list(container, collection, {
      filter: filter || undefined,
      sort: sort || undefined,
      skip,
      limit,
    });
    return res.json({ ok: true, rows });
  });

  router.post("/:collection", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: "body_must_be_json_object" });
    }
    const row = miniDb.create(container, collection, req.body);
    return res.status(201).json({ ok: true, row });
  });

  router.get("/:collection/:id", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    const id = String(req.params.id || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    const row = miniDb.get(container, collection, id);
    if (!row) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true, row });
  });

  router.patch("/:collection/:id", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    const id = String(req.params.id || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: "body_must_be_json_object" });
    }
    const hasOperators = Object.keys(req.body).some((k) => k.startsWith("$"));
    if (hasOperators) {
      const allowed = new Set(["$set", "$inc", "$unset"]);
      for (const key of Object.keys(req.body)) {
        if (key.startsWith("$") && !allowed.has(key)) {
          return res.status(400).json({ ok: false, error: "unsupported_update_operator" });
        }
      }
    }
    const row = miniDb.update(container, collection, id, req.body);
    if (!row) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true, row });
  });

  router.delete("/:collection/:id", (req, res) => {
    const { container } = req.dbContext;
    const collection = String(req.params.collection || "");
    const id = String(req.params.id || "");
    if (!isValidCollectionName(collection)) {
      return res.status(400).json({ ok: false, error: "invalid_collection_name" });
    }
    const removed = miniDb.remove(container, collection, id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    return res.json({ ok: true });
  });

  return router;
}

module.exports = { createPublicDatabaseRouter };
