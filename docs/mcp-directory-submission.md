# MCP Directory Submission Materials

## Basic Information

**Name**: ShipKit

**Tagline (EN)**: AI Agent-friendly unified app publishing for Google Play, Apple App Store, and 10+ Chinese Android stores

**Tagline (CN)**: AI Agent 友好的统一应用发布工具，支持 Google Play、App Store 及 10+ 中国 Android 应用商店

**Category**: Developer Tools / Mobile / CI/CD

**Tags**: mcp, app-publishing, google-play, apple-app-store, android, ios, china, mobile, ci-cd, automation

**License**: MIT

**Repository**: https://github.com/readmigo/shipkit

**npm**: https://www.npmjs.com/package/@readmigo/shipkit-mcp

**Supported Platforms**: Claude Code, Claude Desktop, Cursor, Windsurf

---

## Description (EN, ~200 words)

ShipKit is an MCP Server that lets AI agents publish apps to multiple app stores with a single natural language command. It provides a unified interface across Google Play, Apple App Store, Huawei AppGallery, and 10+ Chinese Android stores (Xiaomi, OPPO, vivo, Honor, Tencent MyApp).

Key features:
- Unified multi-store publishing with a single MCP connection
- Full artifact upload (AAB/IPA) to Google Play and Apple App Store
- Built-in compliance engine with ICP, PIPL, and store-specific checks
- Idempotent operations with retry and error recovery
- China market compliance guidance (regulations, filing requirements)
- Web dashboard for monitoring and manual intervention

---

## Install Command

```
npx @readmigo/shipkit-mcp
```

## MCP Config

```json
{
  "mcpServers": {
    "shipkit": {
      "command": "npx",
      "args": ["@readmigo/shipkit-mcp"]
    }
  }
}
```

---

## Tools (8 total)

| Tool | Description |
|------|-------------|
| store.list | List all configured stores and their connection status |
| store.connect | Configure and authenticate with an app store |
| app.upload | Upload APK/AAB/IPA build artifacts to stores |
| app.listing | View and update store listings (metadata, screenshots) |
| app.release | Manage release tracks, rollout percentages |
| app.status | Query review status across all platforms |
| app.publish | Submit for review or publish to specified stores |
| compliance.check | Pre-submission compliance checks (ICP, PIPL, privacy) |

---

## Directory-Specific Notes

### smithery.ai

Requires `smithery.yaml` in project root (already created).

Configuration schema exposes `SHIPKIT_API_KEY` as optional environment variable.

### glama.ai

Auto-scrapes from npm/GitHub. Ensure `package.json` keywords and README are up to date. No manual submission file needed.

### mcp.so

Submit the GitHub repository URL: https://github.com/readmigo/shipkit

The directory auto-parses repository metadata.

### pulsemcp.com

Manual submission required. Use the description, tools list, and MCP config from this document.

---

## Submission Checklist

- [ ] npm package published: `@readmigo/shipkit-mcp`
- [ ] GitHub repository public: `readmigo/shipkit`
- [ ] smithery.ai: Submit via https://smithery.ai/submit with `smithery.yaml`
- [ ] glama.ai: Verify auto-indexed after npm publish
- [ ] mcp.so: Submit repository URL
- [ ] pulsemcp.com: Manual submission with above materials
