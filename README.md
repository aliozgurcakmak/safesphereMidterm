# SafeSphere

SafeSphere is a web-based disaster management dashboard designed for Turkey-focused disaster response operations. It displays disasters, alerts, rescue teams, resource stocks, resource allocations, damage reports, casualty reports, warehouses, and live map markers from a SQL Server database.

## Prerequisites

1. Make sure **SQL Server Express** is running.
2. The Database name must be **SafeSphereDB**.
3. The Server name should be `.\SQLEXPRESS`.
4. Authentication should be **Windows Authentication**.
5. Node.js installed.

## Setup Instructions

1. Navigate to the `server` directory:
   ```bash
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start server:
   ```bash
   npm start
   ```
   *(You can also use `node server.js`)*

4. Open your browser and go to:
   ```
   http://localhost:3000
   ```

## Database Connection Notes

This project uses `msnodesqlv8` for reliable Windows Authentication support.

If Windows Authentication fails:
- Install **ODBC Driver 17 for SQL Server**.
- Ensure the connection string in `.env` or `server/db.js` matches your local setup.

## Features

- Real-time crisis management platform
- Dark emergency command center design
- Live interactive map using Leaflet.js
- Dynamic dashboard KPI counters and charts (Chart.js)
- REST API communicating with SQL Server

