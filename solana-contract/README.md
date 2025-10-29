# MinionLab Task Program

This folder contains a reference Solana program that powers MinionLab’s browser cluster attestation and reward accounting flow.

## Highlights

- **Network configuration PDA** – stores the MinionLab authority and reward mint used for payouts.
- **Node accounts** – each approved device/browser instance is registered on-chain with its own PDA, tracking completed jobs and pending rewards.
- **Task submissions** – nodes write task fingerprints (hashes) on-chain after finishing a scrape. The program records reward units owed and timestamps for auditability.
- **Reward settlement** – once an off-chain payout occurs, the authority clears pending rewards via the `ClaimReward` instruction, ensuring on-chain balances match real-world payouts.

## Building

```bash
cargo build-bpf
```

Ensure you have the Solana toolchain installed and configured (`solana install init`). The resulting program binary can be deployed with the standard Solana CLI commands.

## Integration Notes

- The Playwright demo can invoke `SubmitTask` after each successful scrape to record work on-chain.
- Only the MinionLab authority (defined in the config PDA) can register new nodes or clear rewards, allowing strict control for “machine audit” compliance.
