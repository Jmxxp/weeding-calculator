const loadDefaultRealtime = () => import("../vendor/realtime.js");

/** Official Realtime SDK subscription; REST remains responsible for merging data. */
export function subscribeFamilyPlanChanges({
  url,
  publishableKey,
  userId,
  getAccessToken,
  onSessionEnd,
  onChange = () => {},
  onStatus = () => {},
}, { loadRealtime = loadDefaultRealtime, retryDelays = [1000, 2000, 5000, 10000] } = {}) {
  let stopped = false;
  let socket = null;
  let channel = null;
  let detachSessionListener = () => {};
  let lastToken = null;
  let retryTimer;
  let retryAttempt = 0;
  const authFailure = (error) => [400, 401, 403, 422].includes(error?.status);

  function status(state, error) {
    if (stopped) return;
    try { onStatus(state, error); } catch { /* UI observers cannot break transport cleanup. */ }
  }

  function disconnect() {
    const currentSocket = socket;
    const currentChannel = channel;
    socket = null;
    channel = null;
    if (!currentSocket) return;
    if (currentChannel) {
      try {
        Promise.resolve(currentSocket.removeChannel(currentChannel)).catch(() => {});
      } catch { /* A disconnected channel may already be gone. */ }
    }
    // Do not wait for the unsubscribe acknowledgement before stopping reconnects.
    try { currentSocket.disconnect(); } catch { /* Cleanup is safe to repeat. */ }
  }

  function unsubscribe() {
    if (stopped) return;
    stopped = true;
    clearTimeout(retryTimer);
    lastToken = null;
    try { detachSessionListener(); } catch { /* Always disconnect, even if an observer fails. */ }
    disconnect();
  }

  function fail(error) {
    if (stopped) return;
    status("CHANNEL_ERROR", error);
    unsubscribe();
  }

  async function accessToken() {
    if (stopped) return null;
    try {
      const token = await getAccessToken();
      if (stopped) return null;
      if (typeof token !== "string" || !token)
        throw Object.assign(new Error("A sessão da família foi encerrada."), { status: 401 });
      lastToken = token;
      return token;
    } catch (error) {
      if (stopped) return null;
      if (authFailure(error)) {
        fail(error);
        return null;
      }
      // A brief refresh outage must not downgrade an authenticated socket to anon.
      // The SDK will ask again on its next heartbeat/reconnect; the server still
      // enforces expiry and RLS on this previously authenticated JWT.
      if (lastToken) {
        status("CHANNEL_ERROR", error);
        return lastToken;
      }
      throw error;
    }
  }

  function initializationFailed(error) {
    if (stopped) return;
    disconnect();
    status("CHANNEL_ERROR", error);
    const delay = retryDelays[retryAttempt++];
    if (authFailure(error) || error?.permanent || !Number.isFinite(delay) || delay < 0) {
      unsubscribe();
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void initialize().catch(initializationFailed);
    }, delay);
  }

  async function initialize() {
    if (stopped) return;
    if (typeof globalThis.WebSocket !== "function")
      throw Object.assign(new Error("Este navegador não permite conexão em tempo real."), { permanent: true });
    if (typeof userId !== "string" || !userId || typeof getAccessToken !== "function")
      throw Object.assign(new Error("Entre com a senha da família para conectar em tempo real."), { status: 401 });
    const token = await accessToken();
    if (stopped) return;
    const { RealtimeClient } = await loadRealtime();
    if (stopped) return;
    socket = new RealtimeClient(`${url.replace(/\/$/, "")}/realtime/v1`, {
      params: { apikey: publishableKey },
      accessToken,
    });
    await socket.setAuth(token);
    if (stopped) return;
    channel = socket.channel(`family-plans:${userId}`);
    channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "family_plans",
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      if (stopped) return;
      try {
        Promise.resolve(onChange({ revision: payload?.new?.revision })).catch(fail);
      } catch (error) { fail(error); }
    });
    channel.subscribe((state, error) => status(state, error));
  }

  try {
    if (typeof onSessionEnd === "function")
      detachSessionListener = onSessionEnd(() => {
        status("CLOSED");
        unsubscribe();
      });
    // Start in a microtask so callers always receive cleanup synchronously.
    void Promise.resolve().then(initialize).catch(initializationFailed);
  } catch (error) { fail(error); }
  return unsubscribe;
}
