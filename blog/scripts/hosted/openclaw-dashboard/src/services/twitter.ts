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
    scope: "tweet.read tweet.write users.read like.write offline.access",
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
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId) throw new Error("TWITTER_CLIENT_ID not configured");

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: twitterConfig.refresh_token,
  };
  if (!clientSecret) body.client_id = clientId;

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
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

// --- Helpers ---

function extractTweetId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  // Pure numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;
  // URL: https://x.com/user/status/123 or https://twitter.com/user/status/123
  const match = trimmed.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
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

export async function twitterGetRecentTweets(maxResults: number = 10): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const count = Math.min(Math.max(maxResults, 5), 100); // X API requires 5-100
    const res = await fetch(
      `${TWITTER_API}/users/${twitterConfig.user_id}/tweets?max_results=${count}&tweet.fields=created_at,public_metrics,conversation_id`,
      { headers: await authHeaders() }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const tweets = (data.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
      url: `https://x.com/${twitterConfig!.username}/status/${t.id}`,
      conversation_id: t.conversation_id,
      metrics: t.public_metrics,
    }));
    return JSON.stringify({ tweets, count: tweets.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get recent tweets" });
  }
}

export async function twitterLookupTweet(tweetIdOrUrl: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const id = extractTweetId(tweetIdOrUrl);
    if (!id) {
      return JSON.stringify({ error: "Invalid tweet ID or URL. Provide a numeric tweet ID or a full x.com/twitter.com URL." });
    }

    const res = await fetch(
      `${TWITTER_API}/tweets/${id}?tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`,
      { headers: await authHeaders() }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const tweet = data.data;
    const author = data.includes?.users?.[0];

    return JSON.stringify({
      id: tweet.id,
      text: tweet.text,
      author: author ? { username: author.username, name: author.name } : { id: tweet.author_id },
      created_at: tweet.created_at,
      metrics: tweet.public_metrics,
      url: `https://x.com/${author?.username || "i"}/status/${tweet.id}`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to look up tweet" });
  }
}

export async function twitterQuoteTweet(tweetIdOrUrl: string, comment: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const tweetId = extractTweetId(tweetIdOrUrl);
    if (!tweetId) {
      return JSON.stringify({ error: "Invalid tweet ID or URL. Provide a numeric tweet ID or a full x.com/twitter.com URL." });
    }
    if (!comment || comment.trim().length === 0) {
      return JSON.stringify({ error: "Comment text is required for a quote tweet" });
    }

    // Look up the original tweet to get the author's username for the URL
    const lookupRes = await fetch(
      `${TWITTER_API}/tweets/${tweetId}?expansions=author_id&user.fields=username`,
      { headers: await authHeaders() }
    );
    let tweetUrl = `https://x.com/i/status/${tweetId}`;
    if (lookupRes.ok) {
      const lookupData: any = await lookupRes.json();
      const author = lookupData.includes?.users?.[0];
      if (author) tweetUrl = `https://x.com/${author.username}/status/${tweetId}`;
    }

    // Post as a new tweet with the URL appended — X renders it as a quote tweet
    const fullText = `${comment.trim()} ${tweetUrl}`;
    if (fullText.length > 280) {
      return JSON.stringify({ error: `Quote tweet exceeds 280 characters (${fullText.length}). Shorten your comment.` });
    }

    return await twitterPostTweet(fullText);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to quote tweet" });
  }
}

export async function twitterRetweet(tweetIdOrUrl: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const tweetId = extractTweetId(tweetIdOrUrl);
    if (!tweetId) {
      return JSON.stringify({ error: "Invalid tweet ID or URL. Provide a numeric tweet ID or a full x.com/twitter.com URL." });
    }

    const res = await fetch(`${TWITTER_API}/users/${twitterConfig.user_id}/retweets`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ tweet_id: tweetId }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();

    // Confirm retweet by looking up the tweet details
    let confirmation: any = { retweeted: data.data?.retweeted ?? true };
    try {
      const lookupRes = await fetch(
        `${TWITTER_API}/tweets/${tweetId}?tweet.fields=public_metrics,author_id&expansions=author_id&user.fields=username,name`,
        { headers: await authHeaders() }
      );
      if (lookupRes.ok) {
        const lookupData: any = await lookupRes.json();
        const tweet = lookupData.data;
        const author = lookupData.includes?.users?.[0];
        confirmation = {
          retweeted: true,
          tweet_id: tweet.id,
          tweet_text: tweet.text,
          author: author ? `@${author.username} (${author.name})` : tweet.author_id,
          tweet_url: `https://x.com/${author?.username || "i"}/status/${tweet.id}`,
          current_retweet_count: tweet.public_metrics?.retweet_count,
        };
      }
    } catch {
      // Confirmation lookup failed — still report success
    }

    return JSON.stringify({ success: true, ...confirmation });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to retweet" });
  }
}

export async function twitterUndoRetweet(tweetIdOrUrl: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const tweetId = extractTweetId(tweetIdOrUrl);
    if (!tweetId) {
      return JSON.stringify({ error: "Invalid tweet ID or URL. Provide a numeric tweet ID or a full x.com/twitter.com URL." });
    }

    const res = await fetch(`${TWITTER_API}/users/${twitterConfig.user_id}/retweets/${encodeURIComponent(tweetId)}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    return JSON.stringify({ success: true, undone: true });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to undo retweet" });
  }
}

export async function twitterLookupUser(username: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const handle = username.replace(/^@/, "").trim();
    if (!handle) return JSON.stringify({ error: "Username is required" });

    const res = await fetch(
      `${TWITTER_API}/users/by/username/${encodeURIComponent(handle)}?user.fields=description,public_metrics,created_at,profile_image_url`,
      { headers: await authHeaders() }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    if (!data.data) return JSON.stringify({ error: `User @${handle} not found` });

    return JSON.stringify({
      id: data.data.id,
      username: data.data.username,
      name: data.data.name,
      description: data.data.description,
      profile_url: `https://x.com/${data.data.username}`,
      metrics: data.data.public_metrics,
      created_at: data.data.created_at,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to look up user" });
  }
}

export async function twitterGetUserTweets(username: string, maxResults: number = 5): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const handle = username.replace(/^@/, "").trim();
    if (!handle) return JSON.stringify({ error: "Username is required" });

    // Resolve username to user ID
    const userRes = await fetch(
      `${TWITTER_API}/users/by/username/${encodeURIComponent(handle)}`,
      { headers: await authHeaders() }
    );

    if (!userRes.ok) {
      return JSON.stringify({ error: `Twitter API error (${userRes.status}): ${await userRes.text()}` });
    }

    const userData: any = await userRes.json();
    if (!userData.data) return JSON.stringify({ error: `User @${handle} not found` });

    const userId = userData.data.id;
    const count = Math.min(Math.max(maxResults, 5), 100);

    const res = await fetch(
      `${TWITTER_API}/users/${userId}/tweets?max_results=${count}&tweet.fields=created_at,public_metrics,conversation_id`,
      { headers: await authHeaders() }
    );

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const tweets = (data.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
      url: `https://x.com/${handle}/status/${t.id}`,
      conversation_id: t.conversation_id,
      metrics: t.public_metrics,
    }));
    return JSON.stringify({ user: `@${handle}`, tweets, count: tweets.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get user tweets" });
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

export async function twitterLikeTweet(tweetIdOrUrl: string): Promise<string> {
  if (!twitterConfig) return JSON.stringify({ error: "Twitter is not connected" });

  try {
    const tweetId = extractTweetId(tweetIdOrUrl);
    if (!tweetId) {
      return JSON.stringify({ error: "Invalid tweet ID or URL. Provide a numeric tweet ID or a full x.com/twitter.com URL." });
    }

    const res = await fetch(`${TWITTER_API}/users/${twitterConfig.user_id}/likes`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ tweet_id: tweetId }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Twitter API error (${res.status}): ${await res.text()}` });
    }

    return JSON.stringify({ success: true, liked: true, tweet_id: tweetId });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to like tweet" });
  }
}
