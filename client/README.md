Minimal React client pages for Guardian flows

Files created:
- client/src/pages/GuardianManagement.jsx
- client/src/pages/AcceptInvitation.jsx

How to use

1) If you have an existing React app, copy the two files into `client/src/pages/` and import them into your router.

Example (React Router v6):

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import GuardianManagement from './pages/GuardianManagement';
import AcceptInvitation from './pages/AcceptInvitation';

function App(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/guardians" element={<GuardianManagement/>} />
        <Route path="/accept-invitation" element={<AcceptInvitation/>} />
      </Routes>
    </BrowserRouter>
  );
}
```

2) Authentication

Pages expect a JWT stored in `localStorage` under key `token`. The backend endpoints require the `Authorization: Bearer <token>` header.

3) Endpoints used

- `GET /api/children` — to list parent children
- `GET /api/v2/guardians/children/:childId/guardians` — list guardians
- `POST /api/v2/guardians/generate-invitation` — body `{ childId, inviteEmail }`
- `POST /api/v2/guardians/accept-invitation` — body `{ code }` (requires auth)
- `GET /api/v2/guardians/verify/:code` — to preview invitation
- `DELETE /api/v2/guardians/children/:childId/guardians/:guardianId` — revoke

4) Notes

- These pages are intentionally minimal and unstyled so you can integrate them into your app's design system.
- If you want, I can scaffold a full `client/` app with `package.json`, development scripts, and a small build (CRA/Vite). Say the word and I'll create it.
