# MinionLab Edge Browser Demo

## Overview

MinionLab is a decentralized network of autonomous AI agents—called “Minions”—that run on user devices to mine real-time data from the internet. These Minions replicate human-like browsing behavior using a customized browser runtime, enabling advanced data collection, automation, and AI-driven exploration. In return, device owners earn \$MINION tokens for supporting the network and powering these autonomous data-mining agents.

This repository showcases how the MinionLab browser cluster can be driven programmatically using Playwright. The demo connects to MinionLab’s decentralized infrastructure and orchestrates multiple concurrent scraping tasks against targets such as Twitter profiles. It illustrates how to leverage the network’s distributed browsers for resilient, high-fidelity data collection.

## Why MinionLab?

- **Decentralized architecture:** MinionLab is built on top of the Solana community and leverages real user devices to form a geographically distributed browser cluster.
- **Human-like automation:** Customized browser runtimes mimic organic browsing behavior, yielding higher-quality data and reduced detection.
- **Tokenized incentives:** Contributors earn \$MINION tokens by lending idle compute resources to power autonomous “Minion” agents.
- **Scalable data pipelines:** Decentralization removes the bottlenecks of traditional scraping infrastructure, delivering a more resilient and cost-effective solution.

MinionLab was designed to close the growing gap between AI’s demand for high-quality data and the centralized, inefficient scraping solutions that still dominate the market today. By harnessing idle computing resources, MinionLab provides a scalable, user-driven foundation for autonomous data mining and next-generation AI applications.

## Project Structure

- `index.mjs` – Entry point that connects to the MinionLab browser network via Playwright, manages concurrency, and performs the scraping workflow.
- `package.json` – NPM metadata and dependencies; primarily `playwright` for browser automation.
- `node_modules/` – Installed dependencies (generated via `npm install`).

## Prerequisites

- Node.js 20+
- Valid MinionLab API key with access to the decentralized browser cluster
- Network access to the MinionLab WebSocket endpoint (`wss://*.browsers.live`)

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables as needed (e.g., `USERNAMES`, `CONCURRENCY`, `MAX_TWEETS`).
3. Run the demo:
   ```bash
   node index.mjs
   ```

The script will spin up concurrent Playwright sessions against the MinionLab cluster, scrape Twitter profile data, and log structured results to the console.

## Notes

- Ensure your environment can resolve and reach the MinionLab WebSocket endpoints; corporate networks or sandboxed environments may block the connection.
- The included API key in the example script is for demonstration only—replace it with your own credentials before running in production.

## License

This project is provided under the ISC license. Refer to `package.json` for details.
