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
  openaiKey?: string
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey && !openaiKey) {
    throw new Error("No transcription API key available (set GROQ_API_KEY or configure OpenAI key in Settings)");
  }

  const mimeType = getMimeType(filename);

  // Build ordered list of attempts: Groq turbo → Groq v3 → OpenAI
  const attempts: { url: string; key: string; model: string }[] = [];
  if (groqKey) {
    attempts.push({ url: GROQ_WHISPER_API, key: groqKey, model: "whisper-large-v3-turbo" });
    attempts.push({ url: GROQ_WHISPER_API, key: groqKey, model: "whisper-large-v3" });
  }
  if (openaiKey) {
    attempts.push({ url: "https://api.openai.com/v1/audio/transcriptions", key: openaiKey, model: "whisper-1" });
  }

  let lastError = "";
  for (const attempt of attempts) {
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
    form.append("model", attempt.model);

    try {
      console.log(`Trying transcription: ${attempt.model} at ${attempt.url}`);
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${attempt.key}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text();
        lastError = `${attempt.url} (${attempt.model}) error (${res.status}): ${body}`;
        console.error(`Transcription API error: ${lastError}`);
        continue;
      }

      const data: any = await res.json();
      console.log(`Transcription succeeded with ${attempt.model}`);
      return data.text || "";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`Transcription fetch error (${attempt.model}): ${lastError}`);
      continue;
    }
  }

  throw new Error(`All transcription APIs failed. Last error: ${lastError}`);
}
