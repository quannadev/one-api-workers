import { describe, expect, test } from "bun:test";
import { parseModelComboEntries, rotateModelComboEntries } from "../src/model-combos";

describe("model combo routing", () => {
    test("rotates provider entries from the persisted start index", () => {
        const entries = [
            { channel_key: "openai", model_id: "gpt-4o" },
            { channel_key: "anthropic", model_id: "claude-sonnet" },
            { channel_key: "gemini", model_id: "gemini-2.5" },
        ];

        expect(rotateModelComboEntries(entries, 0)).toEqual(entries);
        expect(rotateModelComboEntries(entries, 1)).toEqual([entries[1], entries[2], entries[0]]);
        expect(rotateModelComboEntries(entries, 4)).toEqual([entries[1], entries[2], entries[0]]);
    });

    test("accepts the sibling worker provider_name format", () => {
        expect(parseModelComboEntries(JSON.stringify([
            { provider_name: "openai", model_id: "gpt-4o" },
        ]))).toEqual([{ channel_key: "openai", model_id: "gpt-4o" }]);
        expect(parseModelComboEntries("invalid")).toEqual([]);
    });
});
