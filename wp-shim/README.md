# WP shim

PHP files in this directory are meant to be uploaded to **Patty's WordPress server**, not deployed with the Next.js app. They live here for version control and so the next person can find them.

## `portal-seo-rest.php`

A WordPress mu-plugin that exposes The SEO Framework's `_genesis_title` and `_genesis_description` meta fields to the REST API. Without it, the portal can write everything else (title, content, categories, featured image, etc.) but the SEO title and meta description fields silently no-op — WordPress drops unregistered meta keys.

### Upload via Hostinger File Manager

1. Log into Hostinger, open her site's **File Manager**
2. Navigate to `/public_html/wp-content/`
3. If there's no `mu-plugins/` directory, create one
4. Upload `portal-seo-rest.php` into `mu-plugins/`

### Upload via SFTP

```bash
# Hostinger gives SFTP creds in the hPanel under "FTP Accounts"
sftp user@her-host
cd public_html/wp-content
mkdir -p mu-plugins
put portal-seo-rest.php mu-plugins/
```

### Verify

After upload, this curl should show `_genesis_title` and `_genesis_description` inside the `meta` object on any post:

```bash
curl -u "patty:APP_PASSWORD" \
  "https://orderandmore.com/wp-json/wp/v2/posts/2102" \
  | python3 -m json.tool | grep -A2 '"meta"'
```

If the fields appear with `null` (or her actual values if she's set them in TSF before), the shim is working.
