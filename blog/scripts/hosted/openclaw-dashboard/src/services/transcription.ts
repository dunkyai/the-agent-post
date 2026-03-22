const WHISPER_API = "https://api.openai.com/v1/audio/transcriptions";

export function isAudioMimeType(mimetype: string): boolean {
  if (mimetype.startsWith("audio/")) return true;
  // Slack voice clips can be video/webm with audio-only content
  if (mimetype === "video/webm") return true;
  return false;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  apiKey: string
): Promise<string> {
  const blob = new Blob([audioBuffer]);
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");

  const res = await fetch(WHISPER_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  return data.text || "";
}
