import "server-only";

// Shared Google Gemini call used by the PDF readers (invoices, IT manuals).
// Returns parsed JSON, or the kind of failure so each route words its own message.

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

// Google sometimes answers 503 ("high demand") or 500 for a busy model. Those are
// retried once and then the next model is tried, all within the route's time limit.
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash"];
const RETRYABLE = new Set([500, 502, 503, 504]);

export type GeminiFailure = "auth" | "unreadable" | "rate_limit" | "busy";
export type GeminiResult = { ok: true; raw: unknown } | { ok: false; failure: GeminiFailure };

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };

export async function generateJsonWithGemini({ apiKey, parts, responseSchema, timeBudgetMs, label }: {
  apiKey: string;
  parts: GeminiPart[];
  responseSchema: unknown;
  timeBudgetMs: number;
  /** Used only in server logs. */
  label: string;
}): Promise<GeminiResult> {
  const configured = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const models = [configured, ...FALLBACK_MODELS.filter((model) => model !== configured)];
  const deadline = Date.now() + timeBudgetMs;
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema },
  });
  let lastStatus = 0;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) break;
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(remaining, 40_000)),
        });
        if (response.ok) {
          const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
          return { ok: true, raw: JSON.parse(text) };
        }
        lastStatus = response.status;
        console.error(`Gemini (${model}) respondió con error leyendo ${label}:`, response.status, (await response.text()).slice(0, 300));
        // Bad key or bad request won't improve with another model.
        if (response.status === 401 || response.status === 403) return { ok: false, failure: "auth" };
        if (response.status === 400) return { ok: false, failure: "unreadable" };
        // 404: model not available for this key; 429: quota for this model. Both → next model.
        if (!RETRYABLE.has(response.status)) break;
      } catch (cause) {
        lastStatus = 0;
        console.error(`No se pudo leer ${label} con Gemini (${model}):`, cause);
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  if (lastStatus === 429) return { ok: false, failure: "rate_limit" };
  if (RETRYABLE.has(lastStatus)) return { ok: false, failure: "busy" };
  return { ok: false, failure: "unreadable" };
}

/**
 * Uploads a large file to the Gemini Files API (inline data is capped at ~20 MB
 * per request) and waits until it can be used. Returns the file's uri and name,
 * or null if it failed. Files expire on their own after 48 h; callers should
 * still delete them with deleteGeminiFile when done.
 */
export async function uploadGeminiFile(apiKey: string, bytes: Buffer, mimeType: string, displayName: string, deadline: number): Promise<{ uri: string; name: string } | null> {
  try {
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(deadline - Date.now(), 15_000))),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) {
      console.error("Gemini Files API no aceptó la subida:", start.status, (await start.text()).slice(0, 300));
      return null;
    }
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": String(bytes.length) },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(deadline - Date.now(), 30_000))),
    });
    if (!upload.ok) {
      console.error("Gemini Files API falló al subir el archivo:", upload.status, (await upload.text()).slice(0, 300));
      return null;
    }
    let file = ((await upload.json()) as { file?: { uri?: string; name?: string; state?: string } }).file;
    while (file?.state === "PROCESSING" && file.name && Date.now() < deadline - 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const check = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
      if (!check.ok) break;
      file = (await check.json()) as { uri?: string; name?: string; state?: string };
    }
    if (!file?.uri || !file.name || (file.state && file.state !== "ACTIVE")) return null;
    return { uri: file.uri, name: file.name };
  } catch (cause) {
    console.error("No se pudo subir el archivo a Gemini:", cause);
    return null;
  }
}

export async function deleteGeminiFile(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } });
  } catch {
    // Not critical: Gemini removes uploaded files after 48 h.
  }
}
