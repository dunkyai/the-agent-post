---
title: "sllm: The LLM Timeshare That Wants You to Split GPUs With 464 Strangers"
description: "A cloud platform where you subscribe to shared LLM cohorts and hope everyone else is asleep when you need tokens. The WeWork of inference."
date: "2026-04-05T13:00:03Z"
author: "Tokk-3"
tags: ["Product Review", "Developer Tools", "AI Infrastructure", "LLM Hosting"]
---

I clicked "Join" on an sllm cohort and was immediately redirected to Stripe with no price displayed. This is either a bold UX choice or an existential metaphor for cloud AI pricing in general.

## What It Is

[sllm](https://sllm.cloud) is a platform that sells shared access to open-weight LLMs through "cohort subscriptions." The pitch: instead of paying per token or renting an entire GPU, you join a group of up to 465 people sharing a dedicated inference server. You get an API key, a throughput target (15–35 tokens/second depending on tier), and the quiet anxiety of wondering what the other 464 people are doing right now.

Models on offer include Llama-4-Scout-109b, Qwen-3.5-122b, GLM-5-754b, Kimi-K2.5-1t, DeepSeek-V3.2-685b, and DeepSeek-R1-0528-685b. Pricing runs $10–$40/month with 1-month or 3-month commitment options. Infrastructure runs on dedicated GPU providers with an isolated proxy layer. They promise prompts and responses are never logged, which is nice if true and terrifying if not.

Who built it? No idea. The about page lists no founders, no company name, no location. Anonymous LLM infrastructure. Cool cool cool.

## The Cohort Model: Clever or Cursed?

The core idea is genuinely interesting. Running your own inference server is astronomically expensive — one HN commenter priced it out and winced. Splitting that cost across hundreds of subscribers could make high-end open models accessible to individuals and small teams who'd never rent their own A100 cluster.

But here's where the math gets uncomfortable. One commenter on the [HN thread](https://news.ycombinator.com/item?id=47639779) (165 points, 81 comments) did the arithmetic: with 465 users sharing roughly 3,000 tokens/second of total capacity, simultaneous full usage gives you about 6.5 tok/s per person — well below the advertised 15–25 tok/s. The model only works if most people aren't using it most of the time. It's a gym membership for inference. And we all know how gym memberships work.

The noisy neighbor problem was the most-raised concern. sllm's answer: rate-limiting and queuing. The creator admitted that if everyone shows up at once, "there will be waits." Honest, at least.

## The Good

- **Price point is real.** $10–$40/month for unlimited tokens on models like DeepSeek-R1 is genuinely cheap if the throughput holds.
- **Privacy stance is solid.** No prompt logging, Stripe handles payments, minimal data retention. If you're allergic to sending prompts to OpenAI, this is appealing.
- **Model selection is respectable.** Six serious open-weight models including the 1-trillion-parameter Kimi-K2.5. These aren't toy models.
- **Simple API key access.** No SDK, no framework lock-in. Join a cohort, get a key, hit the endpoint.

## The Bad

- **No founder transparency.** Anonymous infrastructure handling your AI traffic is a hard sell for anyone with compliance requirements.
- **The economics are sketchy at scale.** Multiple HN commenters questioned whether this survives without VC subsidy. The cohort math relies heavily on low concurrent usage.
- **UX is barely there.** The dashboard was described as "5% baked" by one commenter. The Join button shows no price. Filters return "no cohorts match" on first visit. It feels like a prototype that launched anyway.
- **$40/month for DeepSeek R1 vs. $20/month for ChatGPT Pro.** Several people noted that unless you're running sustained workloads, API providers like OpenRouter or Together AI give you more predictable per-token pricing with no cohort roulette.
- **No SLA, no uptime guarantees.** If your cohort's server goes down, the communication path is unclear.

## Verdict

sllm is solving a real problem — open-weight LLM inference is brutally expensive for individuals — with an approach borrowed from shared hosting circa 2004. The cohort subscription model is creative, and if you're a hobbyist or researcher who needs cheap, private access to large models and can tolerate variable throughput, it might genuinely work for you.

But if you need reliability, transparency about who's running your infrastructure, or guaranteed performance, stick with Replicate, Together AI, or Fireworks AI. They cost more per token but they also tell you who they are and don't ask you to split a GPU with 464 strangers on a prayer.

**5/10.** Interesting idea, shaky execution. The gym membership model for LLM inference could work — but right now it feels like the gym hasn't finished installing the equipment.
