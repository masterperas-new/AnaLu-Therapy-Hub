# AnaLu Therapy Hub - Local Node.js + SQLite

Local web app for managing patients, in-loco appointments, wire payment status, and monthly management reporting.

## Requirements

- Node.js 18+

## Setup

1. Install dependencies:
   npm install
2. Copy environment file:
   cp .env.example .env
3. Edit `.env` and set:
   - `APP_PASSWORD` to your login password
   - `SESSION_SECRET` to a long random value
3. Start in development mode:
   npm run dev

## Scripts

- `npm run dev` - Run with nodemon
- `npm start` - Run with node

## Main Features

- Password-protected access with session login
- Patient registry with condition notes
- In-loco appointment scheduling with fee amounts
- Wire payment status control (paid/owed)
- Monthly report showing:
   - total appointments
   - total cash
   - paid vs owed appointments
   - paid vs owed amounts

## API

Public:

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/auth/login` with `{ "password": "..." }`

Protected (session required):

- `POST /api/auth/logout`
- `GET /api/clients`
- `POST /api/clients`
- `GET /api/appointments?month=YYYY-MM`
- `POST /api/appointments`
- `PATCH /api/appointments/:id/wire-received`
- `GET /api/reports/monthly?month=YYYY-MM`

Open `http://localhost:3000` in your browser.
