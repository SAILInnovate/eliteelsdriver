/**
 * Signed URLs for the `audits` bucket.
 *
 * That bucket holds chauffeurs' identity documents, so it is private (see
 * the eliteels repo, migration 20260911100000_close_the_audits_bucket.sql). Nothing in
 * it can be addressed by a plain URL any more: every <img>, <video> and
 * download link has to mint a short-lived signed URL first, and the signing
 * respects RLS, so a caller only gets a link to a file they were already
 * allowed to read.
 *
 * Two shapes of value are stored in the database and both arrive here:
 *   - rows written before this change hold a full public URL
 *   - rows written since hold the bare object path
 * objectPath() flattens the difference, so no backfill was needed.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const AUDITS_BUCKET = 'audits';

const PUBLIC_MARKER = '/storage/v1/object/public/';

/** The object's path inside the bucket, from either a legacy public URL or a path. */
export function objectPath(stored, bucket = AUDITS_BUCKET) {
  if (!stored) return null;
  const marker = stored.indexOf(PUBLIC_MARKER);
  if (marker === -1) return stored.replace(/^\/+/, '') || null;
  const afterMarker = stored.slice(marker + PUBLIC_MARKER.length);
  const withoutBucket = afterMarker.startsWith(`${bucket}/`)
    ? afterMarker.slice(bucket.length + 1)
    : afterMarker;
  // Storage percent-encodes on the way out; createSignedUrl wants it raw.
  try { return decodeURIComponent(withoutBucket) || null; } catch { return withoutBucket || null; }
}

/**
 * A signed URL for `stored`, or null if it cannot be signed — which for a
 * private bucket usually means the caller is not allowed to see it. Callers
 * render a placeholder on null rather than a broken image.
 */
export async function signedUrl(stored, { bucket = AUDITS_BUCKET, expiresIn = 3600 } = {}) {
  const path = objectPath(stored, bucket);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) {
    console.warn(`Could not sign ${bucket}/${path}:`, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Sign several at once, keyed the same way they came in. */
export async function signedUrlMap(storedByKey, opts) {
  const entries = await Promise.all(
    Object.entries(storedByKey || {}).map(async ([key, stored]) => [key, await signedUrl(stored, opts)])
  );
  return Object.fromEntries(entries.filter(([, url]) => url));
}

/** Signed URL for one stored value, re-signed whenever that value changes. */
export function useSignedUrl(stored, opts) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!stored) { setUrl(null); return; }
    signedUrl(stored, opts).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
    // opts is a literal at every call site; `stored` is what actually changes.
  }, [stored]);
  return url;
}
