import crypto from "crypto";
import { upsertIntegration } from "./db";
import { encrypt } from "./encryption";

const TWITTER_API = "https://api.x.com/2";

// Module state
interface TwitterConfig {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  username: string;
  user_id: string;
}

let twitterConfig: TwitterConfig | null = null;

// --- OAuth URL ---

export function buildTwitterOAuthUrl(): string {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("TWITTER_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
    code_verifier: codeVerifier,
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://api.agents.theagentpost.co/oauth/twitter/callback",
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startTwitter(config: TwitterConfig): void {
  twitterConfig = config;
  console.log(`Twitter connected (@${config.username})`);
}

export function stopTwitter(): void {
  twitterConfig = null;
  console.log("Twitter disconnected");
}

export function isTwitterRunning(): boolean {
  return twitterConfig !== null;
}

export function getTwitterUsername(): string | null {
  return twitterConfig?.username || null;
}

// --- Token management ---

async function getValidAccessToken(): Promise<string> {
  if (!twitterConfig) throw new Error("Twitter is not connected");

  const expiry = new Date(twitterConfig.token_expiry).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() < expiry - fiveMinutes) {
    return twitterConfig.access_token;
  }

  return refreshAccessToken();
}

async function refreshAccessToken(): Promise<string> {
  if (!twitterConfig) throw new Error("Twitter is not connected");

  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) throw new Error("TWITTER_CLIENT_ID not configured");

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: twitterConfig.refresh_token,
      client_id: clientId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitter token refresh failed (${res.status}): ${body}`);
  }

  const data: any = await res.json();

  // Update in-memory config
  twitterConfig.access_token = data.access_token;
  twitterConfig.token_expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  if (data.refresh_token) {
    twitterConfig.refresh_token = data.refresh_token; // X rotates refresh tokens
  }

  // Persist updated tokens to DB
  const configData = {
    access_token: twitterConfig.access_token,
    refresh_token: twitterConfig.refresh_token,
    token_expiry: twitterConfig.token_expiry,
    username: twitterConfig.username,
    user_id: twitterConfig.user_id,
  };
  upsertIntegration("twitter", encrypt(JSON.stringify(configData)), "connected");

  console.log("Twitter token refreshed");
  return twitterConfig.access_token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// --- API wrappers ---

export async function twitterGetMe(): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const res = await fetch(`${TWITTER_API}/users/me?user.fields=username,name,description,public_metrics`, {
      headers: await authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify(data.data);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get user info" });
  }
}

export async function twitterPostTweet(text: string, replyToId?: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    if (!text || text.trim().length === 0) {
      return JSON.stringify({ error: "Tweet text is required" });
    }
    if (text.length > 280) {
      return JSON.stringify({ error: `Tweet exceeds 280 characters (${text.length})` });
    }

    const body: any = { text };
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }

    const res = await fetch(`${TWITTER_API}/tweets`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      tweet_id: data.data.id,
      text: data.data.text,
      url: `https://x.com/${twitterConfig.username}/status/${data.data.id}`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to post tweet" });
  }
}

export async function twitterPostThread(tweets: string[]): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });
  if (!tweets || tweets.length === 0) return JSON.stringify({ error: "No tweets provided" });

  // Validate all tweets before posting any
  for (let i = 0; i < tweets.length; i++) {
    if (!tweets[i] || tweets[i].trim().length === 0) {
      return JSON.stringify({ error: `Tweet ${i + 1} is empty` });
    }
    if (tweets[i].length > 280) {
      return JSON.stringify({ error: `Tweet ${i + 1} exceeds 280 characters (${tweets[i].length})` });
    }
  }

  try {
    const results: { tweet_id: string; text: string; url: string }[] = [];
    let previousTweetId: string | undefined;

    for (let i = 0; i < tweets.length; i++) {
      const body: any = { text: tweets[i] };
      if (previousTweetId) {
        body.reply = { in_reply_to_tweet_id: previousTweetId };
      }

      const res = await fetch(`${TWITTER_API}/tweets`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return JSON.stringify({
          error: `Failed to post tweet ${i + 1} of ${tweets.length}: ${errText}`,
          posted: results,
          failed_at: i + 1,
        });
      }

      const data: any = await res.json();
      previousTweetId = data.data.id;
      results.push({
        tweet_id: data.data.id,
        text: data.data.text,
        url: `https://x.com/${twitterConfig!.username}/status/${data.data.id}`,
      });
    }

    return JSON.stringify({
      success: true,
      thread_url: results[0].url,
      tweets: results,
      count: results.length,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to post thread" });
  }
}

export async function twitterDeleteTweet(tweetId: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const res = await fetch(`${TWITTER_API}/tweets/${encodeURIComponent(tweetId)}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    return JSON.stringify({ success: true, deleted: data.data?.deleted || false });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to delete tweet" });
  }
}
