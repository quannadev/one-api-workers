import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "hono";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import db from "../src/db";
import { consumeAdminRateLimit, createAdminLoginChallenge, verifyAdminLoginChallenge } from "../src/admin/auth_shared";
import { claimModelComboStartIndex } from "../src/model-combos";
import { resolveChannel } from "../src/providers/shared/channel-resolver";
import { executeWithFallbackChannels } from "../src/providers/shared/upstream-retry";
import { ModelsEndpoint } from "../src/providers/models";

let directory: string;
let proxy: PlatformProxy<CloudflareBindings> | undefined;
let context: Context<HonoCustomType>;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "one-api-workers-d1-test-"));
    const configPath = join(directory, "wrangler.jsonc");
    await writeFile(configPath, JSON.stringify({
        name: "one-api-workers-regression", compatibility_date: "2025-04-28",
        d1_databases: [{ binding: "DB", database_name: "regression", database_id: "isolated-regression" }],
    }));
    proxy = await getPlatformProxy<CloudflareBindings>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
    context = new Context<HonoCustomType>(new Request("http://localhost/", { headers: { "cf-connecting-ip": "198.51.100.1" } }), { env: proxy.env });
    await db.initialize(context);
}, 30_000);

afterAll(async () => {
    try { await proxy?.dispose(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});

test("real local D1 preserves unlimited quota during precision migration", async () => {
    const database = context.env.DB;
    await database.exec("DROP TABLE api_token");
    await database.exec("CREATE TABLE api_token (key TEXT PRIMARY KEY, value TEXT, usage REAL, created_at TEXT, updated_at TEXT)");
    await database.prepare("INSERT INTO api_token VALUES (?, ?, 1.5, '2025-01-01', '2025-01-02')")
        .bind("unlimited", JSON.stringify({ name: "fixture", channel_keys: [], total_quota: -1 })).run();
    await db.migrate(context);
    const row = await database.prepare("SELECT value, usage FROM api_token WHERE key = 'unlimited'").first<{ value: string; usage: number }>();
    expect(JSON.parse(row!.value).total_quota).toBe(-1);
    expect(row!.usage).toBe(1500);
});

test("real local D1 admits exactly six concurrent rate-limit requests", async () => {
    const policy = { category: "local-d1-login", maxAttempts: 6, windowMs: 60_000, blockDurationMs: 120_000, message: "limited" };
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeAdminRateLimit(context, policy, "ip")));
    expect(results.filter(result => result.ok)).toHaveLength(6);
    const row = await context.env.DB.prepare("SELECT attempts FROM admin_rate_limit WHERE bucket_key = ?").bind("local-d1-login:ip").first<{ attempts: number }>();
    expect(row?.attempts).toBe(7);
});

test("real local D1 grants one consumer of a correct code and exhausts five incorrect attempts", async () => {
    const correct = await createAdminLoginChallenge(context);
    const winners = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(context, correct.challengeId, correct.code)));
    expect(winners.filter(result => result.ok)).toHaveLength(1);

    const incorrect = await createAdminLoginChallenge(context);
    const wrongCode = incorrect.code === "000000" ? "111111" : "000000";
    const failures = await Promise.all(Array.from({ length: 20 }, () => verifyAdminLoginChallenge(context, incorrect.challengeId, wrongCode)));
    expect(failures.filter(result => result.reason === "验证码错误")).toHaveLength(4);
    expect(failures.filter(result => result.reason === "验证码错误，已达到最大尝试次数")).toHaveLength(1);
    expect((await verifyAdminLoginChallenge(context, incorrect.challengeId, incorrect.code)).ok).toBe(false);
});

test("real local D1 advances model combo cursor in round-robin order", async () => {
    const database = context.env.DB;
    await database.prepare("DELETE FROM model_combo").run();
    await database.prepare(
        "INSERT INTO model_combo (model_name, model_id, provider_models) VALUES (?, ?, ?)"
    ).bind("balanced", "balanced", "[]").run();

    expect(await claimModelComboStartIndex(database, "balanced", 3)).toBe(0);
    expect(await claimModelComboStartIndex(database, "balanced", 3)).toBe(1);
    expect(await claimModelComboStartIndex(database, "balanced", 3)).toBe(2);
    expect(await claimModelComboStartIndex(database, "balanced", 3)).toBe(0);
});

test("combo routing respects model status, pricing, quota and model listing", async () => {
    const database = context.env.DB;
    await database.prepare("DELETE FROM model_combo").run();
    await database.prepare("DELETE FROM channel_config").run();
    await database.prepare("DELETE FROM api_token").run();
    const channel = {
        name: "test", type: "openai", enabled: true, api_key: "key",
        models: [{ name: "paid-model", id: "upstream", enabled: true }],
        model_pricing: { "paid-model": { billingMode: "request", input: 1 } },
    };
    await database.prepare("INSERT INTO channel_config (key, value) VALUES (?, ?)").bind("test", JSON.stringify(channel)).run();
    await database.prepare("INSERT INTO api_token (key, value, usage) VALUES (?, ?, ?)")
        .bind("token", JSON.stringify({ name: "test", channel_keys: ["test"], total_quota: 1000000000 }), 1000000000).run();
    await database.prepare("INSERT INTO model_combo (model_name, model_id, provider_models) VALUES (?, ?, ?)")
        .bind("balanced", "balanced", JSON.stringify([{ channel_key: "test", model_id: "upstream" }])).run();
    const makeContext = (method: string) => new Context<HonoCustomType>(new Request("http://localhost/v1/models", {
        method, headers: { authorization: "Bearer token", "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ model: "balanced" }) } : {}),
    }), { env: context.env });

    const blocked = await resolveChannel(makeContext("POST"), "chat-completions");
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(402);
    const listing = await new ModelsEndpoint().handle(makeContext("GET"));
    expect((await listing.json() as { data: { id: string }[] }).data.map(item => item.id)).not.toContain("balanced");

    await database.prepare("UPDATE api_token SET usage = 0 WHERE key = 'token'").run();
    const allowed = await resolveChannel(makeContext("POST"), "chat-completions");
    expect(allowed).not.toBeInstanceOf(Response);
    if (allowed instanceof Response) throw new Error("expected a channel");
    await allowed.saveUsage({} as Usage);
    expect(await database.prepare("SELECT usage FROM api_token WHERE key = 'token'").first<number>("usage")).toBe(1000);

    channel.models[0].enabled = false;
    await database.prepare("UPDATE channel_config SET value = ? WHERE key = 'test'").bind(JSON.stringify(channel)).run();
    const disabled = await resolveChannel(makeContext("POST"), "chat-completions");
    expect(disabled).toBeInstanceOf(Response);
    expect((disabled as Response).status).toBe(503);
    const disabledListing = await new ModelsEndpoint().handle(makeContext("GET"));
    expect((await disabledListing.json() as { data: { id: string }[] }).data.map(item => item.id)).not.toContain("balanced");
});

test("an explicit combo price takes precedence over the underlying model price", async () => {
    const database = context.env.DB;
    const channel = {
        name: "test", type: "openai", enabled: true, api_key: "key",
        models: [{ name: "paid-model", id: "upstream", enabled: true }],
        model_pricing: {
            "paid-model": { billingMode: "request", input: 1 },
            balanced: { billingMode: "request", input: 2 },
        },
    };
    await database.prepare("UPDATE channel_config SET value = ? WHERE key = 'test'").bind(JSON.stringify(channel)).run();
    await database.prepare("UPDATE api_token SET usage = 0 WHERE key = 'token'").run();
    const requestContext = new Context<HonoCustomType>(new Request("http://localhost/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ model: "balanced" }),
    }), { env: context.env });
    const result = await resolveChannel(requestContext, "chat-completions");
    if (result instanceof Response) throw new Error("expected a channel");
    await result.saveUsage({} as Usage);
    expect(await database.prepare("SELECT usage FROM api_token WHERE key = 'token'").first<number>("usage")).toBe(2000);
});

test("combo fallback tries each model on a channel", async () => {
    const config = { type: "unsupported", name: "test" } as ChannelConfig;
    const candidates = [
        { key: "test", config, mapping: { name: "combo", id: "first" } },
        { key: "test", config, mapping: { name: "combo", id: "second" } },
    ];
    const attempted: string[] = [];
    await executeWithFallbackChannels(context, candidates, candidates[0], {}, async () => {}, () => {},
        { retryCount: 0 }, candidate => attempted.push(candidate.mapping.id), "round_robin");
    expect(attempted).toEqual(["first", "second"]);
});
