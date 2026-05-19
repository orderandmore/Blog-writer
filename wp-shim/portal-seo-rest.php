<?php
/**
 * Plugin Name: Portal SEO REST Exposer
 * Description: Exposes The SEO Framework's _genesis_title and _genesis_description
 *              meta fields to the WordPress REST API so the Patty Blog Portal
 *              can set them when creating posts. Loaded automatically as an
 *              mu-plugin — no activation step.
 * Version: 1.0.0
 * Author: Patty Blog Portal
 *
 * INSTALLATION:
 *   Upload this file to:  /wp-content/mu-plugins/portal-seo-rest.php
 *
 *   If the mu-plugins/ directory doesn't exist yet, create it. WordPress
 *   loads everything in mu-plugins/ automatically — no need to "activate"
 *   anything in the admin.
 *
 * VERIFICATION:
 *   After uploading, this curl (replace credentials) should show _genesis_*
 *   keys inside the "meta" object on any post:
 *
 *     curl -u "patty:APP_PASSWORD" \
 *       "https://orderandmore.com/wp-json/wp/v2/posts/2102" \
 *       | grep -o "_genesis_[a-z]*"
 *
 * SCOPE:
 *   Only exposes the two fields the portal actively writes. The SEO
 *   Framework stores more (OG/Twitter overrides, canonical, noindex flags,
 *   etc.); add them here if the portal ever needs to set them too.
 */

add_action( 'init', function () {
	$shared = [
		'show_in_rest'      => true,
		'single'            => true,
		'type'              => 'string',
		'auth_callback'     => function () {
			return current_user_can( 'edit_posts' );
		},
	];

	// SEO title (overrides the WordPress post title in <title> tags + OG/Twitter title fallback).
	register_post_meta( 'post', '_genesis_title', $shared );

	// Meta description (used in <meta name="description">, OG description fallback, Twitter description fallback).
	register_post_meta( 'post', '_genesis_description', $shared );
} );
