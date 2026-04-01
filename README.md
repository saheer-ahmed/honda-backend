# Honda Door-to-Door Service Platform

> Full-stack service management app — Node.js/Express backend + React frontend  
> Real-time via Socket.io · Push via Firebase FCM · Auth via JWT · DB via PostgreSQL

---

## Architecture

```
honda-service/
├── honda-backend/          ← Node.js API server
│   ├── server.js           ← Entry point
│   ├── routes/index.js     ← All API routes
│   ├── controllers/        ← Business logic
│   │   ├── authController.js
│   │   ├── jobController.js
│   │   ├── inspectionController.js
│   │   ├── quotationController.js
│   │   └── notificationController.js
│   ├── middleware/
│   │   ├── auth.js         ← JWT + role guards
│   │   ├── validate.js     ← express-validator
│   │   └── errorHandler.js
│   ├── socket/index.js     ← Socket.io server
│   ├── config/
│   │   ├── db.js           ← PostgreSQL pool
│   │   ├── firebase.js     ← FCM admin SDK
│   │   └── logger.js       ← Winston
│   └── db/
│       ├── schema.sql      ← Full DB schema
│       ├── migrate.js      ← Run migrations
│       └── seed.js         ← Test data + credentials
│
└── honda-app/              ← Vite + React frontend
    └── src/
        ├── App.jsx                 ← Auth router
        ├── context/AuthContext.jsx ← Auth state + JWT
        ├── lib/
        │   ├── api.js              ← All API calls + auto-refresh
        │   └── socket.js           ← Socket.io client
        ├── hooks/useSocket.js      ← Real-time hook
        └── pages/
            ├── Login.jsx           ← Dark login page
            ├── Dashboard.jsx       ← Coordinator view
            ├── CustomerPortal.jsx  ← Customer tracking
            └── DriverApp.jsx       ← Mobile driver app
```

---

## Quickstart

### 1. PostgreSQL

```bash
psql -U postgres
CREATE DATABASE honda_service;
\q
```

### 2. Backend

```bash
cd honda-backend
cp .env.example .env          # Edit DB credentials
npm install

# Apply schema
node db/migrate.js

# Seed test data
node db/seed.js

# Start dev server
npm run dev
```

Server starts at **http://localhost:4000**

### 3. Frontend

```bash
cd honda-app
cp honda-backend/frontend-src/.env.example .env

# Install socket.io-client
npm install socket.io-client

# Copy source files
cp honda-backend/frontend-src/lib/api.js          src/lib/api.js
cp honda-backend/frontend-src/lib/socket.js       src/lib/socket.js
cp honda-backend/frontend-src/context/AuthContext.jsx src/context/AuthContext.jsx
cp honda-backend/frontend-src/hooks/useSocket.js  src/hooks/useSocket.js
cp honda-backend/frontend-src/pages/Login.jsx     src/pages/Login.jsx
cp honda-backend/frontend-src/pages/DriverApp.jsx src/pages/DriverApp.jsx
cp honda-backend/frontend-src/App.jsx             src/App.jsx

mkdir -p src/lib src/context src/hooks src/pages

npm run dev
```

Frontend at **http://localhost:5173**

---

## Test Accounts (after seed)

| Role        | Email                       | Password     |
|-------------|----------------------------|--------------|
| Admin       | admin@honda-uae.com        | admin1234    |
| Coordinator | coordinator@honda-uae.com  | coord1234    |
| Driver      | driver@honda-uae.com       | driver1234   |
| Customer    | customer@example.com       | customer1234 |

---

## API Reference

### Auth
| Method | Endpoint            | Body                       | Auth |
|--------|---------------------|----------------------------|------|
| POST   | /auth/register      | name, email, phone, password, role | — |
| POST   | /auth/login         | email/phone, password, fcmToken | — |
| POST   | /auth/refresh       | refreshToken               | —    |
| POST   | /auth/logout        | refreshToken               | ✓    |
| GET    | /auth/me            | —                          | ✓    |
| PUT    | /auth/fcm-token     | fcmToken                   | ✓    |

### Jobs
| Method | Endpoint                  | Role        |
|--------|---------------------------|-------------|
| GET    | /jobs                     | All         |
| GET    | /jobs/stats               | Coordinator |
| GET    | /jobs/:id                 | Scoped      |
| POST   | /jobs                     | All         |
| PATCH  | /jobs/:id/status          | Driver+     |
| PATCH  | /jobs/:id/assign-driver   | Coordinator |
| POST   | /jobs/:id/rating          | Customer    |

### Inspections
| Method | Endpoint                        | Role   |
|--------|---------------------------------|--------|
| POST   | /inspections                    | Driver |
| POST   | /inspections/:jobId/photos      | Driver |
| POST   | /inspections/:jobId/sign        | Driver |
| GET    | /inspections/:jobId             | All    |

### Quotations
| Method | Endpoint                   | Role        |
|--------|----------------------------|-------------|
| POST   | /quotations                | Coordinator |
| POST   | /quotations/:id/respond    | Customer    |
| GET    | /quotations/job/:jobId     | All         |

### Vehicles & Drivers
| Method | Endpoint             | Role       |
|--------|----------------------|------------|
| GET    | /vehicles            | Customer   |
| POST   | /vehicles            | Customer+  |
| GET    | /drivers             | Coordinator|
| GET    | /drivers/:id/tasks   | Driver     |

---

## Socket.io Events

### Client → Server
| Event             | Payload               | Description              |
|-------------------|-----------------------|--------------------------|
| job:subscribe     | { jobId }             | Join job room            |
| job:unsubscribe   | { jobId }             | Leave job room           |
| driver:location   | { jobId, lat, lng }   | Broadcast GPS position   |
| driver:status     | { status }            | online / offline         |

### Server → Client
| Event                | Payload                        | Who receives        |
|----------------------|--------------------------------|---------------------|
| job:new              | { jobId, serviceType }         | Coordinators        |
| job:status_update    | { jobId, status, note }        | Job room + Coords   |
| quotation:new        | { jobId, total }               | Customer            |
| quotation:response   | { jobId, action }              | Job room            |
| task:new             | { jobId }                      | Driver              |
| driver:location      | { driverId, lat, lng }         | Job room            |
| driver:status        | { driverId, name, status }     | Coordinators        |

---

## Firebase FCM Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create project → Project Settings → Service Accounts
3. Generate Private Key → download JSON
4. Copy values into `.env`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

5. Add Firebase to frontend (optional for web push):

```bash
npm install firebase
```

---

## Production Checklist

- [ ] Set `NODE_ENV=production` and strong `JWT_SECRET`
- [ ] Enable `DB_SSL=true`
- [ ] Replace local file uploads with AWS S3 or Cloudinary
- [ ] Add Redis for refresh token store + Socket.io adapter
- [ ] Use PM2 or Docker for process management
- [ ] Set up Nginx reverse proxy
- [ ] Enable HTTPS / SSL certificate

---

## Status Flow

```
booking_confirmed → driver_assigned → vehicle_picked_up → inspection_done
    → at_workshop → in_progress ↔ waiting_approval → service_completed
        → ready_delivery → out_delivery → delivered
```
