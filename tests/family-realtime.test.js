import assert from "node:assert/strict";
import { test } from "node:test";
import { subscribeFamilyPlanChanges } from "../src/lib/family-realtime.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(overrides = {}, { autoSystemReady = true } = {}) {
  const state = {
    sockets: [], statuses: [], changes: [], listeners: new Set(),
    token: "initial-token", loads: 0,
  };
  class RealtimeClient {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.auth = [];
      this.disconnected = 0;
      this.removals = [];
      state.sockets.push(this);
    }
    async setAuth(token) { this.auth.push(token); }
    channel(topic) {
      this.topic = topic;
      const channel = {
        on: (event, filter, callback) => {
          if (event === "postgres_changes") {
            this.event = event;
            this.filter = filter;
            this.onChange = callback;
          } else if (event === "system") this.onSystem = callback;
          return channel;
        },
        subscribe: (callback) => {
          this.onStatus = callback;
          callback("SUBSCRIBED");
          if (autoSystemReady)
            this.onSystem?.({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" });
          return channel;
        },
      };
      return channel;
    }
    removeChannel(channel) { this.removals.push(channel); return Promise.resolve("ok"); }
    disconnect() { this.disconnected++; }
  }
  const settings = {
    url: "https://family.supabase.co",
    publishableKey: "sb_publishable_public-only",
    userId: "4d0dcaaa-9501-47d7-bae3-6e1ad8b0d960",
    async getAccessToken() { return state.token; },
    onSessionEnd(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
    onChange(change) { state.changes.push(change); },
    onStatus(status) { state.statuses.push(status); },
    ...overrides,
  };
  const options = { retryDelays: [], async loadRealtime() { state.loads++; return { RealtimeClient }; } };
  return { state, settings, options, RealtimeClient };
}

test("official SDK gets the project endpoint, public key, current JWT and a user-scoped Postgres subscription", async () => {
  const { state, settings, options } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  assert.equal(typeof unsubscribe, "function");
  assert.equal(state.sockets.length, 0, "SDK initialization is asynchronous");
  await tick();
  const socket = state.sockets[0];
  assert.equal(socket.url, "https://family.supabase.co/realtime/v1");
  assert.deepEqual(socket.options.params, { apikey: "sb_publishable_public-only" });
  assert.deepEqual(socket.auth, ["initial-token"]);
  assert.equal(socket.topic, `family-plans:${settings.userId}`);
  assert.equal(socket.event, "postgres_changes");
  assert.deepEqual(socket.filter, {
    event: "*", schema: "public", table: "family_plans", filter: `user_id=eq.${settings.userId}`,
  });
  assert.deepEqual(state.statuses, ["SUBSCRIBED"]);
  unsubscribe();
});

test("events forward only revisions and SDK token callbacks obtain the newest token", async () => {
  const { state, settings, options } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  const socket = state.sockets[0];
  socket.onChange({ new: { revision: 7, data: { secret: "not forwarded" } } });
  socket.onChange({ old: { revision: 7 } });
  assert.deepEqual(state.changes, [{ revision: 7 }, { revision: undefined }]);
  state.token = "refreshed-token";
  assert.equal(await socket.options.accessToken(), "refreshed-token");
  socket.onStatus("TIMED_OUT");
  socket.onStatus("SUBSCRIBED");
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "TIMED_OUT"]);
  socket.onSystem({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" });
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "TIMED_OUT", "SUBSCRIBED"]);
  unsubscribe();
});

test("joining the WebSocket channel never reports PostgreSQL replication readiness by itself", async () => {
  const { state, settings, options } = fixture({}, { autoSystemReady: false });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  const socket = state.sockets[0];
  assert.deepEqual(state.statuses, []);
  socket.onSystem({ extension: "system", status: "ok", message: "Replication connection established" });
  socket.onSystem({ extension: "postgres_changes", status: "connecting" });
  assert.deepEqual(state.statuses, []);
  socket.onSystem({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" });
  assert.deepEqual(state.statuses, ["SUBSCRIBED"]);
  unsubscribe();
});

test("missing publication reports a PostgreSQL error while keeping the channel open for recovery and catch-up", async () => {
  const errors = [];
  const { state, settings, options } = fixture({
    onStatus(status, error) { state.statuses.push(status); if (error) errors.push(error); },
  }, { autoSystemReady: false });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  const socket = state.sockets[0];
  socket.onSystem({ extension: "postgres_changes", status: "error", message: "Table not found in publication" });
  assert.deepEqual(state.statuses, ["CHANNEL_ERROR"]);
  assert.match(errors[0].message, /publication/);
  assert.equal(socket.disconnected, 0);
  assert.equal(socket.removals.length, 0);
  assert.equal(state.listeners.size, 1);
  socket.onStatus("SUBSCRIBED");
  assert.deepEqual(state.statuses, ["CHANNEL_ERROR"], "a later channel join cannot mask the database error");
  socket.onSystem({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" });
  assert.deepEqual(state.statuses, ["CHANNEL_ERROR", "SUBSCRIBED"], "actual readiness triggers the caller's catch-up read");
  socket.onChange({ new: { revision: 9 } });
  assert.deepEqual(state.changes, [{ revision: 9 }]);
  assert.equal(state.sockets.length, 1);
  unsubscribe();
});

test("a real filtered database event proves readiness even if its system notification was missed", async () => {
  const { state, settings, options } = fixture({}, { autoSystemReady: false });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  state.sockets[0].onChange({ new: { revision: 3 } });
  assert.deepEqual(state.statuses, ["SUBSCRIBED"]);
  assert.deepEqual(state.changes, [{ revision: 3 }]);
  unsubscribe();
});

test("unsubscribe removes listeners and channel, disconnects immediately and ignores late callbacks", async () => {
  const { state, settings, options } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  const socket = state.sockets[0];
  const removal = deferred();
  socket.removeChannel = (channel) => { socket.removals.push(channel); return removal.promise; };
  unsubscribe();
  unsubscribe();
  assert.equal(state.listeners.size, 0);
  assert.equal(socket.removals.length, 1);
  assert.equal(socket.disconnected, 1, "do not wait for server unsubscribe acknowledgement");
  assert.equal(await socket.options.accessToken(), null);
  socket.onChange({ new: { revision: 99 } });
  socket.onStatus("SUBSCRIBED");
  assert.deepEqual(state.changes, []);
  assert.deepEqual(state.statuses, ["SUBSCRIBED"]);
  removal.reject(new Error("socket already closed"));
  await tick();
});

test("session ending disconnects an established subscription", async () => {
  const { state, settings, options } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  for (const listener of [...state.listeners]) listener();
  assert.equal(state.listeners.size, 0);
  assert.equal(state.sockets[0].disconnected, 1);
  assert.equal(state.sockets[0].removals.length, 1);
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "CLOSED"]);
  unsubscribe();
});

test("session ending during asynchronous SDK loading prevents a late socket", async () => {
  const loading = deferred();
  const { state, settings, RealtimeClient } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, { loadRealtime: () => loading.promise });
  await tick();
  for (const listener of [...state.listeners]) listener();
  loading.resolve({ RealtimeClient });
  await tick();
  assert.equal(state.sockets.length, 0);
  assert.equal(state.listeners.size, 0);
  assert.deepEqual(state.statuses, ["CLOSED"]);
  unsubscribe();
});

test("unsubscribe during initial authentication ignores the late token and does not load SDK", async () => {
  const authentication = deferred();
  const { state, settings, options } = fixture({ getAccessToken: () => authentication.promise });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  unsubscribe();
  authentication.resolve("late-token");
  await tick();
  assert.equal(state.loads, 0);
  assert.equal(state.sockets.length, 0);
  assert.equal(state.listeners.size, 0);
  assert.deepEqual(state.statuses, []);
});

test("session ending while initial setAuth is pending disconnects and never subscribes", async () => {
  const authentication = deferred();
  const { state, settings, options, RealtimeClient } = fixture();
  RealtimeClient.prototype.setAuth = () => authentication.promise;
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  for (const listener of [...state.listeners]) listener();
  authentication.resolve();
  await tick();
  assert.equal(state.sockets[0].disconnected, 1);
  assert.equal(state.sockets[0].topic, undefined);
  assert.deepEqual(state.statuses, ["CLOSED"]);
  unsubscribe();
});

test("token refresh failure closes the socket and does not reuse its stale access token", async () => {
  let tokenError;
  const { state, settings, options } = fixture({
    async getAccessToken() {
      if (tokenError) throw tokenError;
      return "valid-token";
    },
  });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  tokenError = Object.assign(new Error("session expired"), { status: 401 });
  assert.equal(await state.sockets[0].options.accessToken(), null);
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "CHANNEL_ERROR"]);
  assert.equal(state.sockets[0].disconnected, 1);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});

test("a transient heartbeat refresh failure keeps the authenticated socket and recovers on its next token callback", async () => {
  let tokenError;
  let token = "initial-token";
  const { state, settings, options } = fixture({
    async getAccessToken() {
      if (tokenError) throw tokenError;
      return token;
    },
  });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  const socket = state.sockets[0];
  tokenError = Object.assign(new Error("offline"), { status: 0 });
  assert.equal(await socket.options.accessToken(), "initial-token");
  assert.equal(socket.disconnected, 0);
  assert.equal(socket.removals.length, 0);
  assert.equal(state.listeners.size, 1);
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "CHANNEL_ERROR"]);
  tokenError = null;
  token = "renewed-token";
  assert.equal(await socket.options.accessToken(), "renewed-token");
  socket.onChange({ new: { revision: 8 } });
  assert.deepEqual(state.changes, [{ revision: 8 }]);
  assert.equal(state.sockets.length, 1);
  unsubscribe();
});

test("a failed initial token lookup retries with backoff and creates a socket after recovery", async () => {
  let calls = 0;
  const { state, settings, options } = fixture({
    async getAccessToken() {
      if (++calls === 1) throw Object.assign(new Error("offline"), { status: 0 });
      return "recovered-token";
    },
  });
  const unsubscribe = subscribeFamilyPlanChanges(settings, { ...options, retryDelays: [0] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.equal(state.sockets.length, 1);
  assert.deepEqual(state.sockets[0].auth, ["recovered-token"]);
  assert.deepEqual(state.statuses, ["CHANNEL_ERROR", "SUBSCRIBED"]);
  unsubscribe();
});

test("session ending cancels an initialization retry before another authentication attempt", async () => {
  let calls = 0;
  const { state, settings, options } = fixture({
    async getAccessToken() { calls++; throw Object.assign(new Error("offline"), { status: 0 }); },
  });
  const unsubscribe = subscribeFamilyPlanChanges(settings, { ...options, retryDelays: [20] });
  await tick();
  for (const listener of [...state.listeners]) listener();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  assert.equal(state.sockets.length, 0);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});

test("missing WebSocket reports CHANNEL_ERROR without loading SDK or throwing", async (t) => {
  t.mock.property(globalThis, "WebSocket", undefined);
  const { state, settings, options } = fixture();
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  assert.deepEqual(state.statuses, ["CHANNEL_ERROR"]);
  assert.equal(state.loads, 0);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});

test("SDK import and construction failures report CHANNEL_ERROR and detach observers", async () => {
  for (const loadRealtime of [
    async () => { throw new Error("import failed"); },
    async () => ({ RealtimeClient: class { constructor() { throw new Error("socket failed"); } } }),
  ]) {
    const { state, settings } = fixture();
    const unsubscribe = subscribeFamilyPlanChanges(settings, { loadRealtime, retryDelays: [] });
    await tick();
    assert.deepEqual(state.statuses, ["CHANNEL_ERROR"]);
    assert.equal(state.listeners.size, 0);
    unsubscribe();
  }
});

test("rejected callback promises are contained and clean up the subscription", async () => {
  const { state, settings, options } = fixture({
    onChange: async () => { throw new Error("listener failed"); },
  });
  const unsubscribe = subscribeFamilyPlanChanges(settings, options);
  await tick();
  state.sockets[0].onChange({ new: { revision: 2 } });
  await tick();
  assert.deepEqual(state.statuses, ["SUBSCRIBED", "CHANNEL_ERROR"]);
  assert.equal(state.sockets[0].disconnected, 1);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});
