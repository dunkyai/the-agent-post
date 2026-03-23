const GROQ_WHISPER_API = "https://api.groq.com/openai/v1/audio/transcriptions";

export function isAudioMimeType(mimetype: string): boolean {
  if (mimetype.startsWith("audio/")) return true;
  // Slack voice clips can be video/webm or video/mp4 with audio-only content
  if (mimetype === "video/webm" || mimetype === "video/mp4") return true;
  return false;
}

/** Check if a Slack file object is an audio/voice clip */
export function isSlackAudioFile(file: any): boolean {
  // Check mimetype first
  if (file.mimetype && isAudioMimeType(file.mimetype)) return true;
  // Slack clips have subtype "slack_audio"
  if (file.subtype === "slack_audio") return true;
  // Fallback: check filetype field
  const audioFiletypes = ["mp3", "mp4", "m4a", "wav", "ogg", "webm", "flac", "aac"];
  if (file.filetype && audioFiletypes.includes(file.filetype.toLowerCase())) return true;
  return false;
}

/** Map filename extension to MIME type for audio files */
function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav",
    ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac", aac: "audio/aac",
    mpeg: "audio/mpeg", mpga: "audio/mpeg",
  };
  return mimeMap[ext] || "audio/mp4";
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  apiKey?: string
): Promise<string> {
  // Use Groq API key from env (free), fall back to provided key with OpenAI
  const groqKey = process.env.GROQ_API_KEY;
  const key = groqKey || apiKey;

  if (!key) {
    throw new Error("No transcription API key available (set GROQ_API_KEY or configure OpenAI key in Settings)");
  }

  const mimeType = getMimeType(filename);
  const blob = new Blob([audioBuffer], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", groqKey ? "whisper-large-v3" : "whisper-1");

  // Try Groq first, fall back to OpenAI on failure
  const urls = groqKey
    ? [GROQ_WHISPER_API, "https://api.openai.com/v1/audio/transcriptions"]
    : ["https://api.openai.com/v1/audio/transcriptions"];

  let lastError = "";
  for (const url of urls) {
    const useKey = url === GROQ_WHISPER_API ? groqKey! : (apiKey || groqKey!);
    // Rebuild form for each attempt (Blob is consumed)
    const retryForm = new FormData();
    retryForm.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
    retryForm.append("model", url === GROQ_WHISPER_API ? "whisper-large-v3" : "whisper-1");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${useKey}` },
        body: retryForm,
      });

      if (!res.ok) {
        const body = await res.text();
        lastError = `${url} error (${res.status}): ${body}`;
        console.error(`Transcription API error: ${lastError}`);
        continue;
      }

      const data: any = await res.json();
      return data.text || "";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`Transcription fetch error (${url}): ${lastError}`);
      continue;
    }
  }

  throw new Error(`All transcription APIs failed. Last error: ${lastError}`);
}
