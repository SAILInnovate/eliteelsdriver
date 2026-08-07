# Clinch Trust API Documentation

## Overview
The *Clinch Trust API* allows external platforms (marketplaces, gig economy apps, landlords) to programmatically check a user's reliability and create verified digital handshakes.

### Authentication
All API requests require an Authentication Bearer token generated from the Clinch developer portal.

`Authorization: Bearer <clinch_secret_key>`

---

## 1. Retrieve a Trust Score
Fetches the public "Trust Score" and "Verified Links" count for a specific phone number.

**Endpoint:** `GET /api/v1/trust-score`

**Query Parameters:**
- `phone`: (+ Country Code) Number to look up.

**Example Request (Node.js):**
```javascript
const response = await fetch('https://api.clinch.to/v1/trust-score?phone=+12025550123', {
  headers: { 'Authorization': 'Bearer YOUR_SECRET_KEY' }
});
const data = await response.json();
```

**Example Response:**
```json
{
  "status": "success",
  "data": {
    "phone": "+12025550123",
    "trustScore": 94,
    "verifiedLinks": 12,
    "accountAgeDays": 45,
    "isHighlyTrusted": true
  }
}
```

---

## 2. Programmatically Create a Clinch (Make a Promise)
Allows a platform to trigger a digital handshake between two parties dynamically. *Ex: A landlord app automatically generates a Clinch for a tenant's security deposit terms.*

**Endpoint:** `POST /api/v1/clinches`

**Body Payload:**
```json
{
  "sender_phone": "+447700900000",
  "recipient_phone": "+12025550123",
  "terms": "Sarah agrees to pay Dave £150 for the shared electric bill by Friday.",
  "callback_url": "https://your-app.com/webhooks/clinch-signed"
}
```

**Example Response:**
```json
{
  "status": "pending",
  "clinch_id": "uuid-1234-5678",
  "share_url": "https://clinch.to/agree/uuid-1234-5678",
  "message": "Send the share_url to the recipient to complete the handshake."
}
```

---

## 3. Webhook: Clinch Sealed
Once the recipient slides the slider and legally seals the agreement, Clinch will instantly fire a POST request to your `callback_url` to notify your platform.

**Clinch POSTs to Your Server:**
```json
{
  "event": "clinch.sealed",
  "clinch_id": "uuid-1234-5678",
  "status": "clinched",
  "audit_trail": {
    "agreed_at": "2026-03-01T15:30:00Z",
    "agreed_ip": "192.168.1.1",
    "agreed_by": "+12025550123"
  }
}
```
