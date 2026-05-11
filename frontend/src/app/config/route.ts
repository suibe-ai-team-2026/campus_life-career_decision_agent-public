import { NextRequest, NextResponse } from 'next/server'

/**
 * Runtime Configuration Endpoint
 *
 * This endpoint provides server-side environment variables to the client at runtime.
 * This solves the NEXT_PUBLIC_* limitation where variables are baked into the build.
 *
 * Environment Variables:
 * - API_URL: Optional public API base URL for split frontend/API deployments
 * - INTERNAL_API_URL: Where Next.js server-side should proxy API requests (internal URL)
 *   Default: http://localhost:5055 (used by Next.js rewrites in next.config.ts)
 *
 * Why two different variables?
 * - API_URL: Used by browser clients only when API is intentionally exposed separately
 * - INTERNAL_API_URL: Used by Next.js rewrites for server-side proxying, typically http://localhost:5055
 *
 * Default behavior returns an empty string so the browser calls /api/* on the
 * same origin and Next.js proxies to INTERNAL_API_URL. That is safer for cloud
 * deployments because only the web port needs to be exposed publicly.
 */
export async function GET(request: NextRequest) {
  // Priority 1: Check if API_URL is explicitly set
  const envApiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

  if (envApiUrl) {
    return NextResponse.json({
      apiUrl: envApiUrl,
    })
  }

  // Priority 2: Default to same-origin API calls through Next.js rewrites.
  // Keep a small log with the observed host to help deployment debugging.
  try {
    const proto = request.headers.get('x-forwarded-proto') ||
                  request.nextUrl.protocol.replace(':', '') ||
                  'http'
    const hostHeader = request.headers.get('host')

    if (hostHeader) {
      console.log(`[runtime-config] Using same-origin API proxy (proto=${proto}, host=${hostHeader})`)
    }
  } catch (error) {
    console.error('[runtime-config] Request inspection failed:', error)
  }

  return NextResponse.json({
    apiUrl: '',
  })
}
