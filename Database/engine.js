const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class MiniDatabase {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, "data", "collections");
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  collectionPath(collection) {
    return path.join(this.dataDir, `${collection}.ndb`);
  }

  scopedCollection(container, collection) {
    return `${container}__${collection}`;
  }

  encodePayload(data) {
    return Buffer.from(JSON.stringify(data || {}), "utf8").toString("base64url");
  }

  decodePayload(raw) {
    try {
      const json = Buffer.from(raw, "base64url").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
    return {};
  }

  parseRowLine(line) {
    const parts = line.split("\t");
    if (parts.length < 4) {
      return null;
    }
    return {
      id: parts[0],
      createdAt: parts[1],
      updatedAt: parts[2],
      data: this.decodePayload(parts.slice(3).join("\t")),
    };
  }

  stringifyRowLine(row) {
    return [row.id, row.createdAt, row.updatedAt, this.encodePayload(row.data)].join("\t");
  }

  readCollection(collection) {
    this.ensureDataDir();
    const filePath = this.collectionPath(collection);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return [];
    }
    const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const row = this.parseRowLine(line);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  getValueByPath(source, dottedPath) {
    const pathParts = String(dottedPath || "").split(".").filter(Boolean);
    let current = source;
    for (const part of pathParts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  setValueByPath(target, dottedPath, value) {
    const pathParts = String(dottedPath || "").split(".").filter(Boolean);
    if (!pathParts.length) {
      return;
    }
    let current = target;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      const key = pathParts[i];
      if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) {
        current[key] = {};
      }
      current = current[key];
    }
    current[pathParts[pathParts.length - 1]] = value;
  }

  unsetValueByPath(target, dottedPath) {
    const pathParts = String(dottedPath || "").split(".").filter(Boolean);
    if (!pathParts.length) {
      return;
    }
    let current = target;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      const key = pathParts[i];
      if (!current[key] || typeof current[key] !== "object") {
        return;
      }
      current = current[key];
    }
    delete current[pathParts[pathParts.length - 1]];
  }

  applyUpdateOperators(currentData, updateInput) {
    const input = updateInput || {};
    const operatorKeys = Object.keys(input).filter((k) => k.startsWith("$"));
    if (!operatorKeys.length) {
      return {
        ...(currentData || {}),
        ...(input || {}),
      };
    }

    const next = JSON.parse(JSON.stringify(currentData || {}));

    if (input.$set && typeof input.$set === "object" && !Array.isArray(input.$set)) {
      for (const [pathKey, value] of Object.entries(input.$set)) {
        this.setValueByPath(next, pathKey, value);
      }
    }

    if (input.$inc && typeof input.$inc === "object" && !Array.isArray(input.$inc)) {
      for (const [pathKey, deltaRaw] of Object.entries(input.$inc)) {
        const delta = Number(deltaRaw);
        if (!Number.isFinite(delta)) {
          // Skip invalid increments instead of crashing request flow.
          continue;
        }
        const current = this.getValueByPath(next, pathKey);
        const currentNum = Number(current || 0);
        const base = Number.isFinite(currentNum) ? currentNum : 0;
        this.setValueByPath(next, pathKey, base + delta);
      }
    }

    if (input.$unset && typeof input.$unset === "object") {
      const keys = Array.isArray(input.$unset) ? input.$unset : Object.keys(input.$unset);
      for (const pathKey of keys) {
        this.unsetValueByPath(next, pathKey);
      }
    }

    return next;
  }

  matchRowFilter(row, filter) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      return true;
    }
    const entries = Object.entries(filter);
    for (const [pathKey, expected] of entries) {
      let actual;
      if (pathKey === "id" || pathKey === "createdAt" || pathKey === "updatedAt") {
        actual = row[pathKey];
      } else {
        actual = this.getValueByPath(row.data || {}, pathKey);
      }
      if (actual !== expected) {
        return false;
      }
    }
    return true;
  }

  writeCollection(collection, rows) {
    this.ensureDataDir();
    const filePath = this.collectionPath(collection);
    const tempFile = `${filePath}.tmp`;
    const output = rows.map((row) => this.stringifyRowLine(row)).join("\n");
    fs.writeFileSync(tempFile, output, "utf8");
    fs.renameSync(tempFile, filePath);
  }

  createCollection(container, collection) {
    const scoped = this.scopedCollection(container, collection);
    this.ensureDataDir();
    const filePath = this.collectionPath(scoped);
    if (fs.existsSync(filePath)) {
      return false;
    }
    fs.writeFileSync(filePath, "", "utf8");
    return true;
  }

  dropCollection(container, collection) {
    const scoped = this.scopedCollection(container, collection);
    this.ensureDataDir();
    const filePath = this.collectionPath(scoped);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    return true;
  }

  create(container, collection, data) {
    const scoped = this.scopedCollection(container, collection);
    const rows = this.readCollection(scoped);
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      data: data || {},
    };
    rows.push(row);
    this.writeCollection(scoped, rows);
    return row;
  }

  list(container, collection, options = {}) {
    const scoped = this.scopedCollection(container, collection);
    const { filter, sort, skip = 0, limit } = options;
    let rows = this.readCollection(scoped);

    if (filter && typeof filter === "object" && !Array.isArray(filter)) {
      rows = rows.filter((row) => this.matchRowFilter(row, filter));
    }

    if (sort && sort.field) {
      const dir = sort.direction === "desc" ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const aVal = sort.field === "id" || sort.field === "createdAt" || sort.field === "updatedAt"
          ? a[sort.field]
          : this.getValueByPath(a.data || {}, sort.field);
        const bVal = sort.field === "id" || sort.field === "createdAt" || sort.field === "updatedAt"
          ? b[sort.field]
          : this.getValueByPath(b.data || {}, sort.field);
        if (aVal === bVal) {
          return 0;
        }
        if (aVal == null) {
          return 1;
        }
        if (bVal == null) {
          return -1;
        }
        return aVal > bVal ? dir : -dir;
      });
    }

    const start = Math.max(0, Number(skip) || 0);
    let sliced = rows.slice(start);
    if (limit !== undefined && limit !== null) {
      const n = Math.max(0, Number(limit) || 0);
      sliced = sliced.slice(0, n);
    }
    return sliced;
  }

  get(container, collection, id) {
    const scoped = this.scopedCollection(container, collection);
    const rows = this.readCollection(scoped);
    return rows.find((row) => row.id === id) || null;
  }

  update(container, collection, id, data) {
    const scoped = this.scopedCollection(container, collection);
    const rows = this.readCollection(scoped);
    const idx = rows.findIndex((row) => row.id === id);
    if (idx < 0) {
      return null;
    }

    const current = rows[idx];
    rows[idx] = {
      ...current,
      updatedAt: new Date().toISOString(),
      data: this.applyUpdateOperators(current.data || {}, data || {}),
    };
    this.writeCollection(scoped, rows);
    return rows[idx];
  }

  remove(container, collection, id) {
    const scoped = this.scopedCollection(container, collection);
    const rows = this.readCollection(scoped);
    const idx = rows.findIndex((row) => row.id === id);
    if (idx < 0) {
      return false;
    }
    rows.splice(idx, 1);
    this.writeCollection(scoped, rows);
    return true;
  }

  listCollections(container) {
    this.ensureDataDir();
    const files = fs.readdirSync(this.dataDir, { withFileTypes: true });
    const prefix = `${container}__`;
    return files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ndb"))
      .map((entry) => entry.name.slice(0, -4))
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .sort();
  }
}

module.exports = { MiniDatabase };
