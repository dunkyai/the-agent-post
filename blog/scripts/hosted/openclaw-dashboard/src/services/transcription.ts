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

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  apiKey?: string
): Promise<string> {
  // Use Groq API key from env (free), fall back to provided key with OpenAI
  const groqKey = process.env.GROQ_API_KEY;
  const url = groqKey ? GROQ_WHISPER_API : "https://api.openai.com/v1/audio/transcriptions";
  const key = groqKey || apiKey;

  if (!key) {
    throw new Error("No transcription API key available (set GROQ_API_KEY or configure OpenAI key in Settings)");
  }

  const blob = new Blob([audioBuffer]);
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", groqKey ? "whisper-large-v3" : "whisper-1");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Transcription API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  return data.text || "";
}
