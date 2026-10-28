import { describe, it, expect } from "vitest";
import {
  evaluateModelEligibility,
  normalizeModelId,
  discoverGeminiModels,
  refreshGeminiModelCatalog,
} from "@/services/kh02/ai/geminiModelDiscoveryService";

describe("SWAI KH-02 V12.4 — Gemini Model Discovery & Capability Assessment", () => {
  it("normalizes model names by stripping models/ prefix", () => {
    expect(normalizeModelId("models/gemini-3.7-flash")).toBe("gemini-3.7-flash");
    expect(normalizeModelId("gemini-3.6-flash")).toBe("gemini-3.6-flash");
  });

  it("marks models with generateContent and standard text capability as eligible", () => {
    const raw = {
      name: "models/gemini-3.7-flash",
      displayName: "Gemini 3.7 Flash",
      supportedActions: ["generateContent", "countTokens"],
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
    };
    const res = evaluateModelEligibility(raw);
    expect(res.eligible).toBe(true);
    expect(res.capabilities.supportsGenerateContent).toBe(true);
    expect(res.capabilities.supportsStructuredOutput).toBe(true);
    expect(res.priorityScore).toBeGreaterThan(80);
  });

  it("excludes models without generateContent action", () => {
    const raw = {
      name: "models/embedding-001",
      displayName: "Embedding Model",
      supportedActions: ["embedContent"],
    };
    const res = evaluateModelEligibility(raw);
    expect(res.eligible).toBe(false);
    expect(res.reason).toContain("generateContent");
  });

  it("excludes specialized audio/TTS and robotics models", () => {
    const ttsModel = {
      name: "models/gemini-2.5-flash-preview-tts",
      supportedActions: ["generateContent"],
    };
    const ttsRes = evaluateModelEligibility(ttsModel);
    expect(ttsRes.eligible).toBe(false);

    const roboticsModel = {
      name: "models/gemini-robotics-er-2-preview",
      supportedActions: ["generateContent"],
    };
    const robRes = evaluateModelEligibility(roboticsModel);
    expect(robRes.eligible).toBe(false);
  });

  it("correctly identifies discontinued models like gemini-2.5-flash", () => {
    const discontinued = {
      name: "models/gemini-2.5-flash",
      supportedActions: ["generateContent"],
    };
    const res = evaluateModelEligibility(discontinued);
    expect(res.eligible).toBe(false);
    expect(res.capabilities.isDeprecatedOrRemoved).toBe(true);
  });

  it("ranks gemini-3.7-flash and gemini-3.6-flash higher than fallback preview models", () => {
    const m37 = evaluateModelEligibility({
      name: "models/gemini-3.7-flash",
      supportedActions: ["generateContent"],
    });
    const m36 = evaluateModelEligibility({
      name: "models/gemini-3.6-flash",
      supportedActions: ["generateContent"],
    });
    const mgemma = evaluateModelEligibility({
      name: "models/gemma-4-26b-a4b-it",
      supportedActions: ["generateContent"],
    });

    expect(m37.priorityScore).toBeGreaterThan(m36.priorityScore);
    expect(m36.priorityScore).toBeGreaterThan(mgemma.priorityScore);
  });

  it("discovers models from client and produces a primary model + fallback chain", async () => {
    const mockClient = {
      models: {
        list: async function* () {
          yield {
            name: "models/gemini-3.7-flash",
            displayName: "Gemini 3.7 Flash",
            supportedActions: ["generateContent"],
          };
          yield {
            name: "models/gemini-3.6-flash",
            displayName: "Gemini 3.6 Flash",
            supportedActions: ["generateContent"],
          };
          yield {
            name: "models/gemini-2.5-flash-preview-tts",
            displayName: "TTS Only",
            supportedActions: ["generateContent"],
          };
        },
      },
    } as any;

    const res = await discoverGeminiModels({ client: mockClient, forceRefresh: true });
    expect(res.discovered.length).toBe(3);
    expect(res.eligible.length).toBe(2);
    expect(res.primaryModel?.modelId).toBe("gemini-3.7-flash");
    expect(res.fallbackChain.length).toBe(1);
    expect(res.fallbackChain[0].modelId).toBe("gemini-3.6-flash");
  });
});
