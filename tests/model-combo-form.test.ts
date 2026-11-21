import { expect, test } from "bun:test";
import { prepareCombo } from "../frontend/src/lib/model-combos";

test("combo form normalizes fields and retains provider order", () => {
    expect(prepareCombo({
        model_name: " balanced ", model_id: " gateway-model ", enabled: true,
        provider_models: [
            { channel_key: " first ", model_id: " model-a " },
            { channel_key: "second", model_id: "model-b" },
        ],
    })).toEqual({
        model_name: "balanced", model_id: "gateway-model", enabled: true,
        provider_models: [
            { channel_key: "first", model_id: "model-a" },
            { channel_key: "second", model_id: "model-b" },
        ],
    });
});

test("combo form rejects missing identity and incomplete provider entries", () => {
    const combo = { model_name: "combo", model_id: "alias", enabled: true, provider_models: [] };
    expect(prepareCombo(combo)).toBeNull();
    expect(prepareCombo({ ...combo, model_name: "  ", provider_models: [{ channel_key: "one", model_id: "model" }] })).toBeNull();
    expect(prepareCombo({ ...combo, provider_models: [{ channel_key: "one", model_id: "  " }] })).toBeNull();
});
