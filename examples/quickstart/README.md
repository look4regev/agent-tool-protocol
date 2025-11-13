# Quickstart Example

A complete end-to-end example demonstrating OpenAPI and MCP integration with the Agent Tool Protocol.

## Features

- ✅ OpenAPI/Swagger 2.0 support (Petstore API)
- ✅ MCP integration (Playwright)
- ✅ Data filtering, mapping, and transformation
- ✅ Self-contained (no external server required)

## Usage

```bash
npm start
```

## What it does

1. Starts an ATP server
2. Loads the Petstore API from OpenAPI spec
3. Connects to Playwright MCP server
4. Executes code that:
   - Fetches pets from the Petstore API
   - Filters and maps pet categories
   - Returns aggregated results

## Environment Variables

None required. The example uses a default JWT secret for development.
