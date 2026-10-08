# macros-admin

Moderation console for Macros' shared foods (macros-admin.denizlg24.com, port 3010). Owner-only: signs in with deniz auth and refuses any token without the `superuser` claim; every read and write goes to the Macros API's `/api/admin/*` with that token.

| Env | Default |
|---|---|
| `DENIZ_AUTH_CLIENT_ID` / `DENIZ_AUTH_CLIENT_SECRET` | required at first sign-in; web client with redirect `<MACROS_ADMIN_URL>/auth/callback`, resource = `MACROS_API_RESOURCE` |
| `DENIZ_AUTH_SECRET` | required, ≥ 32 chars; seals the session cookie |
| `DENIZ_AUTH_ISSUER` / `DENIZ_AUTH_APP_URL` | `https://api.denizlg24.com/api/auth` / `https://auth.denizlg24.com` |
| `MACROS_ADMIN_URL` | `https://macros-admin.denizlg24.com` (`http://localhost:3010` in dev) |
| `MACROS_API_URL` / `MACROS_API_RESOURCE` | `https://macros.denizlg24.com` (`http://localhost:3000` in dev) / `https://macros.denizlg24.com` |
