# ShipKit — Unified App Publishing MCP Server

> AI Agent-friendly unified app publishing for Google Play, Apple App Store, and 10+ Chinese Android stores.

## What is ShipKit?

ShipKit is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets AI agents (Claude Code, Cursor, Windsurf) publish apps to multiple app stores with a single command.

```
"Help me publish v2.1.0 to all Chinese Android stores"
```

## Supported Stores

| Store | Platform | API Support |
|-------|----------|-------------|
| Google Play | Android | Full API |
| Apple App Store | iOS | Full API |
| Huawei AppGallery | Android/HarmonyOS | Full API |
| Xiaomi | Android | API |
| OPPO | Android | API |
| vivo | Android | API + RPA |
| Tencent MyApp | Android | API + RPA |
| Samsung Galaxy | Android | Full API |

## Quick Start

### Claude Code
```bash
claude mcp add shipkit -- npx @nicetool/shipkit-mcp
```

### Claude Desktop / Cursor
Add to your MCP config:
```json
{
  "mcpServers": {
    "shipkit": {
      "command": "npx",
      "args": ["@nicetool/shipkit-mcp"],
      "env": {
        "SHIPKIT_API_KEY": "sk-xxx"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `app.publish` | Publish to one or multiple stores at once |
| `app.upload` | Upload APK/AAB/IPA/HAP build artifact |
| `app.status` | Query review status across all stores |
| `app.listing` | Manage store listing (title, description, screenshots) |
| `app.release` | Manage release tracks and rollout percentage |
| `store.list` | List supported stores and connection status |
| `store.connect` | Configure store credentials |
| `compliance.check` | Pre-submission compliance check |

## Architecture

See [docs](https://docs.readmigo.app/03-architecture/app-publishing-mcp-server) for full architecture documentation.

## License

MIT
