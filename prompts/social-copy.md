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
  "gmb": "Google Business Profile post. Max 1500 chars, aim for 900. NO LINKS — GMB strips them. No hashtags. Focus on the value to Virginia homeowners. End with a call to action like 'Contact us for a free assessment.'",
  "facebook": "Facebook caption. ~500 chars. Conversational tone. Include the article URL at the end. No hashtags.",
  "instagram": "Instagram caption. Conversational but informative. No hashtags. Do NOT include a URL (Instagram captions don't support clickable links).",
  "twitter": "X/Twitter post. Max 280 chars total including URL. No hashtags. URL goes last."
}
