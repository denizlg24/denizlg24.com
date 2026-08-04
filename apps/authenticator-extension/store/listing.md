# Store submission notes

Copy for the two dashboards, plus the answers each review process asks for.
Privacy policy URL: <https://denizlg24.com/extension-privacy>.

## Listing

**Name** — denizlg24 Authenticator

**Summary (132 chars max)** — Offline TOTP codes that stay in sync with your
denizlg24.com authenticator.

**Description**

> Generates time-based one-time passwords from the accounts stored in the
> authenticator section of denizlg24.com.
>
> Secrets are downloaded once, encrypted with AES-256-GCM under a passphrase you
> choose, and kept on your device. Codes are generated locally, so they keep
> working when the server is unreachable. Accounts added in the extension are
> pushed back up, and accounts added on the server appear the next time the popup
> opens.
>
> Requires an API key for a denizlg24.com deployment; it is not useful without
> one.

**Category** — Productivity

**Single purpose (Chrome)** — Generate and copy TOTP codes for the user's own
accounts, kept in sync with their denizlg24.com authenticator.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Persists the encrypted vault and the user's preferences on the device. There is no server-side storage of extension state. |
| `alarms` | Runs the periodic background sync and the idle auto-lock timer. Both need to fire while no extension page is open. |
| `clipboardWrite` | Copies the selected one-time code to the clipboard. |
| `host_permissions: https://denizlg24.com/*` | The authenticator API the extension synchronises with. It is the only host contacted by default. |
| `optional_host_permissions: https://*/*` | Only requested at runtime, and only for the address the user types into setup, so a self-hosted deployment on another domain can be used. Nothing is contacted until the user grants it. |

Not requested, on purpose: no `tabs`, no `scripting`, no content scripts, no
`<all_urls>` at install time. The extension never reads or modifies web pages.

## Data disclosure (Chrome Web Store)

- Collected: **authentication information** (TOTP secrets and an API key), stored
  locally on the user's device.
- Not collected: personally identifiable information, health, financial,
  location, web history, user activity, personal communications.
- Data is **not** sold or transferred to third parties.
- Data is **not** used or transferred for purposes unrelated to the item's core
  functionality.
- Data is **not** used to determine creditworthiness or for lending.
- Encryption in transit (HTTPS) and at rest (AES-256-GCM) — both apply.

## AMO

- Source code submission is required because the package is bundled; upload
  `denizlg24-authenticator-source-v<version>.zip` and point the reviewer at
  `apps/authenticator-extension/SOURCE.md`.
- Extension id: `authenticator@denizlg24.com`. Never change it — Firefox keys
  updates off it.
- Minimum Firefox 140 desktop / 142 Android, set by
  `data_collection_permissions`. Older releases ignore that key rather than
  failing, so the floor is really about keeping the validator quiet.
- `data_collection_permissions.required` is `["authenticationInfo"]`. TOTP
  secrets and the API key leave the device for the configured server, and that
  stays true however self-hosted that server is, so it is declared rather than
  claiming `none`.

### Known validator warnings

- **Unsafe assignment to innerHTML**, twice, in the shared page chunk. Both come
  from React DOM's property setter for `dangerouslySetInnerHTML` — the
  `if (typeof r != "object" || !("__html" in r)) throw` branch — and from its
  `document.createElement("div").innerHTML = "<script></script>"` trick for
  creating script elements. No code in this add-on passes
  `dangerouslySetInnerHTML`, and the strings involved never come from the
  network. Verify with `grep -rn "dangerouslySetInnerHTML\|innerHTML" src/` in
  the source archive: no hits.
- Reviewer note: the add-on is only functional against a denizlg24.com API key,
  so there is no anonymous test flow. It can be exercised against any server that
  implements `GET /api/admin/authenticator/export`.
