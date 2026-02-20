# ShipKit — Unified App Publishing MCP Server

[![npm version](https://badge.fury.io/js/@readmigo%2Fshipkit-mcp.svg)](https://badge.fury.io/js/@readmigo%2Fshipkit-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >= 18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> **AI Agent-friendly unified app publishing for Google Play, Apple App Store, Huawei AppGallery, and 10+ Chinese Android stores.**

ShipKit is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets AI agents (Claude Code, Cursor, Windsurf) publish apps to multiple app stores with a single natural language command. It eliminates manual publishing workflows by providing a unified API across vastly different platform requirements.

---

## What is ShipKit?

ShipKit bridges the gap between "Vibe Coding" (AI-assisted development) and "Vibe Shipping" (AI-assisted publishing). With ShipKit, you can ask your AI agent:

```
"Help me publish v2.1.0 to all stores"
```

And ShipKit handles the complexity: authentication, build artifact uploads, metadata translation, compliance checks, and multi-platform publishing orchestration.

**Why ShipKit?**
- **Unified Interface**: One MCP Server for 10+ app stores with wildly different APIs
- **AI-Native Design**: Built specifically for AI agents to understand, use, and automate
- **Multi-Region**: Global stores (Google Play, App Store) + China-specific distribution (小米, OPPO, vivo, etc.)
- **Compliance Built-In**: Pre-submission checks for ICP, privacy policies, and platform-specific requirements
- **Idempotent & Safe**: All operations support idempotency keys and provide detailed error recovery suggestions

---

## Supported Stores

| Store | Platform | Region | Authentication | Upload Format | Status |
|-------|----------|--------|-----------------|---------------|--------|
| Google Play | Android | Global | OAuth 2.0 Service Account | APK/AAB | ✅ Available |
| Apple App Store | iOS | Global | JWT (ES256) | IPA | ✅ Available |
| Huawei AppGallery | Android | Global/China | OAuth 2.0 | APK/AAB | ✅ Available |
| Xiaomi Store | Android | China | RSA Signature | APK/AAB | ✅ Available |
| OPPO Store | Android | China | OAuth Token | APK/AAB | ✅ Available |
| Honor App Market | Android | China | OAuth 2.0 | APK/AAB | ✅ Available |
| Pgyer (蒲公英) | Android/iOS | China | API Key | APK/IPA | ✅ Available |
| vivo Store | Android | China | API Key + RPA | APK/AAB | 🚧 In Development |
| Tencent MyApp (应用宝) | Android | China | AppKey + HMAC-MD5 | APK | 🚧 In Development |
| Samsung Galaxy Store | Android | Global | JWT Service Account | APK/AAB | 📋 Planned |
| HarmonyOS (鸿蒙) | HarmonyOS | China | OAuth 2.0 (via Huawei) | HAP | 📋 Planned |
| Meizu Store | Android | China | Custom | APK/AAB | 📋 Planned |

---

## Quick Start

### Installation for Claude Code

```bash
claude mcp add shipkit -- npx -y @readmigo/shipkit-mcp
```

### Installation for Claude Desktop / Cursor / Windsurf

Add to your MCP configuration file:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` or `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "shipkit": {
      "command": "npx",
      "args": ["@readmigo/shipkit-mcp"],
      "env": {
        "SHIPKIT_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "shipkit": {
      "command": "npx",
      "args": ["@readmigo/shipkit-mcp"],
      "env": {
        "SHIPKIT_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

### First-Time Setup: Connect Your Stores

You'll need to authenticate with each store. ShipKit stores credentials securely and handles token refresh automatically.

**Google Play Setup**

Create a service account in [Google Cloud Console](https://console.cloud.google.com/) and download the JSON key:

```bash
$ claude
> Connect me to Google Play
> I'll need your service account key...
```

Provide credentials as JSON:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-sa@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

**Apple App Store Setup**

Use App Store Connect API credentials (JWT-based):

```json
{
  "issuerId": "your-issuer-id",
  "keyId": "your-key-id",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

**Huawei AppGallery Setup**

OAuth 2.0 credentials from [Huawei AppGallery Connect](https://appgallery.huawei.com/):

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret"
}
```

---

## Usage Examples

### Example 1: First Connection to Google Play

```
User: I want to set up Google Play publishing. Where do I start?

Claude: I'll help you connect ShipKit to Google Play. First, let me check what
stores you have configured.

> store.list()
Connected stores: []

No stores connected yet. Let me guide you through setting up Google Play:

1. Go to Google Cloud Console (https://console.cloud.google.com/)
2. Create a new service account
3. Download the JSON key file
4. Paste the key contents when ready

User: [pastes JSON key]

Claude: Great! Let me configure this...

> store.connect({
    "store": "google_play",
    "credentials": { ... }
  })

✓ Google Play connected successfully!

Let me verify by listing your apps:

> store.list()
Connected stores:
  - google_play (3 apps: com.example.app, ...)
```

### Example 2: Check Status Across All Platforms

```
User: What's the status of v2.0.0 across all stores?

Claude: Let me check the review status for version 2.0.0...

> app.status({
    "app_id": "com.example.app",
    "version": "2.0.0"
  })

Status Report:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Store              Status           Days in Review    Notes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Google Play        IN_REVIEW        2                Automated review
Apple App Store    APPROVED         4                Live on App Store
Huawei AppGallery  APPROVED         5                Live in China
Xiaomi             REJECTED         -                Icon dimensions incorrect
OPPO               IN_REVIEW        1                Manual review queue
vivo               IN_QUEUE          0                Awaiting review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Xiaomi rejected due to icon requirements. Let me get specific feedback...

> compliance.check({
    "app_id": "com.example.app",
    "stores": ["xiaomi"]
  })

Compliance Issues:
- Icon: Must be square with 18px rounded corners (you have 16px)
- Privacy Policy: Link must be in Settings > About > Privacy Policy menu

Suggested fix: Update icon and resubmit to Xiaomi.
```

### Example 3: Publish New Version to All Stores

```
User: Release v2.1.0 to all stores

Claude: I'll help you release v2.1.0. Let me start by running compliance
checks across all platforms...

> compliance.check({
    "app_id": "com.example.app",
    "version": "2.1.0",
    "stores": "all"
  })

✓ All platforms passed compliance checks!

Now uploading builds...

> app.upload({
    "app_id": "com.example.app",
    "version": "2.1.0",
    "builds": [
      { "format": "aab", "path": "./build/app-release.aab" },
      { "format": "ipa", "path": "./build/app.ipa" }
    ]
  })

Upload Progress:
  Google Play          ████████████████████ 100%
  Apple App Store      ████████████████████ 100%
  Huawei AppGallery    ████████████████████ 100%
  Xiaomi               ████████████████████ 100%
  OPPO                 ████████████████████ 100%

All builds uploaded successfully!

Now publishing to all platforms...

> app.publish({
    "app_id": "com.example.app",
    "version": "2.1.0",
    "stores": "all",
    "rollout_percentage": 100
  })

Publishing Status:
  ✓ Google Play - Submitted for review
  ✓ Apple App Store - Awaiting manual review
  ✓ Huawei AppGallery - Live immediately
  ✓ Xiaomi - Submitted for review
  ✓ OPPO - Submitted for review
  ⏳ vivo - Queued for review

Release v2.1.0 submitted to all stores! I'll monitor progress and notify
you when reviews complete.
```

---

## MCP Tools Reference

ShipKit provides 8 core MCP tools for app publishing operations:

| Tool | Category | Description | Parameters | Status |
|------|----------|-------------|-----------|--------|
| `store.list` | Discovery | List all configured stores and their connection status | `app_id?` | ✅ Available |
| `store.connect` | Configuration | Configure and authenticate with an app store | `store`, `credentials`, `app_id?` | ✅ Available |
| `app.upload` | Publishing | Upload APK/AAB/IPA/HAP build artifacts to stores | `app_id`, `version`, `builds[]`, `stores?` | ✅ Available |
| `app.listing` | Metadata | View and update store listings (title, description, screenshots, etc.) | `app_id`, `action` (get/update), `store`, `locale?`, `content?` | ✅ Available |
| `app.release` | Publishing | Manage release tracks, phases, and rollout percentages | `app_id`, `version`, `stores`, `action` (create/update), `rollout_percentage?` | ✅ Available |
| `app.status` | Monitoring | Query review status, approval state, and analytics across platforms | `app_id`, `version?`, `stores?` | ✅ Available |
| `app.publish` | Publishing | Submit app for review or publish immediately to specified stores | `app_id`, `version`, `stores[]`, `release_track?`, `auto_publish?` | ✅ Available |
| `compliance.check` | Validation | Pre-submission compliance checks (ICP, privacy policy, icon specs, etc.) | `app_id`, `version?`, `stores[]` | ✅ Available |

---

## Architecture

ShipKit uses a modular adapter pattern to handle vastly different store APIs:

```
┌─────────────────────────────────────┐
│   AI Tools & CI/CD Integration      │
│  (Claude Code, Cursor, Windsurf)    │
│     GitHub Actions, etc.             │
└──────────────┬──────────────────────┘
               │
               │ MCP Protocol (JSON-RPC)
               │ REST API, CLI
               ▼
┌─────────────────────────────────────┐
│      ShipKit Core Orchestrator       │
│  • Authentication Manager (unified)  │
│  • Metadata Transformer              │
│  • Job Queue (async/idempotent)      │
│  • Compliance Engine                 │
└──────────────┬──────────────────────┘
               │
    ┌──────────┼──────────┬─────────┬─────────┐
    ▼          ▼          ▼         ▼         ▼
┌────────┐ ┌───────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ Google │ │Apple  │ │Huawei│ │Xiaomi│ │OPPO  │
│ Play   │ │App    │ │ AGC  │ │Store │ │Store │
│Adapter │ │Store  │ └──────┘ └──────┘ └──────┘
└────────┘ │Adapter│
           └───────┘

           ⋮ (vivo, Samsung, HarmonyOS, etc.)

           Plus RPA fallback for incomplete APIs
```

**Key Design Principles:**

1. **Unified Interface**: All stores implement the same `StoreAdapter` interface with methods like `authenticate()`, `uploadBuild()`, `publishRelease()`, `getStatus()`, etc.

2. **Store-Specific Handling**: Each store adapter encapsulates platform-specific details (API versions, authentication strategies, metadata requirements).

3. **Async Job Queue**: Long-running operations (uploads, reviews) are queued with exponential retry, progress tracking, and dead-letter handling.

4. **Idempotent Operations**: Every write operation accepts an `idempotency_key` to prevent duplicate submissions.

5. **Credential Management**: All store credentials are encrypted and stored server-side. AI agents never see raw credentials.

6. **RPA Fallback**: For stores without complete APIs, Playwright browser automation provides a fallback with anti-detection measures.

---

## Roadmap

### ✅ Completed (Current MVP)

- [x] Google Play adapter (full API support)
- [x] Apple App Store adapter (full API support)
- [x] Huawei AppGallery adapter (full API support)
- [x] Xiaomi Store adapter (API support)
- [x] OPPO Store adapter (API support)
- [x] Honor App Market adapter (API support)
- [x] Pgyer adapter (test distribution)
- [x] MCP Server with 8 core tools
- [x] CLI tool (shipkit command)
- [x] Basic compliance checks (ICP, privacy policy)
- [x] TypeScript SDK

### 🚧 In Development (Next Quarter)

- [ ] vivo Store adapter (API + RPA hybrid)
- [ ] Tencent MyApp adapter (API + RPA hybrid)
- [ ] Enhanced compliance engine (app permissions, content ratings)
- [ ] Web dashboard for monitoring and manual intervention
- [ ] Webhook support for CI/CD integration
- [ ] Multi-account management (team collaboration)

### 📋 Planned (Later Phases)

- [ ] Samsung Galaxy Store adapter
- [ ] HarmonyOS adapter (鸿蒙 NEXT)
- [ ] Meizu Store adapter
- [ ] Build registry integration (artifact storage/versioning)
- [ ] Analytics aggregation (downloads, ratings, reviews across stores)
- [ ] Python SDK
- [ ] REST API v1.0 (stable release)
- [ ] Commercial hosting/SaaS option

---

## Contributing

### Adding a New Store Adapter

ShipKit is designed to be extensible. Here's how to add support for a new store:

1. **Create adapter file**: `src/adapters/[store-name]-adapter.ts`

2. **Implement `StoreAdapter` interface**:
   ```typescript
   export class NewStoreAdapter implements StoreAdapter {
     async authenticate(credentials: StoreCredentials): Promise<void>
     async uploadBuild(build: BuildArtifact): Promise<string>
     async createRelease(release: ReleaseConfig): Promise<string>
     async updateListing(listing: ListingUpdate): Promise<void>
     async submitForReview(version: string): Promise<void>
     async getStatus(version: string): Promise<ReviewStatus>
     async getAnalytics(version: string): Promise<Analytics>
   }
   ```

3. **Register adapter**: Add to `src/adapters/index.ts` and update `store.list()` tool

4. **Add tests**: Create test suite in `src/adapters/__tests__/[store-name].test.ts`

5. **Document**: Update this README and add store-specific docs to `docs/stores/`

For detailed adapter development guide, see the [Contributing section](https://github.com/readmigo/shipkit/issues) or open an issue.

---

## License

MIT — See [LICENSE](./LICENSE) for details

---

## Documentation

- **Full Architecture & Design**: [docs.readmigo.app/03-architecture/shipkit-design](https://docs.readmigo.app/03-architecture/shipkit-design)
- **Store Adapter Architecture**: [docs.readmigo.app/03-architecture/store-adapter-architecture](https://docs.readmigo.app/03-architecture/store-adapter-architecture)
- **MCP Protocol Specification**: [docs.readmigo.app/03-architecture/mcp-server-protocol-spec](https://docs.readmigo.app/03-architecture/mcp-server-protocol-spec)
- **API Design & AI Agent Integration**: [docs.readmigo.app/03-architecture/ai-agent-api-design](https://docs.readmigo.app/03-architecture/ai-agent-api-design)

---

## Support

- **Issues & Bug Reports**: [GitHub Issues](https://github.com/readmigo/shipkit/issues)
- **Discussions & Questions**: [GitHub Discussions](https://github.com/readmigo/shipkit/discussions)
- **Documentation Site**: [docs.readmigo.app/03-architecture/shipkit-design](https://docs.readmigo.app/03-architecture/shipkit-design)

---

**Built with ❤️ for AI-native app publishing**
