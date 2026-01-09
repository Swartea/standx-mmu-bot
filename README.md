# StandX MMU Bot

A simple market-maker / uptime bot for StandX perps.  
It places **resting limit orders** around the mark price (BPS mode by default) and refreshes them periodically.

> ⚠️ Use at your own risk. Trading/perps are risky and you can get filled unexpectedly.

---

## Features

- Places **laddered** limit orders (e.g. 2 levels on each side)
- Keeps orders within a target **bps band** (e.g. under 10 bps)
- Optional **quantity jitter** (small randomness within min/max bounds)
- Basic monitoring logs for REFRESH / HOLD / missing orders

---

## Requirements

- Node.js 18+ (recommended)
- npm
- A funded StandX account / wallet capable of placing orders

---

## Install

```bash
npm install
