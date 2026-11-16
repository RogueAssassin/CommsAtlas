/* CommsAtlas — site settings. This is the one file to edit when you install it on your own web server.
   See INSTALL.md for what each setting does. */
window.APP_CONFIG = {
  // The name shown in the top bar, on the sign-in screen, in authenticator apps and on exports.
  name: 'CommsAtlas',

  // What a brand-new browser starts with: 'blank' (nothing, ready for your sites) or 'example' (a small demo).
  startWith: 'example',

  // The map of sites. Tiles and address search come from OpenStreetMap by default.
  // For heavy use, point "tiles" at your own tile server or a paid provider (see INSTALL.md).
  map: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    geocoder: 'https://nominatim.openstreetmap.org/search',
    center: [-37.81, 144.96], // where an empty map starts (latitude, longitude)
    zoom: 7,
  },

  // Single sign-on for everyone. Leave as null to set it up inside the app (Users & access › Single sign-on),
  // or fill it in here so it is fixed for every browser. Example for Microsoft Entra ID:
  // sso: {
  //   provider: 'entra', name: 'Microsoft',
  //   issuer: 'https://login.microsoftonline.com/<tenant-id>/v2.0',
  //   clientId: '<application-client-id>',
  //   scopes: 'openid profile email', flow: 'code',
  //   domains: 'example.com.au',
  //   groupClaim: 'groups',
  //   groupRoles: [
  //     { group: '<object-id-of-IT-admins-group>', role: 'super_admin' },
  //     { group: '<object-id-of-IT-team-group>', role: 'admin' },
  //     { group: '<object-id-of-network-techs-group>', role: 'technician' },
  //   ],
  //   superAdmins: ['it.manager@example.com.au'],
  //   defaultRole: 'viewer', requireGroup: false, allowPasswords: false,
  // },
  sso: null,

  // The CommsAtlas server (see /server): 'auto' uses it when the app is served by it, 'off' keeps everything in this browser.
  server: 'auto',
};
