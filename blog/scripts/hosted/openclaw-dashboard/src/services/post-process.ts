/**
 * Post-processing: apply user formatting preferences to AI responses.
 * These are deterministic string transformations — guaranteed to work
 * every time, instead of hoping the AI remembers.
 *
 * Rules are loaded from the user's memories at startup and on change.
 * Some rules are hardcoded (universal). Others are derived from memory patterns.
 */

import { getAllMemories } from "./db";

interface PostProcessRule {
  name: string;
  apply: (text: string) => string;
}

// --- Universal rules (always applied) ---

const universalRules: PostProcessRule[] = [
  {
    // Remove hashtags from social content (e.g. #AI #Startup)
    name: "no-hashtags",
    apply: (text) => text.replace(/\s*#[A-Za-z]\w{1,29}\b/g, ""),
  },
  {
    // Fix tweet numbering: "1/8)" or "1/8:" → "1)"
    name: "tweet-numbering-slash",
    apply: (text) => text.replace(/(\d+)\/\d+\)/g, "$1)"),
  },
  {
    // Remove bold from social content (AI loves **bold** in tweets/posts)
    name: "no-bold-markers",
    apply: (text) => {
      // Only strip ** in contexts that look like social content (short lines, numbered items)
      // Don't strip in full documents or explanations
      const lines = text.split("\n");
      if (lines.length > 30) return text; // Long document — leave bold alone
      return text.replace(/\*\*([^*]+)\*\*/g, "$1");
    },
  },
];

// --- Phrase blocklist (loaded from memories) ---

const DEFAULT_BLOCKED_PHRASES = [
  "hey there",
  "let me paint you a picture",
  "let me show you",
  "the bottom line",
];

let blockedPhrases: string[] = [...DEFAULT_BLOCKED_PHRASES];
let lastMemoryLoad = 0;
const MEMORY_RELOAD_INTERVAL = 5 * 60 * 1000; // 5 minutes

function loadBlockedPhrasesFromMemories(): void {
  try {
    const memories = getAllMemories();
    const phrases = [...DEFAULT_BLOCKED_PHRASES];

    for (const mem of memories) {
      // Match patterns like "avoid using the phrase 'X'" or "avoid using phrases like 'X'"
      const matches = mem.content.match(/avoid\s+(?:using\s+)?(?:the\s+)?phrase[s]?\s+(?:like\s+)?["']([^"']+)["']/gi);
      if (matches) {
        for (const match of matches) {
          const phraseMatch = match.match(/["']([^"']+)["']/);
          if (phraseMatch) {
            phrases.push(phraseMatch[1].toLowerCase());
          }
        }
      }
    }

    blockedPhrases = [...new Set(phrases)];
  } catch {
    // Silently fail — use defaults
  }
}

// --- Main post-processing function ---

/**
 * Apply formatting rules to an AI response.
 * Called after the AI generates text, before it's sent to the user.
 */
export function postProcessResponse(text: string): string {
  if (!text || text.length < 5) return text;

  // Reload blocked phrases periodically
  const now = Date.now();
  if (now - lastMemoryLoad > MEMORY_RELOAD_INTERVAL) {
    lastMemoryLoad = now;
    loadBlockedPhrasesFromMemories();
  }

  let processed = text;

  // Apply universal rules
  for (const rule of universalRules) {
    processed = rule.apply(processed);
  }

  // Apply phrase blocklist (case-insensitive replacement)
  for (const phrase of blockedPhrases) {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    processed = processed.replace(regex, "");
  }

  // Clean up artifacts: double spaces, leading/trailing whitespace on lines
  processed = processed.replace(/  +/g, " ");
  processed = processed.replace(/^\s+$/gm, "");
  processed = processed.replace(/\n{3,}/g, "\n\n");

  return processed.trim();
}
