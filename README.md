# deno-simple-fetch

A simple HTTP client for Deno with connection pooling and manual redirect handling.

### Why this library?

* **Control over redirects**: Inspect and handle 302/3xx responses manually
* **Memory efficient**: Bodies only loaded into memory when consumed, with streaming support
* **Connection pooling**: Automatic reuse of connections per origin
* **Resource management**: Proper cleanup with `Symbol.asyncDispose` support
* **Standard API**: Drop-in replacement for fetch with additional control

Perfect for building scrapers and API testing tools where you need full control over the HTTP flow.

### Limitations

* `HTTP/1.1` only
* `multipart/form-data` not supported

## Basic usage

```ts
import { createFetch } from './src/fetch.ts';

await using fetch = createFetch();
const response = await fetch('https://api.example.com/data');
const data = await response.json();
```

## Key differences from standard fetch

### 1. Manual redirect handling (no automatic following)

The library **does not automatically follow redirects**, giving you full control to inspect and handle 302 responses:

```ts
await using fetch = createFetch();

// Make request to an endpoint that returns a 302 redirect
const response = await fetch('https://example.com/redirect-endpoint');

if (response.status === 302) {
  // Access the Location header to see where the redirect points
  const location = response.headers.get('location');
  console.log('Redirect location:', location);

  // Follow manually if desired
  if (location) {
    const redirectUrl = new URL(location, response.url);
    const finalResponse = await fetch(redirectUrl);
  }
}
```

### 2. Memory-efficient body handling

**Response bodies are only read into memory when you explicitly consume them.** This prevents unnecessary memory usage and allows for efficient streaming:

```ts
await using fetch = createFetch();

const response = await fetch('https://api.example.com/large-file');

// Headers are available immediately, body hasn't been loaded into memory
console.log(response.status); // ✓ Available immediately
console.log(response.headers.get('content-length')); // ✓ Available immediately

// Option 1: Load entire body into memory
const data = await response.text(); // Now the body is read into memory

// Option 2: Stream the body for memory efficiency with large files
if (response.body) {
  for await (const chunk of body) {
    // Process chunk without loading entire response into memory
    console.log('Received chunk:', chunk.length, 'bytes');
  }
}
```

## Advanced usage

### HttpClient with configuration options

```ts
import { HttpClient } from './src/fetch.ts';

const customClient = new HttpClient({
  // Maximum connections per host (default: unlimited)
  poolMaxPerHost: 10,

  // Idle timeout for connections in milliseconds (default: 30000)
  // Set to false to disable timeout, not recommended.
  poolIdleTimeout: 60000
});

// Option 1: make a fetch bound to that client
await using fetch = createFetch(customClient);
const response = await fetch('https://api.example.com/data');

// Option 2: pass the client in the RequestInit
await using fetch = createFetch();
const response = await fetch('https://api.example.com/data', {
  client: customClient,
});
```

### Resource management

```ts
// Automatic cleanup with `using`
{
  await using fetch = createFetch();
  const response = await fetch('https://api.example.com/data');
  // fetch.close() called automatically when scope exits
}

// Manual cleanup
const fetch = createFetch();
try {
  const response = await fetch('https://api.example.com/data');
} finally {
  await fetch.close();
}
```
