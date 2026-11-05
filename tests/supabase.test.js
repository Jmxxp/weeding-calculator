import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseClient, validateSupabaseConfig } from "../src/lib/supabase.js";

const TEST_PASSWORD = "family-test-password";
const config = { url: "https://family.supabase.co", publishableKey: "sb_publishable_test" };
const user = { id: "4d0dcaaa-9501-47d7-bae3-6e1ad8b0d960", app_metadata: { family_planner: true } };
const plan = { version: 1, suppliers: [], categories: [], scenarios: [] };
const auth = (overrides = {}) => ({
  access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, user, ...overrides,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function setup(responses, options = {}) {
  const requests = [];
  const storage = options.storage ?? memoryStorage();
  const client = createSupabaseClient(config, {
    ...options,
    storage,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), ...init, parsedBody: init.body ? JSON.parse(init.body) : undefined });
      assert.ok(responses.length, `Unexpected request: ${url}`);
      const next = responses.shift();
      return typeof next === "function" ? next(url, init) : next;
    },
  });
  return { client, requests, storage };
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

test("password login uses Supabase Auth and only stores project-scoped session tokens", async () => {
  const { client, requests, storage } = setup([json(auth())]);
  assert.deepEqual(await client.signIn(TEST_PASSWORD), user);
  assert.equal(client.userId, user.id);
  const request = requests[0];
  assert.equal(request.url.pathname, "/auth/v1/token");
  assert.equal(request.url.searchParams.get("grant_type"), "password");
  assert.deepEqual(request.parsedBody, { email: "familia@weeding-calculator.local", password: TEST_PASSWORD });
  assert.equal(request.headers.apikey, config.publishableKey);
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.equal(storage.values.size, 1);
  const [key, saved] = [...storage.values][0];
  assert.ok(key.includes(config.url));
  assert.equal(saved.includes(TEST_PASSWORD), false);
  assert.equal(JSON.parse(saved).refresh_token, "refresh-token");
});

test("invalid password reports a friendly error and never unlocks or stores a session", async () => {
  const { client, storage } = setup([json({ msg: "Invalid login credentials" }, 400)]);
  await assert.rejects(client.signIn("wrong"), (error) => error.status === 400 && error.message === "Usuário ou senha incorretos.");
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
  await assert.rejects(client.readPlan(), { status: 401 });
});

test("the username alias accepts trimmed case-insensitive input and retains the existing internal Auth account", async () => {
  const { client, requests, storage } = setup([json(auth())]);
  assert.deepEqual(await client.signIn(TEST_PASSWORD, " JMXXP "), user);
  assert.deepEqual(requests[0].parsedBody, {
    email: "familia@weeding-calculator.local", password: TEST_PASSWORD,
  });
  assert.equal(requests[0].parsedBody.username, undefined);
  const saved = [...storage.values.values()][0];
  assert.equal(saved.includes(TEST_PASSWORD), false);
  assert.equal(saved.includes("JMXXP"), false);
});

test("an incorrect username does not send credentials to Auth or unlock planning", async () => {
  const { client, requests, storage } = setup([]);
  for (const username of ["someone-else", "", null]) {
    await assert.rejects(client.signIn(TEST_PASSWORD, username), (error) =>
      error.status === 400 && error.message === "Usuário ou senha incorretos.",
    );
  }
  assert.equal(requests.length, 0);
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
  await assert.rejects(client.readPlan(), { status: 401 });
});

test("a configured username alias maps to its configured internal email without changing Auth identity", async () => {
  let submitted;
  const client = createSupabaseClient({ ...config, username: " Familia_01 ", email: "existing@example.com" }, {
    storage: memoryStorage(),
    fetchImpl: async (_url, init) => {
      submitted = JSON.parse(init.body);
      return json(auth());
    },
  });
  await client.signIn(TEST_PASSWORD, "FAMILIA_01");
  assert.deepEqual(submitted, { email: "existing@example.com", password: TEST_PASSWORD });
});

test("requests time out after 20 seconds with a recoverable error and no stored login", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout", (duration) => {
    assert.equal(duration, 20000);
    return AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  });
  const { client, storage } = setup([(_url, { signal }) => signal.throwIfAborted()]);
  await assert.rejects(client.signIn(TEST_PASSWORD), (error) =>
    error.status === 0 && /demorou para responder/.test(error.message),
  );
  assert.equal(timeout.mock.callCount(), 1);
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
});

test("user-editable metadata cannot authorize the family account", async () => {
  const { client, storage } = setup([json(auth({
    user: { id: user.id, user_metadata: { family_planner: true }, app_metadata: {} },
  }))]);
  await assert.rejects(client.signIn(TEST_PASSWORD), { status: 403 });
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
});

test("sessions require verification with /user before a new client restores them", async () => {
  const { client, storage } = setup([json(auth())]);
  await client.signIn(TEST_PASSWORD);
  const restored = setup([json(user)], { storage });
  assert.equal(restored.client.userId, null);
  assert.deepEqual(await restored.client.restoreSession(), user);
  assert.equal(restored.requests[0].url.pathname, "/auth/v1/user");
  assert.equal(restored.requests[0].headers.Authorization, "Bearer access-token");
  assert.equal(restored.client.userId, user.id);
});

test("an account whose family authorization was revoked cannot restore a session", async () => {
  const { client, storage } = setup([json(auth())]);
  await client.signIn(TEST_PASSWORD);
  const restored = setup([json({ id: user.id, app_metadata: {} })], { storage });
  assert.equal(await restored.client.restoreSession(), null);
  assert.equal(restored.client.userId, null);
  assert.equal(storage.values.size, 0);
});

test("a failed session validation stays closed and retains tokens for a later connection attempt", async () => {
  const { client, storage } = setup([json(auth())]);
  await client.signIn(TEST_PASSWORD);
  const restored = setup([() => { throw new Error("offline"); }, json(user)], { storage });
  await assert.rejects(restored.client.restoreSession(), { status: 0 });
  assert.equal(restored.client.userId, null);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(await restored.client.restoreSession(), user);
});

test("plan CRUD is authenticated, user-scoped and revision-checked; conflicts return null", async () => {
  const { client, requests } = setup([
    json(auth()), json([]), json([{ data: plan, revision: 1 }], 201),
    json([{ data: plan, revision: 2 }]), json([]),
  ]);
  await client.signIn(TEST_PASSWORD);
  assert.equal(await client.readPlan(), null);
  assert.deepEqual(await client.createPlan(plan), { data: plan, revision: 1 });
  assert.deepEqual(await client.updatePlan(plan, 1), { data: plan, revision: 2 });
  assert.equal(await client.updatePlan(plan, 1), null);
  const [read, create, update] = requests.slice(1);
  assert.equal(read.url.pathname, "/rest/v1/family_plans");
  assert.equal(read.url.searchParams.get("user_id"), `eq.${user.id}`);
  assert.equal(read.url.searchParams.get("select"), "data,revision");
  assert.equal(read.headers.Authorization, "Bearer access-token");
  assert.equal(create.method, "POST");
  assert.deepEqual(create.parsedBody, { user_id: user.id, data: plan, revision: 1 });
  assert.equal(create.headers.Prefer, "return=representation");
  assert.equal(update.method, "PATCH");
  assert.equal(update.url.searchParams.get("revision"), "eq.1");
  assert.equal(update.url.searchParams.get("user_id"), `eq.${user.id}`);
  assert.deepEqual(update.parsedBody, { data: plan, revision: 2 });
  await assert.rejects(client.updatePlan(plan, -1), { status: 400 });
});

test("concurrent API calls share one refresh and persist the rotated refresh token", async () => {
  let completeRefresh;
  const refreshResponse = new Promise((resolve) => { completeRefresh = resolve; });
  const { client, requests, storage } = setup([
    json(auth({ expires_in: 1 })), () => refreshResponse,
    json([{ data: plan, revision: 1 }]), json([{ data: plan, revision: 1 }]),
  ]);
  await client.signIn(TEST_PASSWORD);
  const first = client.readPlan();
  const second = client.readPlan();
  assert.equal(requests.filter((request) => request.url.searchParams.get("grant_type") === "refresh_token").length, 1);
  assert.deepEqual(requests[1].parsedBody, { refresh_token: "refresh-token" });
  completeRefresh(json(auth({ access_token: "new-access", refresh_token: "new-refresh" })));
  const rows = await Promise.all([first, second]);
  assert.deepEqual(rows, [{ data: plan, revision: 1 }, { data: plan, revision: 1 }]);
  assert.equal(requests.length, 4);
  for (const request of requests.slice(2)) assert.equal(request.headers.Authorization, "Bearer new-access");
  assert.equal(JSON.parse([...storage.values.values()][0]).refresh_token, "new-refresh");
});

test("expired stored tokens are refreshed before server-side user verification", async () => {
  const { client, storage } = setup([json(auth({ expires_in: 1 }))]);
  await client.signIn(TEST_PASSWORD);
  const restored = setup([json(auth({ access_token: "refreshed" })), json(user)], { storage });
  assert.deepEqual(await restored.client.restoreSession(), user);
  assert.equal(restored.requests[0].url.searchParams.get("grant_type"), "refresh_token");
  assert.equal(restored.requests[1].url.pathname, "/auth/v1/user");
  assert.equal(restored.requests[1].headers.Authorization, "Bearer refreshed");
});

test("a revoked access token refreshes once before retrying the data request", async () => {
  const { client, requests } = setup([
    json(auth()), json({}, 401), json(auth({ access_token: "renewed" })),
    json([{ data: plan, revision: 3 }]),
  ]);
  await client.signIn(TEST_PASSWORD);
  assert.deepEqual(await client.readPlan(), { data: plan, revision: 3 });
  assert.equal(requests.length, 4);
  assert.equal(requests[3].headers.Authorization, "Bearer renewed");
});

test("Realtime token access shares REST refresh and never exposes refresh tokens", async () => {
  const { client, requests } = setup([
    json(auth({ expires_in: 1 })),
    json(auth({ access_token: "rotated-access", refresh_token: "rotated-refresh" })),
  ]);
  await assert.rejects(client.getAccessToken(), { status: 401 });
  await client.signIn(TEST_PASSWORD);
  assert.equal(await client.getAccessToken(), "rotated-access");
  assert.equal(await client.getAccessToken(), "rotated-access");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.searchParams.get("grant_type"), "refresh_token");
});

test("session-end observers run on logout and revoked refresh, with removable subscriptions", async () => {
  const { client } = setup([
    json(auth({ expires_in: 1 })), json({}, 400),
    json(auth()), new Response(null, { status: 204 }),
  ]);
  await client.signIn(TEST_PASSWORD);
  let ended = 0;
  const detach = client.onSessionEnd(() => { ended++; });
  const detachBroken = client.onSessionEnd(() => { throw new Error("observer"); });
  await assert.rejects(client.getAccessToken(), { status: 400 });
  assert.equal(ended, 1);
  detach();
  detachBroken();
  await client.signIn(TEST_PASSWORD);
  const detachLogout = client.onSessionEnd(() => { ended++; });
  await client.signOut();
  assert.equal(ended, 2);
  detachLogout();
});

test("subscribePlanChanges refuses signed-out access and uses the injected official SDK loader", async () => {
  const statuses = [];
  const changes = [];
  const sockets = [];
  const { client } = setup([json(auth()), new Response(null, { status: 204 })], {
    loadRealtime: async () => ({
      RealtimeClient: class {
        constructor(url, options) { this.url = url; this.options = options; sockets.push(this); }
        async setAuth(token) { this.token = token; }
        channel() {
          this.subscription = {
            on: (_type, filter, callback) => { this.filter = filter; this.change = callback; },
            subscribe: (callback) => { callback("SUBSCRIBED"); },
          };
          return this.subscription;
        }
        removeChannel() { this.removed = true; return Promise.resolve("ok"); }
        disconnect() { this.closed = true; }
      },
    }),
  });
  assert.throws(() => client.subscribePlanChanges(), { status: 401 });
  await client.signIn(TEST_PASSWORD);
  const unsubscribe = client.subscribePlanChanges({
    onChange(change) { changes.push(change); },
    onStatus(status) { statuses.push(status); },
  });
  assert.equal(typeof unsubscribe, "function");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, `${config.url}/realtime/v1`);
  assert.equal(sockets[0].token, "access-token");
  assert.equal(await sockets[0].options.accessToken(), "access-token");
  assert.equal(sockets[0].filter.filter, `user_id=eq.${user.id}`);
  sockets[0].change({ new: { revision: 4, data: { private: "not forwarded" } } });
  assert.deepEqual(changes, [{ revision: 4 }]);
  assert.deepEqual(statuses, ["SUBSCRIBED"]);
  await client.signOut();
  assert.equal(sockets[0].removed, true);
  assert.equal(sockets[0].closed, true);
  assert.equal(await sockets[0].options.accessToken(), null);
  unsubscribe();
});

test("invalid refresh tokens clear the session and do not send a data request", async () => {
  const { client, requests, storage } = setup([json(auth({ expires_in: 1 })), json({}, 400)]);
  await client.signIn(TEST_PASSWORD);
  await assert.rejects(client.readPlan(), { status: 400 });
  assert.equal(requests.length, 2);
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
});

test("logout uses local scope so other relatives remain signed in and removes local tokens", async () => {
  const { client, requests, storage } = setup([json(auth()), new Response(null, { status: 204 })]);
  await client.signIn(TEST_PASSWORD);
  await client.signOut();
  assert.equal(requests[1].url.pathname, "/auth/v1/logout");
  assert.equal(requests[1].url.searchParams.get("scope"), "local");
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
  await assert.rejects(client.readPlan(), { status: 401 });
});

test("a late token refresh cannot restore a session after logout", async () => {
  let completeRefresh;
  const deferred = new Promise((resolve) => { completeRefresh = resolve; });
  const { client, storage } = setup([
    json(auth({ expires_in: 1 })), () => deferred, new Response(null, { status: 204 }),
  ]);
  await client.signIn(TEST_PASSWORD);
  const pending = client.readPlan();
  await client.signOut();
  completeRefresh(json(auth({ access_token: "late-access" })));
  await assert.rejects(pending, { status: 401 });
  assert.equal(client.userId, null);
  assert.equal(storage.values.size, 0);
});

test("blocked storage does not prevent in-memory sign-in and authenticated saves", async () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const { client } = setup([json(auth()), json([{ data: plan, revision: 1 }], 201)], { storage });
  assert.equal(await client.restoreSession(), null);
  await client.signIn(TEST_PASSWORD);
  assert.deepEqual(await client.createPlan(plan), { data: plan, revision: 1 });
});

test("a different project never restores the first project's session", async () => {
  const { client, storage } = setup([json(auth())]);
  await client.signIn(TEST_PASSWORD);
  const other = createSupabaseClient({ ...config, url: "https://other.supabase.co" }, {
    storage, fetchImpl: () => assert.fail("There is no session for this project"),
  });
  assert.equal(await other.restoreSession(), null);
  assert.equal(other.userId, null);
});

test("HTTP errors retain status and non-JSON or malformed success responses never count as saved", async () => {
  const { client } = setup([
    json(auth()), json({}, 403), json({}, 404), json({}, 409),
    new Response("<html>unavailable</html>", { headers: { "Content-Type": "text/html" } }),
    json([]),
  ]);
  await client.signIn(TEST_PASSWORD);
  await assert.rejects(client.readPlan(), { status: 403 });
  await assert.rejects(client.readPlan(), { status: 404 });
  await assert.rejects(client.createPlan(plan), { status: 409 });
  await assert.rejects(client.readPlan(), { status: 502 });
  await assert.rejects(client.createPlan(plan), { status: 502 });
});
