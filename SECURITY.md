# Security Policy

## Supported Versions

Only the latest `1.x` release line receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Please do **not** open a public issue for security problems.

- Email: lZiMUl@lzimul.com
- Or use GitHub's private vulnerability reporting on
  <https://github.com/lZiMUl/minecraft-mcp/security/advisories/new>

Include the affected version, a minimal reproduction (tool call, resource URI
or world snapshot), and the impact you observed. You can expect an initial
response within a few days. Please allow time for a fix and release before
disclosing the issue publicly.

## Scope

The server is designed to run locally over stdio. Reports that are in scope
include, but are not limited to:

- Prototype pollution or code execution through block ids, block states or
  snapshot files
- Path traversal or arbitrary file writes through `MCP_WORLD_DIR`
- Denial of service through oversized tool input or snapshots
- Data loss when persisting world state

The following are generally out of scope: running the server with an
untrusted `MCP_WORLD_DIR`, modifying files on disk without restarting the
server, and issues that require an already-compromised host.
