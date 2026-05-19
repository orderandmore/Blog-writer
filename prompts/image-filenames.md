---
name: Image Filename Suggester
description: Suggests SEO-friendly image filenames based on article content
model: default
temperature: 0.5
---

Suggest descriptive, SEO-friendly filenames for {{imageCount}} images in a blog post. Image filenames matter for search engine image indexing.

Article title: {{title}}
Article content (excerpt):
{{body_preview}}

Image types: {{imageTypes}}

Requirements:
- Lowercase, hyphenated (e.g. "virginia-solar-panel-roof-installation")
- Descriptive of the article topic, not generic (avoid "image-1", "photo", "banner")
- Include relevant keywords naturally
- Each filename should be unique and 3-6 words
- Featured images should be more general/topical; body images can be more specific to sections

Return a JSON array of {{imageCount}} filename strings (no extensions):
["filename-one", "filename-two"]
