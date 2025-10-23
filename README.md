# MinionLab MCP Server

## Get Started

1. Run `npm install` to install the necessary dependencies, then run `npm run build` to get `dist/src/index.js`.

2. Set up your Claude Desktop configuration to use the server.

```json
{
  "mcpServers": {
    "minionlab-mcp-demo": {
      "command": "node",
      "args": ["/Users/Apple/Developer/minionlab-mcp-demo-x/dist/src/index.js"],
      "env": {
        "EDGE_IDS": "2ef67d1859e83183", // edge ids
        "X_EDGEID": "2ef67d1859e83183", // send tweets to this edge id
        "X_EMAIL": "maoring21@gmail.com", // tweet email (Please make sure that the current ip has logged into the account before, otherwise the email verification code may appear)
        "X_USERNAME": "jucatyo", // tweet username
        "X_PASSWORD": "xxxx" // tweet password
      }
    }
  }
}
```

3. Restart your Claude Desktop app and you should see the tools available clicking the 🔨 icon.

4. Start using the tools!

## Tools

### Playwright MCP Server Tools

- **open_browsers**

  - Open multiple browser instances using Playwright
  - No input parameters required

- **get_web3_hotspot**

  - Get Web3 hotspot information, extract latest tweets from KOLs and organize them into Web3 updates
  - No input parameters required

- **browser_console_logs**

  - Get browser console logs
  - Input: `random_string` (string, placeholder only)

- **take_screenshot**

  - Take screenshots of one or multiple browsers
  - Input:
    - `tasks` (array): Array of screenshot tasks, each containing:
      - `edgeId` (string, required): Browser instance ID
      - `name` (string, required): Name for the screenshot
      - `selector` (string, optional): CSS selector for element to screenshot
      - `fullPage` (boolean, optional): Whether to take a screenshot of the full page, default: false

- **navigate_to_url**
  - Navigate one or multiple browsers to specific URLs
  - Input:
    - `tasks` (array): Array of navigation tasks, each containing:
      - `edgeId` (string, required): Browser instance ID
      - `url` (string, required): URL to navigate to
      - `waitUntil` (string, optional): When to consider navigation succeeded, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default: 'load'

### Usage Examples

1. **Multiple Browser Screenshots**:

```json
{
  "tasks": [
    {
      "edgeId": "edge1",
      "name": "homepage",
      "fullPage": true
    },
    {
      "edgeId": "edge2",
      "name": "login-form",
      "selector": "#login-form"
    }
  ]
}
```

2. **Multiple Browser Navigation**:

```json
{
  "tasks": [
    {
      "edgeId": "edge1",
      "url": "https://example.com"
    },
    {
      "edgeId": "edge2",
      "url": "https://example.org",
      "waitUntil": "networkidle"
    }
  ]
}
```

### Resources

The server provides access to two types of resources:

1. **Console Logs** (`console://logs`)

   - Browser console output in text format
   - Includes all console messages from the browser

2. **Screenshots** (`screenshot://<name>`)
   - PNG images of captured screenshots
   - Accessible via the screenshot name specified during capture

## Key Features

- Multiple browser instance management
- Web data extraction
- Console log monitoring
- Screenshot capabilities
- Basic web interaction (navigation)
- Support for batch processing of multiple browser tasks
- Web3 hotspot information retrieval

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
