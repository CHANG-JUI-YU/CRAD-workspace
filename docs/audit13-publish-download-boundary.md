# Publish download binary-response boundary

Issue #209 removes the base64 JSON transport and Dashboard-side `atob`/byte-copy loop. The download route now sends the verified runtime `Uint8Array` directly as the HTTP response body with the artifact media type, attachment disposition, and content length.

This change intentionally does not add streaming. `WorkspaceRuntime.publishDownload()` verifies the content-addressed blob by length and SHA-256 before returning it, so the runtime currently materializes one verified `Uint8Array` for the artifact. The HTTP layer wraps that same backing range in a `Buffer` without a JavaScript byte-by-byte copy. Streaming would require a repository API that can verify integrity while reading incrementally; that is outside #209 and should be introduced only with measurements and an explicit integrity contract.

The practical memory boundary is therefore one artifact-sized runtime byte array plus Node/browser transport buffers. It no longer includes the additional base64 string, decoded binary string, JavaScript copy loop, and duplicate typed-array allocation that existed in the previous Dashboard path.
