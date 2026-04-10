
class DbClient {
  constructor({
    baseUrl = process.env.DB_API_BASE,
    apiKey = process.env.DB_API_KEY,
    container = process.env.DB_CONTAINER || "default",
  } = {}) {
    if (!baseUrl) {
      throw new Error("Missing DB_API_BASE");
    }
    if (!apiKey) {
      throw new Error("Missing DB_API_KEY");
    }
    if (!container) {
      throw new Error("Missing DB_CONTAINER");
    }

    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = String(apiKey);
    this.container = String(container);
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "x-db-container": this.container,
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data && data.error ? data.error : "request_failed";
      throw new Error(`DB ${res.status}: ${msg}`);
    }
    return data;
  }

  whoami() {
    return this.request("/_whoami");
  }

  listCollections() {
    return this.request("/");
  }

  createCollection(name) {
    return this.request(`/_collections/${encodeURIComponent(name)}`, {
      method: "POST",
    });
  }

  dropCollection(name) {
    return this.request(`/_collections/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  find(collection, { filter, sort, limit, skip } = {}) {
    const params = new URLSearchParams();
    if (sort) {
      params.set("sort", String(sort));
    }
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    if (skip !== undefined) {
      params.set("skip", String(skip));
    }
    if (filter && typeof filter === "object") {
      for (const [key, value] of Object.entries(filter)) {
        params.set(`filter[${key}]`, String(value));
      }
    }
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : "";
    return this.request(`/${encodeURIComponent(collection)}${suffix}`);
  }

  insert(collection, doc) {
    return this.request(`/${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify(doc || {}),
    });
  }

  getById(collection, id) {
    return this.request(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
  }

  update(collection, id, updateDoc) {
    return this.request(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(updateDoc || {}),
    });
  }

  remove(collection, id) {
    return this.request(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
}

module.exports = { DbClient };
