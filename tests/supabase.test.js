import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseClient, validateSupabaseConfig } from "../src/lib/supabase.js";

const config = { url: "https://family.supabase.co", publishableKey: "sb_publishable_test" };
const userId = "4d0dcaaa-9501-47d7-bae3-6e1ad8b0d960";
const plan = { version: 1, suppliers: [], categories: [], scenarios: [] };
const row = (revision = 1, data = plan) => ({ user_id: userId, data, revision });
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function setup(responses, options = {}) {
  const requests = [];
  const client = createSupabaseClient(config, {
    ...options,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), ...init, parsedBody: init.body ? JSON.parse(init.body) : undefined });
      assert.ok(responses.length, `Unexpected request: ${url}`);
      const next = responses.shift();
      return typeof next === "function" ? next(url, init) : next;
    },
  });
  return { client, requests };
}

test("configuration accepts HTTPS, localhost and legacy anon keys, rejecting privileged or unsafe configuration", () => {
  assert.deepEqual(validateSupabaseConfig({ ...config, url: ` ${config.url}/ ` }), {
    ...config, email: "familia@weeding-calculator.local", username: "jmxxp",
  });
  assert.equal(validateSupabaseConfig({ ...config, username: " JMXXP " }).username, "jmxxp");
  assert.equal(validateSupabaseConfig({ ...config, url: "http://localhost:54321/" }).url, "http://localhost:54321");
  const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.equal(validateSupabaseConfig({ ...config, publishableKey: jwt("anon") }).publishableKey, jwt("anon"));
  for (const overrides of [
    { publishableKey: "sb_secret_do-not-publish" },
    { publishableKey: jwt("service_role") },
    { publishableKey: "invalid" },
    { url: "http://family.supabase.co" },
    { url: "https://user:password@family.supabase.co" },
    { url: "https://family.supabase.co/rest/v1" },
    { url: "https://family.supabase.co?key=hidden" },
    { email: "invalid-address" },
    { username: "ab" },
    { username: "first last" },
    { username: "user@example.com" },
    { username: "a".repeat(51) },
    { username: "" },
    { username: 123 },
  ]) assert.throws(() => validateSupabaseConfig({ ...config, ...overrides }));
});

test("the shared plan opens directly with only the public key and no stored session", async () => {
  const { client, requests } = setup([json([row()])], {
    storage: {
      getItem() { assert.fail("Public access must not read a session"); },
      setItem() { assert.fail("Public access must not store a session"); },
      removeItem() { assert.fail("Public access must not clear browser storage"); },
    },
  });
  assert.equal(client.userId, null);
  assert.deepEqual(await client.readPlan(), { data: plan, revision: 1 });
  assert.equal(client.userId, userId);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url.pathname, "/rest/v1/family_plans");
  assert.equal(request.url.searchParams.get("select"), "user_id,data,revision");
  assert.equal(request.url.searchParams.get("user_id"), null);
  assert.equal(request.headers.apikey, config.publishableKey);
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.credentials, "omit");
  assert.equal(request.cache, "no-store");
  assert.equal(request.redirect, "error");
  assert.equal(client.signIn, undefined);
  assert.equal(client.restoreSession, undefined);
});

test("an empty shared plan is created with the database's existing family identity", async () => {
  const { client, requests } = setup([json([]), json([row()], 201)]);
  assert.equal(await client.readPlan(), null);
  assert.equal(client.userId, null);
  assert.deepEqual(await client.createPlan(plan), { data: plan, revision: 1 });
  assert.equal(client.userId, userId);
  const create = requests[1];
  assert.equal(create.method, "POST");
  assert.deepEqual(create.parsedBody, { data: plan, revision: 1 });
  assert.equal(create.headers.Prefer, "return=representation");
  assert.equal(create.headers.Authorization, undefined);
});

test("public updates target the loaded family identity and revision; conflicts return null", async () => {
  const { client, requests } = setup([json([row(5)]), json([row(6)]), json([])]);
  await client.readPlan();
  assert.deepEqual(await client.updatePlan(plan, 5), { data: plan, revision: 6 });
  assert.equal(await client.updatePlan(plan, 5), null);
  const update = requests[1];
  assert.equal(update.method, "PATCH");
  assert.equal(update.url.searchParams.get("user_id"), `eq.${userId}`);
  assert.equal(update.url.searchParams.get("revision"), "eq.5");
  assert.deepEqual(update.parsedBody, { data: plan, revision: 6 });
  assert.equal(update.headers.Prefer, "return=representation");
  assert.equal(update.headers.Authorization, undefined);
  assert.ok(requests.every((request) => request.url.pathname === "/rest/v1/family_plans"));
});

test("updates require a loaded identity and safe revision before any write is sent", async () => {
  const { client, requests } = setup([json([row()])]);
  await assert.rejects(client.updatePlan(plan, 1), { status: 400 });
  assert.equal(requests.length, 0);
  await client.readPlan();
  for (const revision of [-1, 0, 1.5, "1", NaN, Number.MAX_SAFE_INTEGER])
    await assert.rejects(client.updatePlan(plan, revision), { status: 400 });
  assert.equal(requests.length, 1);
});

test("failed network reads preserve the loaded identity and allow a later retry", async () => {
  const { client, requests } = setup([
    json([row()]),
    () => { throw new Error("offline"); },
    json([row(2)]),
  ]);
  await client.readPlan();
  await assert.rejects(client.readPlan(), { status: 0 });
  assert.equal(client.userId, userId);
  assert.deepEqual(await client.readPlan(), { data: plan, revision: 2 });
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("requests time out after 20 seconds with a recoverable error", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout", (duration) => {
    assert.equal(duration, 20000);
    return AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  });
  const { client } = setup([(_url, { signal }) => signal.throwIfAborted()]);
  await assert.rejects(client.readPlan(), (error) =>
    error.status === 0 && /demorou para responder/.test(error.message),
  );
  assert.equal(timeout.mock.callCount(), 1);
  assert.equal(client.userId, null);
});

test("HTTP errors retain status and identify missing public access without asking for a login", async () => {
  const { client } = setup([
    json({}, 401), json({}, 403), json({}, 404), json({}, 409), json({}, 429), json({}, 500),
  ]);
  for (const status of [401, 403])
    await assert.rejects(client.readPlan(), (error) => error.status === status && /acesso público/.test(error.message));
  await assert.rejects(client.readPlan(), { status: 404 });
  await assert.rejects(client.createPlan(plan), { status: 409 });
  await assert.rejects(client.readPlan(), { status: 429 });
  await assert.rejects(client.readPlan(), { status: 500 });
});

test("malformed plans never set an identity or count as saved", async () => {
  const malformed = [
    {},
    [row(), row()],
    [{ ...row(), user_id: "id&revision=eq.1" }],
    [{ ...row(), user_id: undefined }],
    [{ ...row(), data: [] }],
    [{ ...row(), revision: "1" }],
    [{ ...row(), revision: 0 }],
    [{ ...row(), revision: Number.MAX_SAFE_INTEGER + 1 }],
  ];
  for (const value of malformed) {
    const { client } = setup([json(value)]);
    await assert.rejects(client.readPlan(), { status: 502 });
    assert.equal(client.userId, null);
  }
  const { client } = setup([json([])]);
  await assert.rejects(client.createPlan(plan), { status: 502 });
});

test("non-JSON, invalid JSON and empty HTTP success responses are rejected", async () => {
  const { client } = setup([
    new Response("<html>unavailable</html>", { headers: { "Content-Type": "text/html" } }),
    new Response("not json", { headers: { "Content-Type": "application/json" } }),
    new Response(null, { status: 204 }),
  ]);
  for (let attempt = 0; attempt < 3; attempt++)
    await assert.rejects(client.readPlan(), { status: 502 });
});

test("a write response cannot replace the loaded family identity", async () => {
  const { client } = setup([
    json([row()]),
    json([{ ...row(2), user_id: "5d0dcaaa-9501-47d7-bae3-6e1ad8b0d960" }]),
  ]);
  await client.readPlan();
  await assert.rejects(client.updatePlan(plan, 1), { status: 502 });
  assert.equal(client.userId, userId);
});

test("Realtime uses public access and the loaded shared row without a custom token", async () => {
  const statuses = [];
  const changes = [];
  const sockets = [];
  const { client } = setup([json([row()])], {
    loadRealtime: async () => ({
      RealtimeClient: class {
        constructor(url, options) { this.url = url; this.options = options; sockets.push(this); }
        setAuth() { assert.fail("Public Realtime must not set a user JWT"); }
        channel() {
          const channel = {
            on: (type, filter, callback) => {
              if (type === "postgres_changes") { this.filter = filter; this.change = callback; }
              if (type === "system") this.system = callback;
              return channel;
            },
            subscribe: (callback) => {
              callback("SUBSCRIBED");
              this.system({ extension: "postgres_changes", status: "ok" });
            },
          };
          return channel;
        }
        removeChannel() { this.removed = true; return Promise.resolve("ok"); }
        disconnect() { this.closed = true; }
      },
    }),
  });
  assert.throws(() => client.subscribePlanChanges(), { status: 400 });
  await client.readPlan();
  const unsubscribe = client.subscribePlanChanges({
    onChange(change) { changes.push(change); },
    onStatus(status) { statuses.push(status); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, `${config.url}/realtime/v1`);
  assert.deepEqual(sockets[0].options.params, { apikey: config.publishableKey });
  assert.equal(sockets[0].options.accessToken, undefined);
  assert.equal(sockets[0].filter.filter, `user_id=eq.${userId}`);
  sockets[0].change({ new: { revision: 4, data: { private: "not forwarded" } } });
  assert.deepEqual(changes, [{ revision: 4 }]);
  assert.deepEqual(statuses, ["SUBSCRIBED"]);
  unsubscribe();
  assert.equal(sockets[0].removed, true);
  assert.equal(sockets[0].closed, true);
});
