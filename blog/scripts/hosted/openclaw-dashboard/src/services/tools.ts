/**
 * Unified tool dispatcher for workflow system steps.
 * Calls the same execute* functions that the AI tool loop uses.
 */

import { validateToolInput } from "./tool-schemas";
import {
  executeBrowserTool,
  executeMessagingTool,
  executeGoogleTool,
  executeBufferTool,
  executeTwitterTool,
  executeBeehiivTool,
  executeGranolaTool,
  executeSupabaseTool,
  executeAirtableTool,
  executeNotionTool,
  executeLumaTool,
  executeGammaTool,
  executeAgreeTool,
  executeWordPressTool,
  executeMailchimpTool,
} from "./ai";

// Tool name → category mapping
const TOOL_CATEGORIES: Record<string, string> = {
  // Google
  gmail_search: "google", gmail_get_thread: "google", gmail_send: "google", gmail_create_draft: "google",
  gmail_reply: "google", gmail_reply_draft: "google", gmail_get_contacts: "google",
  calendar_list_events: "google", calendar_create_event: "google", calendar_update_event: "google", calendar_delete_event: "google",
  drive_search: "google", drive_create_folder: "google",
  docs_create: "google", docs_read: "google", docs_append: "google", docs_insert: "google",
  docs_suggest_edit: "google", docs_format_text: "google", docs_paragraph_style: "google",
  docs_list: "google", docs_insert_image: "google", docs_replace_text: "google",
  sheets_create: "google", sheets_read: "google", sheets_write: "google", sheets_append: "google", sheets_list_sheets: "google",
  // Browser
  browse_webpage: "browser", browser_click: "browser", browser_type: "browser",
  browser_select: "browser", browser_evaluate: "browser",
  browser_screenshot: "browser", browser_get_content: "browser",
  // Messaging
  send_slack: "messaging", slack_channel_members: "messaging",
  send_lobstermail: "messaging", check_lobstermail: "messaging",
  // Buffer
  buffer_list_channels: "buffer", buffer_create_post: "buffer",
  buffer_list_posts: "buffer", buffer_delete_post: "buffer",
  // Twitter
  twitter_get_me: "twitter", twitter_post_tweet: "twitter", twitter_post_thread: "twitter",
  twitter_get_recent_tweets: "twitter", twitter_delete_tweet: "twitter",
  twitter_lookup_tweet: "twitter", twitter_retweet: "twitter", twitter_undo_retweet: "twitter",
  twitter_lookup_user: "twitter", twitter_get_user_tweets: "twitter",
  twitter_quote_tweet: "twitter", twitter_like_tweet: "twitter",
  // Beehiiv
  beehiiv_list_templates: "beehiiv", beehiiv_create_draft: "beehiiv",
  beehiiv_list_posts: "beehiiv", beehiiv_get_post: "beehiiv",
  // Granola
  granola_list_meetings: "granola", granola_search_meetings: "granola",
  granola_get_transcript: "granola", granola_query: "granola", granola_list_folders: "granola",
  // Supabase
  supabase_query: "supabase", supabase_insert: "supabase", supabase_update: "supabase",
  // Airtable
  airtable_list_records: "airtable", airtable_create_record: "airtable",
  airtable_update_record: "airtable", airtable_delete_record: "airtable",
  // Notion
  notion_search: "notion", notion_get_page: "notion", notion_create_page: "notion",
  notion_update_page: "notion", notion_query_database: "notion",
  // Luma
  luma_list_events: "luma", luma_get_event: "luma", luma_create_event: "luma",
  luma_update_event: "luma", luma_get_guests: "luma",
  // Gamma
  gamma_create_presentation: "gamma", gamma_get_generation: "gamma",
  gamma_list_themes: "gamma", gamma_list_folders: "gamma",
  // Agree
  agree_list_templates: "agree", agree_get_template: "agree", agree_create_agreement: "agree",
  agree_create_and_send: "agree", agree_send_agreement: "agree", agree_list_agreements: "agree",
  agree_get_agreement: "agree", agree_list_contacts: "agree", agree_create_contact: "agree",
  // WordPress
  wordpress_create_post: "wordpress", wordpress_list_posts: "wordpress", wordpress_update_post: "wordpress",
  wordpress_list_categories: "wordpress", wordpress_list_tags: "wordpress", wordpress_upload_image: "wordpress",
  // Mailchimp
  mailchimp_list_audiences: "mailchimp", mailchimp_list_campaigns: "mailchimp", mailchimp_create_campaign: "mailchimp",
  mailchimp_send_campaign: "mailchimp", mailchimp_campaign_report: "mailchimp", mailchimp_add_subscriber: "mailchimp",
  mailchimp_list_templates: "mailchimp",
};

/**
 * Execute a tool by name with given input.
 * Returns the result as a string (JSON for structured data).
 */
export async function executeTool(toolName: string, input: Record<string, any>): Promise<string> {
  const category = TOOL_CATEGORIES[toolName];
  if (!category) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  // Validate input before execution
  const validationError = validateToolInput(toolName, input);
  if (validationError) {
    return JSON.stringify({ error: validationError });
  }

  try {
    let result: string | any[];
    switch (category) {
      case "google":
        result = await executeGoogleTool(toolName, input);
        break;
      case "browser":
        result = await executeBrowserTool(toolName, input);
        break;
      case "messaging":
        result = await executeMessagingTool(toolName, input);
        break;
      case "buffer":
        result = await executeBufferTool(toolName, input);
        break;
      case "twitter":
        result = await executeTwitterTool(toolName, input);
        break;
      case "beehiiv":
        result = await executeBeehiivTool(toolName, input);
        break;
      case "granola":
        result = await executeGranolaTool(toolName, input);
        break;
      case "supabase":
        result = await executeSupabaseTool(toolName, input);
        break;
      case "airtable":
        result = await executeAirtableTool(toolName, input);
        break;
      case "notion":
        result = await executeNotionTool(toolName, input);
        break;
      case "luma":
        result = await executeLumaTool(toolName, input);
        break;
      case "gamma":
        result = await executeGammaTool(toolName, input);
        break;
      case "agree":
        result = await executeAgreeTool(toolName, input);
        break;
      case "wordpress":
        result = await executeWordPressTool(toolName, input);
        break;
      case "mailchimp":
        result = await executeMailchimpTool(toolName, input);
        break;
      default:
        return JSON.stringify({ error: `Unsupported tool category: ${category}` });
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Tool execution failed" });
  }
}
