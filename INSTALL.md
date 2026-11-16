# CommsAtlas — install guide

CommsAtlas is one program file. The web app is inside it, so there is no separate web site to host and no folder of scripts to copy.
It is delivered as one self-extracting file, `CommsAtlas-<build>.run`: copy that to a Linux server, run it, and CommsAtlas is installed or
updated. Records live in one SQLite database in one data folder.

## 1. Quick start (Ubuntu / Debian, 64-bit)

```bash
scp CommsAtlas-<build>.run you@server:~/
ssh -t you@server 'sudo sh ~/CommsAtlas-<build>.run'
```

That installs the .NET 10 ASP.NET Core runtime if it is missing, puts the program in `/opt/commsatlas`, keeps its records in `/var/lib/commsatlas`,
runs it as the `commsatlas` service on `127.0.0.1:5080`, and puts nginx in front of it on port 80. Open the machine's address and make the first
Super Admin on the Set up screen.

With a name and a free Let's Encrypt certificate (the name must point at the machine and port 80 must be reachable):

```bash
sudo sh CommsAtlas-<build>.run --domain atlas.example.com --tls --email you@example.com
```

Use https for real use: sign-in passwords travel over this connection.

| Command | What it does |
|---|---|
| `sh CommsAtlas-<build>.run --check` | Changes nothing; says whether this would be a new install or an update, and what it would do |
| `sudo sh CommsAtlas-<build>.run` | The same command installs on a new machine and **updates** an existing install |
| `sh CommsAtlas-<build>.run --info` | The build number and the file's SHA-256 |
| `sh CommsAtlas-<build>.run --extract DIR` | Only unpacks the files (the program, `appsettings.json`, the installer, the uninstaller, this guide) |
| `sudo sh CommsAtlas-<build>.run --uninstall` | Removes CommsAtlas from the machine: the service, the program, **the data and every backup** (asks you to type DELETE) |
| `... --help` | Every installer option |

Installer options: `--domain NAME`, `--tls`, `--email ADDRESS`, `--port N` (default 5080), `--data DIR` (default `/var/lib/commsatlas`),
`--keep-backups N` (copies saved at update time; default 2), `--no-nginx` (run your own proxy to `127.0.0.1:PORT`), `--nginx` (write the nginx site again).

The file checks itself against a built-in SHA-256 before it unpacks anything, so a damaged copy is refused.

### Updating

Run the newer `.run` file the same way. An update keeps the data folder and `appsettings.json`, saves a copy of the database first (in
`<data>/backups/pre-update-<date>/`), keeps the old program in `/opt/commsatlas.previous`, and puts it back by itself if the new one does not
start. People stay signed in. The new build number appears in `/api/v1/health` and at the bottom right of the app. Browsers re-check the start
page every time, so the new build loads on the next refresh.

To go back by hand: `sudo systemctl stop commsatlas`, swap `/opt/commsatlas` and `/opt/commsatlas.previous`, `sudo systemctl start commsatlas`.

### What is on the machine

| Path | What it is |
|---|---|
| `/opt/commsatlas/CommsAtlas.Server` | The program: one file, web app inside |
| `/opt/commsatlas/appsettings.json` | Settings (section 2). Kept across updates |
| `/var/lib/commsatlas/` | The data folder (section 3). **Back it up** |
| `/etc/systemd/system/commsatlas.service` | The service |
| nginx site `commsatlas` | Only if the installer wrote one |

## 2. `appsettings.json`

Everything sits under `"CommsAtlas"`. Restart after changing it: `sudo systemctl restart commsatlas`.

| Setting | What it does |
|---|---|
| `DataPath` | Folder for the records. The installer sets it to `/var/lib/commsatlas` |
| `BackupsToKeep` | Daily database copies kept (default 14, minimum 1) |
| `Client` | The app's settings, sent to browsers as `/config.js`: `name` (shown in the app), `startWith` (`blank` or `example`), `map` (section 6), `sso` (section 4) |

Example:

```json
"CommsAtlas": {
  "DataPath": "/var/lib/commsatlas",
  "BackupsToKeep": 14,
  "Client": {
    "name": "CommsAtlas",
    "startWith": "blank",
    "server": "auto",
    "map": { "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap contributors",
             "maxZoom": 19, "geocoder": "https://nominatim.openstreetmap.org/search", "center": [ -38.16, 145.93 ], "zoom": 8 },
    "sso": null
  }
}
```

Check a copy of the program without touching your data: `/opt/commsatlas/CommsAtlas.Server --selftest`. It starts privately, tests every API route
with a throw-away workspace, prints `All checks passed.` and stops.

## 3. Records and backups

Inside the data folder:

| File | What it is |
|---|---|
| `commsatlas.db` | Everything: records per tenant, saved versions, accounts, sessions, settings and the activity log |
| `backups/` | A copy of the database made daily (newest 14 kept) and one before each update (`pre-update-<date>/`, newest 2 kept) |
| `secret.key` | Signs people's sessions and encrypts the connectors' keys. Keep it private. Deleting it signs everyone out and makes the connector keys unreadable (paste them again); a new one is made |
| `connectors.json` | The connectors, with their API keys encrypted |
| `.bundle/` | The program unpacks its database engine here at start. Safe to delete while stopped |

Back up the whole data folder with your normal backups. People can also export and import a whole workspace in the app (Backup & data).
The app can load a clearly fictional example workspace for demonstrations (Backup & data › Start over › Load the mock test data).

## 4. Single sign-on and levels

Each person's level comes from the groups (or app roles) your provider says they are in, or is set by hand in the app (Users & access).

| Level | Can |
|---|---|
| **Super Admin** | Everything, including single sign-on, tenants, security rules and other Super Admins |
| **Admin** | Adds and manages people (up to Admin) and which tenants they see; backs up, restores and resets workspaces; everything an Editor can do |
| **Editor** | Adds, changes and removes sites, comms rooms, racks, devices, cables, VLANs and library models; imports spreadsheets; pulls from connectors |
| **Technician** | Patches and unpatches cables; sets port details (VLAN, label, status, cable colour), device IPs, MACs and serials, notes and photos |
| **Viewer** | Looks, searches, traces cables, prints rack sheets and downloads Excel and CSV. Changes nothing |

When someone signs in they get the **highest** level of any group they are in. People who match no group get `defaultRole`, or are refused when `requireGroup` is `true`.
**Set `superAdmins` or a Super Admin group before go-live.** If neither is set, the first person to sign in becomes Super Admin.

### 4.1 Microsoft Entra ID (Microsoft 365)

1. In the Entra admin centre open **App registrations › New registration**. Name it `CommsAtlas`, single tenant.
2. Under **Authentication › Add a platform** pick **Single-page application** and enter the site's address with a trailing slash, for example `https://comms.example.com.au/`. It must be exactly the address people open.
3. Under **Token configuration › Add groups claim**, tick **Security groups** (or **Groups assigned to the application**, best for large directories) and keep **Group ID** for the ID token.
4. Under **API permissions** make sure `openid`, `profile` and `email` (Microsoft Graph, delegated) are there.
5. Copy the **Application (client) ID** into `clientId` and the **Directory (tenant) ID** into the issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0`.
6. For each group, copy its **Object ID** from **Groups** into `groupRoles` with a level.

Prefer roles over groups? Under **App roles** create roles whose **Value** is the name you map (for example `CommsAtlas.SuperAdmin`), assign people or groups under **Enterprise applications › CommsAtlas › Users and groups**, and use those values as the `group` in `groupRoles`. If someone is in more than 200 groups, Entra leaves the groups out of the token; use **Groups assigned to the application** or app roles.

### 4.2 Other providers

Google Workspace, Okta, Auth0, Keycloak, authentik and any OpenID Connect provider work too. Register a **public / single-page** client with the redirect address above (PKCE, no client secret), then set `provider`, `issuer` and `clientId`. Each provider's steps are shown in the app under **Users & access › Single sign-on**. Google does not send a `groups` claim, so use `superAdmins`, `defaultRole` and the in-app user list there.

### 4.3 The `sso` settings

```json
"sso": {
  "provider": "entra", "name": "Microsoft",
  "issuer": "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0",
  "clientId": "11111111-1111-1111-1111-111111111111",
  "scopes": "openid profile email", "flow": "code",
  "domains": "example.com.au",
  "groupClaim": "groups",
  "groupRoles": [
    { "group": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "super_admin" },
    { "group": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "role": "admin" },
    { "group": "cccccccc-cccc-cccc-cccc-cccccccccccc", "role": "technician" }
  ],
  "superAdmins": [ "it.manager@example.com.au" ],
  "defaultRole": "viewer", "requireGroup": true, "allowPasswords": false
}
```

| Setting | What it does |
|---|---|
| `provider`, `name` | Which preset, and the name on the sign-in button |
| `issuer`, `clientId` | From the provider |
| `scopes` | Keep `openid profile email` |
| `flow` | `code` (recommended) or `id_token` (Google) |
| `domains` | Only these email domains may sign in (comma separated); empty = any |
| `groupClaim` | The token claim that lists groups. Default `groups`; `roles` is always read as well |
| `groupRoles` | `{ "group": "<id or role value>", "role": "super_admin" \| "admin" \| "editor" \| "technician" \| "viewer" }` |
| `superAdmins` | Email addresses that are always Super Admin, whatever their groups |
| `defaultRole` | Level for people who match no group |
| `requireGroup` | `true` refuses people who match no group |
| `allowPasswords` | `false`: everyone uses single sign-on. Super Admins can still use a local password, so nobody is locked out if the provider is down |

You can leave `sso: null` and set all of this in the app instead (**Users & access › Single sign-on**, Super Admins only). Settings in `appsettings.json` are fixed and shown read-only in the app.

## 5. Connectors (UniFi)

A connector lets the server read your UniFi network with an API key, so you do not type it in. Open **Connectors** in the side menu. Admins add, change, test and remove connectors; Editors can pull from them.

| Connects to | Where the key comes from |
|---|---|
| **UniFi Site Manager (cloud)**: every console on your UniFi account | Sign in at unifi.ui.com as the console's **owner**, open **API** and create a Site Manager API key. Site Manager lists only consoles that belong to that account |
| **UniFi Network console (on site)**: one console, for example `https://192.168.1.1` | In UniFi Network open **Settings › Control Plane › Integrations** and create an API key. The server must be able to reach the console; tick *self-signed certificate* when it is reached by IP address |

A pull runs in the background (a large site takes a minute or two) and the Pull button shows the step it is on. It reads, read-only and with that one key:

- the console's devices, with each switch's and gateway's ports: link, speed, PoE, the VLAN each port is on, the VLANs it carries, port names and Disabled ports;
- the networks (VLAN number, name, subnet, gateway, DHCP range) and the Wi-Fi networks with the VLAN each uses (a Wi-Fi passphrase is never read);
- the cables between UniFi devices (from each device's uplink), and every wired client on a port, which becomes a device cabled to that port;
- from UniFi Protect, the recorder and the UniFi cameras.

**Test** checks the key. **Pull** shows what it found, one row per site on the other system: choose which of your sites each goes into (or a new site, or Skip) and press **Import**. Your own labels, cables and notes are kept; Undo takes an import back. Each site's page then has boxes for its VLANs, Wi-Fi networks and UniFi Protect.

The key is kept on the server in `connectors.json`, encrypted with a key derived from `secret.key`, and never sent back to a browser; only its last four characters are shown. The server makes the calls itself, three at a time, retrying timeouts.

## 6. Maps

Sites are placed by latitude and longitude (site details › **Find from address**, or **Place pin** on the map). The default map uses OpenStreetMap, which is free but has rules:

- Keep the attribution.
- Tiles: fine for normal office use; for heavy use use your own tile server or a provider such as MapTiler, Thunderforest or Stadia Maps and put its address (with your key) in `map.tiles`.
- Address search (Nominatim): at most one search a second, which the app keeps to. Set `map.geocoder` to your own Nominatim server, or `''` to turn address search off.

People's browsers fetch the tiles directly, so users need to reach the tile server.

## 7. Importing what you have

**Import data** reads switch port sheets (Excel or CSV), Word and PDF: devices, ports, VLANs, IP ranges for the site being imported, and patch links. A port's cable colour column may be headed *Cable colour* or *Patch lead colour*. When a port's device, type or notes mentions a UPS (for example *APC Smart-UPS 3000*), CommsAtlas adds that UPS to the same rack, or reuses one with the same name, and links the switch port to the UPS network card.

## 8. Troubleshooting

| You see | Do this |
|---|---|
| Sign-in says it needs a secure address | Use `https://`. Browsers block it on plain `http://` (except `localhost`) |
| "AADSTS50011 redirect URI mismatch" | The redirect address in Entra must match the site address exactly, with the trailing `/` |
| Signed in but only a Viewer | Check the groups claim is in the ID token (Entra › Token configuration) and that the Object IDs in `groupRoles` are right. **Change history** notes when the provider sent too many groups |
| Status bar says **Server unreachable · kept in this browser** | The browser cannot reach `/api/v1/health`. Check `systemctl status commsatlas` and that the proxy forwards `/api` |
| A pull answers HTTP 504 | The proxy gave up waiting: pulls run in the background, so make sure you are on a current build (older builds waited for the whole pull in one request) |
| The service does not start | `journalctl -u commsatlas -n 50`. Most often the runtime is missing (`dotnet --list-runtimes` should list `Microsoft.AspNetCore.App 10.x`) or the data folder is not writable by the `commsatlas` user |
| `--selftest` fails | It prints which check failed |
| Map is grey | The browser cannot reach the tile server, or `map.tiles` is wrong |
