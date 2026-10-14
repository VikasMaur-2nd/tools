import Link from 'next/link';
import { Code } from '../blogs/article';
import { SOURCES } from './errors';

export default function HttpExamples() {
  return (
    <>
      <h3>Inspect a fetch response before parsing</h3>
      <p>
        <a href={SOURCES.fetch}>Fetch does not reject for HTTP error statuses</a>. Read the body once as text, inspect it during
        local debugging, then check status and media type. The 204 branch below returns null as an application choice; adapt
        it to your API contract. Remove debugging output after diagnosis and redact sensitive values before sharing logs.
      </p>
      <Code lang="javascript">{`async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text(); // read the body only once
  console.debug(res.status, res.url, res.headers.get('content-type'));
  console.debug(text.slice(0, 200)); // local debugging only
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (res.status === 204) return null; // only for a documented no-body result
  const type = (res.headers.get('content-type') || '')
    .split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !/^application\\/[^/]+\\+json$/.test(type)) {
    throw new Error('Expected JSON, received ' + (type || 'no Content-Type'));
  }
  if (!text.trim()) throw new Error('Expected JSON, received an empty body');
  return JSON.parse(text);
}`}</Code>
      <h3>Inspect a Python requests response</h3>
      <p>
        Print <code>r.status_code</code>, <code>r.headers</code> and a preview of <code>r.text</code> before decoding.
        The <a href={SOURCES.requests}>Requests documentation</a> explains why an empty response or invalid JSON can
        fail decoding even when the HTTP request itself succeeds.
      </p>
      <Code lang="python">{`import json
import requests

def fetch_json(url):
    r = requests.get(url, headers={"Accept": "application/json"}, timeout=15)
    print(r.status_code, r.url, r.headers.get("Content-Type"))
    print(repr(r.text[:200]))  # local debugging only
    r.raise_for_status()
    if r.status_code == 204:
        return None  # only for a documented no-body result
    media_type = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
    is_json = media_type == "application/json" or (
        media_type.startswith("application/") and media_type.endswith("+json")
    )
    if not is_json:
        raise ValueError(f"Expected JSON, received {media_type or 'no Content-Type'}")
    if not r.text.strip():
        raise ValueError("Expected JSON, received an empty body")
    return json.loads(r.text)`}</Code>
      <h3>Check the Go response before unmarshalling</h3>
      <p>
        Read and close the body, check status and media type, then use <code>json.Unmarshal</code> for one complete
        document. A <code>SyntaxError.Offset</code> counts bytes read. For a stream of records, use the{' '}
        <Link prefetch={false} href="/json-errors/extra-data">multiple-values workflow</Link> instead.
      </p>
      <Code lang="go">{`package main

import (
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "mime"
    "net/http"
    "strings"
    "time"
)

func fetchJSON(url string) (any, error) {
    client := &http.Client{Timeout: 15 * time.Second}
    resp, err := client.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    if err != nil { return nil, err }
    preview := body
    if len(preview) > 200 { preview = preview[:200] }
    fmt.Printf("status=%d type=%q body=%q\\n", resp.StatusCode,
        resp.Header.Get("Content-Type"), preview) // local debugging only
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
    }
    if resp.StatusCode == http.StatusNoContent { return nil, nil }
    mediaType, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
    if err != nil { return nil, fmt.Errorf("invalid Content-Type: %w", err) }
    if mediaType != "application/json" &&
        !(strings.HasPrefix(mediaType, "application/") && strings.HasSuffix(mediaType, "+json")) {
        return nil, fmt.Errorf("expected JSON, received %s", mediaType)
    }
    var value any
    if err := json.Unmarshal(body, &value); err != nil {
        var syntax *json.SyntaxError
        if errors.As(err, &syntax) {
            return nil, fmt.Errorf("JSON error after byte %d: %w", syntax.Offset, err)
        }
        return nil, err
    }
    return value, nil
}

func main() {
    value, err := fetchJSON("https://example.com/api/data")
    if err != nil { fmt.Println(err); return }
    fmt.Println(value)
}`}</Code>
    </>
  );
}
