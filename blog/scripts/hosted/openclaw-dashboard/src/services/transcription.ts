import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

/** Convert audio buffer to WAV using ffmpeg (16kHz mono, what Whisper expects) */
function convertToWav(audioBuffer: Buffer, filename: string): { buffer: Buffer; filename: string } {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  // WAV files don't need conversion
  if (ext === "wav") return { buffer: audioBuffer, filename };

  const dir = mkdtempSync(join(tmpdir(), "transcribe-"));
  const inputPath = join(dir, filename);
  const outputPath = join(dir, "converted.wav");

  try {
    writeFileSync(inputPath, audioBuffer);
    execFileSync("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000",    // 16kHz sample rate
      "-ac", "1",        // mono
      "-f", "wav",
      "-y",              // overwrite
      outputPath,
    ], { timeout: 30000 });

    const wavBuffer = readFileSync(outputPath);
    console.log(`Converted ${filename} (${audioBuffer.length} bytes) → WAV (${wavBuffer.length} bytes)`);
    return { buffer: wavBuffer, filename: "audio.wav" };
  } finally {
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
    try { require("fs").rmdirSync(dir); } catch {}
  }
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

  // Convert to WAV for maximum compatibility with Whisper APIs
  let sendBuffer = audioBuffer;
  let sendFilename = filename;
  let sendMimeType = "audio/wav";

  try {
    const converted = convertToWav(audioBuffer, filename);
    sendBuffer = converted.buffer;
    sendFilename = converted.filename;
  } catch (err) {
    // ffmpeg not available or conversion failed — send original file
    console.warn(`Audio conversion failed, sending original: ${err instanceof Error ? err.message : err}`);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav",
      ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac", aac: "audio/aac",
    };
    sendMimeType = mimeMap[ext] || "audio/mp4";
  }

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
    form.append("file", new Blob([sendBuffer], { type: sendMimeType }), sendFilename);
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
