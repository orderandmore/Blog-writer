---
name: Social Copy Bundle
description: Generate social media copy for all platforms in one structured call
model: default
temperature: 0.7
---

Generate social media copy for the following blog post across all platforms. Return as a JSON object.

{{brand_rules}}

Article title: {{title}}
Article URL: {{url}}
Article body:
{{body}}

Return a JSON object with these exact keys:

> **Note:** This file is reference documentation only. The live prompt is in
> `src/lib/prompts.ts` (key prefix `socialAndPress.*`) and is the source of
> truth. Keep this file in sync when changing the prompt.

{
  "gmb": "Google Business Profile post. Aim 800-1000 chars, hard cap 1450 (never exceed 1500). NO LINKS — GMB strips them. No hashtags. Patty-voice CTA inviting Littleton-area contact.",
  "facebook": "Facebook caption. Max 500 chars, conversational. Reserve room for the article URL at the end so it's never truncated. No hashtags.",
  "instagram": "Instagram caption. Conversational, image-companion-style. No hashtags. No URL (IG captions aren't clickable).",
  "linkedin": "LinkedIn post. Aim 500-600 chars TOTAL including the trailing URL; hard cap 680 (never reach 700). The URL counts toward the limit and must never be truncated — shorten the body before risking the link. More professional/substantive than Facebook. No hashtags."
}
