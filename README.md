# STORIX Landing

STORIX app install landing page.

## Image

Put the landing image at:

```text
public/landing.png
```

## Commands

```bash
npm install
npm run dev
npm run build
```

## Attendance event WebView

```text
/events/attendance
```

The attendance APIs use `VITE_API_BASE_URL`. Development defaults to
`https://dev.storix.kr`, and production defaults to `https://api.storix.kr`.

The page does not persist access tokens. The app must inject the current token
after the page has loaded:

```js
window.dispatchEvent(
  new CustomEvent('STORIX_AUTH', {
    detail: { accessToken: '...' },
  }),
)
```

The page calls:

```text
GET  /api/v1/attendance-event
POST /api/v1/attendance-event/check-in
```
