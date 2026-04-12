const GAMMA_API = "https://public-api.gamma.app/v1.0";

// Module state
interface GammaConfig {
  api_key: string;
}

let gammaConfig: GammaConfig | null = null;

// --- Lifecycle ---

export function startGamma(config: GammaConfig): void {
  gammaConfig = config;
  console.log("Gamma connected");
}

export function stopGamma(): void {
  gammaConfig = null;
  console.log("Gamma disconnected");
}

export function isGammaRunning(): boolean {
  return gammaConfig !== null;
}

// --- Connection test ---

export async function testGammaConnection(apiKey: string): Promise<{ success: boolean }> {
  // List themes as a lightweight connectivity check
  const res = await fetch(`${GAMMA_API}/themes`, {
    headers: { "X-API-KEY": apiKey },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Invalid API key. Get your key from Gamma account settings > API Keys.");
    }
    throw new Error(`Gamma API error (${res.status}): ${await res.text()}`);
  }

  return { success: true };
}

// --- API helpers ---

function headers(): Record<string, string> {
  if (!gammaConfig) throw new Error("Gamma is not connected");
  return {
    "X-API-KEY": gammaConfig.api_key,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function gammaCreatePresentation(params: {
  text: string;
  format?: string;
  num_cards?: number;
  text_amount?: string;
  tone?: string;
  audience?: string;
  language?: string;
  dimensions?: string;
  image_source?: string;
  image_style?: string;
  additional_instructions?: string;
  export_as?: string;
}): Promise<string> {
  if (!gammaConfig) return JSON.stringify({ error: "Gamma is not connected" });

  try {
    const body: any = {
      inputText: params.text,
      textMode: "generate",
      format: params.format || "presentation",
    };

    if (params.num_cards) body.numCards = params.num_cards;
    if (params.additional_instructions) body.additionalInstructions = params.additional_instructions;
    if (params.export_as) body.exportAs = params.export_as;

    if (params.text_amount || params.tone || params.audience || params.language) {
      body.textOptions = {};
      if (params.text_amount) body.textOptions.amount = params.text_amount;
      if (params.tone) body.textOptions.tone = params.tone;
      if (params.audience) body.textOptions.audience = params.audience;
      if (params.language) body.textOptions.language = params.language;
    }

    if (params.image_source || params.image_style) {
      body.imageOptions = {};
      if (params.image_source) body.imageOptions.source = params.image_source;
      if (params.image_style) body.imageOptions.style = params.image_style;
    }

    if (params.dimensions) {
      body.cardOptions = { dimensions: params.dimensions };
    }

    const res = await fetch(`${GAMMA_API}/generations`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Gamma API error (${res.status}): ${await res.text()}` });
    }

    const initResult = await res.json() as { generationId: string };
    const generationId = initResult.generationId;

    // Poll for completion (up to 120s)
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const poll = await fetch(`${GAMMA_API}/generations/${generationId}`, {
        headers: headers(),
      });

      if (!poll.ok) {
        return JSON.stringify({ error: `Gamma poll error (${poll.status}): ${await poll.text()}` });
      }

      const result = await poll.json() as any;
      if (result.status === "completed") {
        return JSON.stringify({
          url: result.gammaUrl,
          export_url: result.exportUrl || null,
          credits_used: result.credits?.deducted,
          credits_remaining: result.credits?.remaining,
        });
      }
      if (result.status === "error" || result.status === "failed") {
        return JSON.stringify({ error: `Generation failed: ${result.error || "unknown error"}` });
      }
    }

    return JSON.stringify({ error: "Generation timed out after 120 seconds", generationId });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create presentation" });
  }
}

export async function gammaGetGeneration(generationId: string): Promise<string> {
  if (!gammaConfig) return JSON.stringify({ error: "Gamma is not connected" });

  try {
    const res = await fetch(`${GAMMA_API}/generations/${generationId}`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Gamma API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get generation status" });
  }
}

export async function gammaListThemes(): Promise<string> {
  if (!gammaConfig) return JSON.stringify({ error: "Gamma is not connected" });

  try {
    const res = await fetch(`${GAMMA_API}/themes`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Gamma API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list themes" });
  }
}

export async function gammaListFolders(): Promise<string> {
  if (!gammaConfig) return JSON.stringify({ error: "Gamma is not connected" });

  try {
    const res = await fetch(`${GAMMA_API}/folders`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Gamma API error (${res.status}): ${await res.text()}` });
    }

    return await res.text();
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list folders" });
  }
}
