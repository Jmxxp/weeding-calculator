import assert from "node:assert/strict";
import { test } from "node:test";
import { publicSupabaseConfig, supabaseConfigModule } from "../scripts/supabase-config.js";

test("static builds include the configured project but never administrative credentials or the access password", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_FAMILY_EMAIL: "family@example.test",
    SUPABASE_FAMILY_USERNAME: "jmxxp",
    SUPABASE_SECRET_KEY: "sb_secret_do_not_publish",
    FAMILY_ACCESS_PASSWORD: "private-test-password",
  };
  assert.deepEqual(publicSupabaseConfig(env), {
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_example",
    email: "family@example.test",
    username: "jmxxp",
  });
  const module = supabaseConfigModule(env);
  assert.match(module, /example.supabase.co/);
  assert.doesNotMatch(module, /sb_secret|private-test-password/);
});

test("a privileged key in the public configuration fails instead of being published", () => {
  assert.throws(() => supabaseConfigModule({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_secret_privileged",
  }), /somente a chave pública/);
});
