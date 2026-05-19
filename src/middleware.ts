import { NextRequest, NextResponse } from "next/server";

/**
 * Password gate via HTTP Basic Auth. Browsers prompt once and cache the
 * credentials for the session. Simpler than cookie sessions for a
 * single-user portal, no extra deps required.
 *
 * Required env vars in production:
 *   PORTAL_PASSWORD — Patty's portal password
 *   PORTAL_USERNAME — defaults to "patty" if unset
 *
 * If PORTAL_PASSWORD is unset, the gate is open (useful for local dev where
 * the portal already isn't reachable from the public internet). We log a
 * loud warning at boot but don't block requests, so first-time setup isn't
 * blocked by missing env vars.
 */
export function middleware(req: NextRequest) {
  const password = process.env.PORTAL_PASSWORD;
  const username = process.env.PORTAL_USERNAME || "patty";

  // Health and Next internals are always open.
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname === "/api/health") {
    return NextResponse.next();
  }

  if (!password) {
    // No password configured — pass through. SETUP.md tells Patty to set this
    // before going to production; locally we warn once.
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization") || "";
  const expected =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  if (auth !== expected) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Patty Blog Portal"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
