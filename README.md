<p align="center">
  <img src="docs/images/banner.jpg" alt="CommsAtlas: Visualise, Document, Manage" width="900">
</p>

<p align="center">
  <b>Comms room, rack and patch documentation, as one web platform.</b><br>
  Sites &middot; comms rooms &middot; racks &middot; devices &middot; cables &middot; VLANs &middot; Wi-Fi &middot; UniFi
</p>

<p align="center">
  <a href="https://github.com/RogueAssassin/CommsAtlas/actions/workflows/build.yml"><img alt="build" src="https://github.com/RogueAssassin/CommsAtlas/actions/workflows/build.yml/badge.svg"></a>
  <img alt=".NET 10" src="https://img.shields.io/badge/.NET-10-512bd4">
  <img alt="Linux x64 / arm64" src="https://img.shields.io/badge/Linux-x64%20%7C%20arm64-informational">
  <img alt="One file" src="https://img.shields.io/badge/deploy-one%20file-success">
</p>

---

CommsAtlas documents the physical and logical side of a network: where every comms room and rack is, what sits in each rack unit, which port is
cabled to which, and which VLAN each port carries. It traces a cable from end to end through patch panels and fibre trays, prints rack sheets,
and can pull its switches, ports, VLANs and cabling straight from a UniFi console so the records start out right and stay current.

The whole system is **one program file** (`CommsAtlas.Server`): an ASP.NET Core server with the web app embedded in it, keeping its records in a
single SQLite database. It is delivered as **one self-extracting installer**, `CommsAtlas-<build>.run`. There is no separate web site to host, no
container to build and no database server to run.

## Contents

- [What you can do](#what-you-can-do)
- [Install in two minutes](#install-in-two-minutes)
- [First sign-in](#first-sign-in)
- [Using it](#using-it)
- [UniFi connector](#unifi-connector)
- [Importing and exporting](#importing-and-exporting)
- [People, levels and single sign-on](#people-levels-and-single-sign-on)
- [Updating, backups and removal](#updating-backups-and-removal)
- [Configuration](#configuration)
- [Build from source](#build-from-source)
- [Testing](#testing)
- [Repository layout](#repository-layout)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Third-party components](#third-party-components)

## What you can do

**Document the physical network**
- Organise **sites → floors or buildings → comms rooms → racks** (any rack height up to 60U, numbered from the bottom or top).
- Drag devices into rack units from a **device library** of UniFi gateways and switches, Dell, Lenovo and HP servers, APC Smart-UPS and bypass panels,
  patch panels (RJ45 and fibre: LC, SC, ST, FC, MTP/MPO), FOBOT fibre trays, PDUs, NAS, KVM and the usual endpoints. Build your own devices with any mix of ports.
- Show every rack from the **front or rear**, with the front screen of UniFi devices, vertical cable managers and per-rack notes.
- Place outlets, access points, cameras and PCs on a **room map** (optionally over an uploaded floor plan) and locate sites on a **world map**.

**Patch and trace**
- Cable any port to any compatible port: RJ45, SFP / SFP+ / SFP28 (which link to each other), QSFP, fibre connectors, power, console, USB and coax.
  Incompatible ports are dimmed while you patch.
- Cables take their **colour from the port's VLAN**, or a colour you set. Cables to end devices run to the top of the vertical cable manager; cables
  between devices in a rack run in it, in lanes that never overlap.
- **Trace** any port end to end through patch panels, wall outlets and fibre trays, with the whole path highlighted.
- Ports show their **VLAN colour**; an unconfigured port stays plain, and a disabled port is blank with a red cross.

**VLANs, IP ranges and Wi-Fi**
- VLAN numbers, names and colours are one system across every site; each site has its **own subnet, gateway and DHCP range** for each VLAN.
- Wi-Fi networks belong to a site (or to all sites) with their VLAN, security and band.
- Each site's page has drop boxes for **its** VLANs, **its** Wi-Fi networks and its UniFi Protect recorder and cameras.

**Teams and tenants**
- Several **tenants** (clients) in one installation, each with its own workspace, and per-person access to tenants.
- Five **levels**: Super Admin, Admin, Editor, Technician, Viewer. Sign in with **single sign-on** (Microsoft Entra ID, Google, Okta, Auth0, Keycloak, authentik and any OpenID Connect provider) or local passwords with optional two-step codes.
- A **change history** with undo and redo, saved versions you can restore, and an activity log.

**Get data in and out**
- Import switch port registers and VLAN tables from **Excel, CSV, Word and PDF** (scans too, with built-in text recognition), including UPS and patch information.
- Export the workspace as **Excel**, **CSV** or a backup file; **print or save as PDF** rack sheets; scan a rack's **QR code** with a phone to open it.
- A built-in, entirely fictional **mock workspace** (Backup &amp; data › Start over › Load the mock test data) shows every feature: 3 sites, five 45U racks each with an APC 3000VA UPS, an EFG gateway feeding six switches, FOBOT fibre trays joining cabinets over OS2 / OM4, an MTP trunk, and legacy SC / ST / FC fibre.

## Install in two minutes

You need a 64-bit **Ubuntu or Debian** server (x86-64 or ARM64 builds), root access, and an internet connection for the .NET runtime on first install.

1. Get `CommsAtlas-<build>.run` (build it from source below, or take it from your CI artifacts).
2. Copy it to the server and run it:

```bash
scp CommsAtlas-<build>.run you@server:~/
ssh -t you@server 'sudo sh ~/CommsAtlas-<build>.run'
```

That installs the .NET 10 ASP.NET Core runtime if it is missing, puts the program in `/opt/commsatlas`, keeps records in `/var/lib/commsatlas`,
runs it as the `commsatlas` service on `127.0.0.1:5080`, and puts nginx in front of it.

With your own name and a free Let's Encrypt certificate:

```bash
sudo sh CommsAtlas-<build>.run --domain atlas.example.com --tls --email you@example.com
```

Use https for anything real: sign-in passwords travel over this connection.

| Command | What it does |
|---|---|
| `sh CommsAtlas-<build>.run --check` | Changes nothing; says whether this would be a new install or an update, and what it would do |
| `sudo sh CommsAtlas-<build>.run` | Installs on a new machine, **updates** an existing install |
| `sh CommsAtlas-<build>.run --info` | Build number and SHA-256 of the file |
| `sh CommsAtlas-<build>.run --extract DIR` | Only unpacks the files (program, settings, installer, guide) |
| `sudo sh CommsAtlas-<build>.run --uninstall` | Removes CommsAtlas **including its data and backups** (asks you to type DELETE) |

Other installer options: `--port`, `--data`, `--keep-backups`, `--no-nginx` (bring your own proxy), `--nginx`. The file verifies its own SHA-256 before
unpacking anything. Full details are in **[INSTALL.md](INSTALL.md)**.

## First sign-in

Open the site. On a new install the **Set up** screen makes the first **Super Admin**. After that, add people under **Users &amp; access**, or set up
single sign-on there (or in `appsettings.json`). Each person then sees the tenants they have been given.

## Using it

| Where | What |
|---|---|
| **Locations** (left tree) | Sites, floors, comms rooms and racks; right-click for add / rename / remove; sort and search |
| **Site Map** | Every site on a map; place a pin or find one from its address |
| **Navigation** | Overview of the site or room you are in, with the site's VLAN, Wi-Fi and UniFi boxes |
| **Mapping** | A comms room's map: outlets, access points and endpoints, optionally over a floor plan |
| **Rack View** | The rack itself: drag devices in, patch ports, trace cables, colour ports by VLAN, print |
| **Device Library** | Every model; add your own or edit one |
| **Port details** | Click a port: label, VLAN, tagged VLANs, status (Active, Spare, Reserved, Disabled, Faulty), cable colour, patch point, notes |
| **Backup &amp; data** | Download or open a backup, import / export Excel and CSV, empty the workspace, load the mock data |

Keyboard: arrow keys, Home and End move through the view tabs and menus, Tab leaves a menu and Escape closes it. Light and dark themes follow your system.

## UniFi connector

A connector reads your UniFi network with an API key, so the records start accurate and can be refreshed. Open **Connectors** in the side menu.

| Connects to | Key |
|---|---|
| **UniFi Site Manager (cloud)**: every console on the account | unifi.ui.com › API (made as the console's owner) |
| **UniFi Network console (on site)**: one console by address | UniFi Network › Settings › Control Plane › Integrations |

A **Pull** runs in the background (a large site takes a minute or two) and reads, read-only:

- **Devices and ports**: each gateway and switch with every port (patched or not): link and speed, PoE, the **VLAN it is on**, the VLANs it carries, its name, and disabled ports;
- **Networks and Wi-Fi**: VLAN number, name, subnet, gateway and DHCP range per site, and Wi-Fi networks with their VLAN. A Wi-Fi passphrase is **never** read;
- **Cabling**: the cables between UniFi devices (from each device's uplink), plus every wired client on a port, which becomes a device cabled to that port;
- **UniFi Protect**: the recorder and the UniFi cameras.

You choose which of your sites each remote site goes into, then **Import**. Your own labels, cables and notes are kept, and Undo takes an import back.
API keys are encrypted on the server and never sent back to a browser.

## Importing and exporting

**Import data** accepts switch port sheets (`.xlsx`, `.csv`), Word (`.docx`) and PDF. It recognises a VLAN table (ID, name, subnet, notes, cable colour)
and a device sheet (switch name, model, serial, management IP, a port map with device, type, VLANs, patch point, status, notes, cable colour) and
updates what is already there (VLANs by number, devices by serial or name). A column may be headed *Cable colour* or the older *Patch lead colour*.
**Download as Excel** writes the same layout, so you can edit and import it again.

## People, levels and single sign-on

| Level | Can |
|---|---|
| **Super Admin** | Everything, including single sign-on, tenants and security rules |
| **Admin** | Manages people and tenant access; backs up, restores and resets workspaces |
| **Editor** | Adds, changes and removes sites, racks, devices, cables, VLANs and library models; imports; pulls from connectors |
| **Technician** | Patches cables; sets port details, device addresses, notes and photos |
| **Viewer** | Looks, searches, traces, prints and downloads |

Single sign-on uses OpenID Connect (PKCE, no client secret). Step-by-step set-up for Microsoft Entra ID and the other providers, group-to-level mapping and
safety settings are in [INSTALL.md](INSTALL.md#4-single-sign-on-and-levels).

## Updating, backups and removal

- **Update**: run the newer `.run` file the same way. It keeps your data and `appsettings.json`, saves a database copy first, keeps the old program in `/opt/commsatlas.previous`, and puts it back by itself if the new one does not start. People stay signed in.
- **Backups**: a daily database copy (newest 14 kept) and one before each update (newest 2 kept), under the data folder. Back the data folder up with your normal backups.
- **Remove**: `sudo sh CommsAtlas-<build>.run --uninstall`.

## Configuration

Settings live in `/opt/commsatlas/appsettings.json` under `"CommsAtlas"`:

| Setting | What it does |
|---|---|
| `DataPath` | Where records are kept (the installer sets `/var/lib/commsatlas`) |
| `BackupsToKeep` | Daily database copies kept (default 14) |
| `Client.name` | The name shown in the app |
| `Client.startWith` | `blank` or `example` for a new workspace |
| `Client.map` | Map tile server, attribution, address search and the starting view |
| `Client.sso` | Single sign-on (see INSTALL.md) |

Restart after a change: `sudo systemctl restart commsatlas`.

## Build from source

Requirements: the **.NET 10 SDK**, **PowerShell** (7, or Windows PowerShell 5.1) and `tar`.

```powershell
pwsh ./build.ps1 -Test -Notes "what changed"          # linux-x64 (default)
pwsh ./build.ps1 -Runtime linux-arm64 -Notes "arm"
```

The build copies the web app (`src/`) into the server project, publishes the server as a **single-file program** with the web app embedded, and wraps it
with `appsettings.json`, the installer, the uninstaller and the install guide into `release/CommsAtlas-<build>.run`. Every build has its own random build
number, shown in the app, in `/api/v1/health` and in the file name, and a line is added to [BUILD-LOG.md](BUILD-LOG.md). `-Test` runs the server's
checks first and stops if one fails.

## Testing

```bash
dotnet run --project server -- --selftest
```

Starts the server privately on a free loopback port with a throw-away data folder, checks every API route (accounts, tenants, workspaces and history, backups,
single sign-on rules, connectors against a stand-in UniFi console, the embedded web app) and prints `All checks passed.` The same command runs in CI
([`.github/workflows/build.yml`](.github/workflows/build.yml)), which then builds the installer and checks it with `--check`.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The web app: plain JavaScript, HTML and CSS, no build step and no runtime dependencies (`src/js/` modules, `src/vendor/` bundled libraries) |
| `server/` | The ASP.NET Core server: API, accounts and sessions, single sign-on, workspaces and history, the UniFi connector, the self-test |
| `deploy/` | Installer / updater, uninstaller, and the header of the self-extracting file |
| `build.ps1` | Makes `release/CommsAtlas-<build>.run` |
| `INSTALL.md` | Install, update, settings, single sign-on, connectors, troubleshooting |
| `BUILD-LOG.md` | One line per build, and what changed |
| `.github/workflows/` | CI: server checks, build, installer check |

## Security

- Passwords are hashed; sessions are signed; sign-in has rate limiting and lockout; optional two-step codes.
- Connector API keys are **encrypted at rest** with a key derived from `secret.key` and never returned to a browser. Wi-Fi passphrases are never read.
- The server listens on the loopback address behind nginx; security headers (CSP, frame and content-type protections) are set on every answer.
- All records stay on your server. The only outside requests a browser makes are to the map tile server and the address-search service you configure.
- Report a security problem privately to the repository owner rather than in a public issue.

## Troubleshooting

| You see | Do this |
|---|---|
| Sign-in says it needs a secure address | Use `https://` (browsers block it on plain `http://` except `localhost`) |
| The service does not start | `journalctl -u commsatlas -n 50`; check `dotnet --list-runtimes` lists `Microsoft.AspNetCore.App 10.x` and that the data folder is writable by the `commsatlas` user |
| A UniFi pull says it found no devices | Site Manager only lists consoles owned by the account the key was made on; make the key as the owner. The pull's diagnostics list every request and answer |
| Status bar says *Server unreachable* | The browser cannot reach `/api/v1/health`; check the service and that the proxy forwards `/api` |
| Anything else | See [INSTALL.md](INSTALL.md#8-troubleshooting) |

## Third-party components

Bundled and licensed under their own terms: [PDF.js](src/vendor/LICENSE-pdfjs.txt), [Tesseract.js](src/vendor/LICENSE-tesseract.txt) and the
[Outfit font](src/fonts/LICENSE.txt). Map tiles come from OpenStreetMap by default (keep the attribution; see INSTALL.md for usage rules).
Server dependencies: Microsoft.Data.Sqlite and SQLite (public domain).

## Licence

No licence has been chosen yet. Until one is added the code is **all rights reserved** by its owner.
