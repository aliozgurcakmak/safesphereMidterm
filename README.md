# SafeSphere Disaster Management System

SafeSphere is a web-based disaster management and emergency response dashboard developed for disaster operations in Türkiye. The system provides a centralized platform for monitoring disasters, managing emergency resources, coordinating rescue teams, tracking casualties and damage reports, and supporting decision-making during crisis situations.

The platform integrates real-time disaster information, interactive maps, emergency resource management, warehouse monitoring, and reporting tools within a single interface designed for emergency managers, rescue teams, NGOs, and administrators.

## Features

* Disaster monitoring and management
* Interactive disaster map using Leaflet.js
* Rescue team coordination
* Resource stock and allocation management
* Warehouse management
* Casualty and damage reporting
* Emergency alerts and notifications
* Role-based access control
* Dashboard KPI monitoring
* REST API integration with Microsoft SQL Server
* Dark-themed emergency command center interface

## Technology Stack

| Layer             | Technologies                    |
| ----------------- | ------------------------------- |
| Front-end         | HTML5, CSS3, JavaScript         |
| Back-end          | Node.js, Express.js             |
| Database          | Microsoft SQL Server            |
| Visualization     | Chart.js                        |
| Mapping           | Leaflet.js                      |
| Development Tools | Visual Studio Code, Git, GitHub |

## Prerequisites

Before running the application, ensure that the following software is installed:

* Node.js
* Microsoft SQL Server Express
* ODBC Driver 17 for SQL Server
* Git (optional)

## Database Configuration

The application is configured to use Microsoft SQL Server with Windows Authentication.

Default configuration:

```text
Server Name: .\SQLEXPRESS
Database Name: SafeSphereDB
Authentication: Windows Authentication
```

If your SQL Server configuration is different, update the connection settings in:

```text
server/db.js
```

or

```text
server/.env
```

## Installation

Navigate to the server directory:

```bash
cd server
```

Install project dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

Alternatively:

```bash
node server.js
```

## Running the Application

Open your browser and navigate to:

```text
http://localhost:3000
```

The SafeSphere dashboard should now be available.

## Project Structure

```text
safesphere/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── server/
│   ├── server.js
│   ├── db.js
│   ├── package.json
│   └── provinces.json
│
└── README.md
```

## Database Connection Notes

This project uses **msnodesqlv8** to provide reliable Microsoft SQL Server connectivity through Windows Authentication.

If database connectivity issues occur:

1. Verify that SQL Server Express is running.
2. Verify that SafeSphereDB exists.
3. Install ODBC Driver 17 for SQL Server.
4. Check connection settings in `server/db.js`.
5. Verify Windows Authentication permissions.

## Authors

* Ali Özgür Çakmak
* Aral Gülmen
* Rameen Khan
* Ömer Faruk Özdemir
* Yiğit Yücekurt

## Course Information

MISY2244 – Information Systems Analysis and Design

FMV Işık University

Instructor: Dr. Habibe Aktay

2026
