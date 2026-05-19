---
name: Metadata Batch Generator
description: Generates description, seoTitle, seoDescription, and tags in one call
model: default
temperature: 0.7
---

Generate blog post metadata for the following article. Return a JSON object.

{{brand_rules}}

Article title: {{title}}
Article body:
{{body}}

Return a JSON object with these exact keys:

{
  "description": "A 150-160 character meta description. Summarize the key value to the reader. Do not open with 'Discover' or 'Learn how'. Use specific facts from the article.",
  "seoTitle": "A 50-60 character SEO title ending with ' | Virtue Solar'. Front-load the primary keyword. Be specific, not generic.",
  "seoDescription": "A 150-160 character SEO meta description. Can differ slightly from description — optimize for click-through from search results.",
  "tags": ["3-5 lowercase hyphenated tags specific to the article content, e.g. 'net-metering', 'virginia-srecs'"]
}
