/* CommsAtlas — data: the default device library, demo workspace, saving, undo/redo and lookups. */
(function () {
  'use strict';
  const RB = window.RB;
  const KEY = 'rackbook.workspace.v1';
  const UI_KEY = 'rackbook.ui.v1';

  // Fibre connectors: LC (current), SC and ST (older sites), FC (older, test and telco), MTP/MPO (multi-fibre trunks).
  RB.FIBRE_TYPES = ['LC', 'SC', 'ST', 'FC', 'MTP'];
  RB.PORT_TYPES = ['RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP'].concat(RB.FIBRE_TYPES, ['Power', 'Console', 'USB', 'Coax']);
  RB.CATEGORIES = ['Patch panel', 'Switch', 'Gateway', 'Router', 'Firewall', 'Server', 'Storage', 'NVR', 'Power', 'Accessory',
    'Access point', 'Camera', 'Nurse call', 'Phone', 'Access control', 'Building management', 'IoT', 'Display / AV', 'Endpoint', 'Other'];
  /** Suggestions for a device's platform or operating system. */
  RB.PLATFORMS = ['Proxmox VE 8', 'Proxmox VE 9', 'Proxmox Backup Server', 'Proxmox VE cluster node', 'Windows Server 2022', 'Windows Server 2025', 'Ubuntu Server', 'Debian', 'TrueNAS', 'VMware ESXi', 'UniFi OS', 'UniFi Network', 'UniFi Protect', 'UniFi Access', 'UniFi Talk'];
  RB.CABLES = ['Cat5e', 'Cat6', 'Cat6a', 'Cat7', 'Cat8', 'OM1', 'OM2', 'OM3', 'OM4', 'OM5', 'OS1', 'OS2', 'DAC', 'Power', 'Console', 'Coax', 'Other'];
  RB.CABLE_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#9333ea', '#0891b2', '#db2777', '#525252', '#0a0a0a', '#eab308'];

  function g(type, count, rows, side, prefix, start) {
    return { type, count, rows: rows || 1, side: side || 'front', prefix: prefix || '', start: start || 1 };
  }

  /** The starter device library: generic, vendor-neutral templates. */
  RB.defaultTemplates = function () {
    return [
      { id: 'tpl_pp24', name: 'Patch panel 24 × RJ45', maker: 'Generic', model: 'PP-24', category: 'Patch panel', units: 1, color: '#3f3f46', passthrough: true, groups: [g('RJ45', 24, 1, 'front')] },
      { id: 'tpl_pp48', name: 'Patch panel 48 × RJ45', maker: 'Generic', model: 'PP-48', category: 'Patch panel', units: 2, color: '#3f3f46', passthrough: true, groups: [g('RJ45', 48, 2, 'front')] },
      // Fibre panels: every connector style found on sites, new (LC) and old (SC, ST, FC), plus MTP/MPO trunks.
      { id: 'tpl_fp12', name: 'Fibre panel 12 × LC', maker: 'Generic', model: 'FP-12LC', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('LC', 12, 1, 'front')] },
      { id: 'tpl_fp24', name: 'Fibre panel 24 × LC', maker: 'Generic', model: 'FP-24LC', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('LC', 24, 1, 'front')] },
      { id: 'tpl_fp12sc', name: 'Fibre panel 12 × SC', maker: 'Generic', model: 'FP-12SC', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('SC', 12, 1, 'front')] },
      { id: 'tpl_fp24sc', name: 'Fibre panel 24 × SC', maker: 'Generic', model: 'FP-24SC', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('SC', 24, 1, 'front')] },
      { id: 'tpl_fp12st', name: 'Fibre panel 12 × ST', maker: 'Generic', model: 'FP-12ST', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('ST', 12, 1, 'front')] },
      { id: 'tpl_fp24st', name: 'Fibre panel 24 × ST', maker: 'Generic', model: 'FP-24ST', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('ST', 24, 1, 'front')] },
      { id: 'tpl_fp12fc', name: 'Fibre panel 12 × FC', maker: 'Generic', model: 'FP-12FC', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('FC', 12, 1, 'front')] },
      { id: 'tpl_fp12mtp', name: 'Fibre panel 12 × MTP/MPO', maker: 'Generic', model: 'FP-12MTP', category: 'Patch panel', units: 1, color: '#334155', passthrough: true, groups: [g('MTP', 12, 1, 'front')] },
      { id: 'tpl_rt', name: 'Router (ISP / third-party)', maker: 'Generic', model: 'RT-4', category: 'Router', units: 1, color: '#14532d', passthrough: false, groups: [g('RJ45', 4, 1, 'front', 'Ge'), g('SFP', 2, 1, 'front', 'SFP '), g('Power', 1, 1, 'rear', 'PSU ')] },
      { id: 'tpl_nas', name: 'Storage / NAS 2U', maker: 'Generic', model: 'NAS-2U', category: 'Storage', units: 2, color: '#404040', passthrough: false, groups: [g('RJ45', 4, 2, 'rear', 'LAN '), g('SFP+', 2, 1, 'rear', 'SFP '), g('Power', 2, 1, 'rear', 'PSU ')] },
      { id: 'tpl_ups', name: 'UPS 2U', maker: 'Generic', model: 'UPS-2U', category: 'Power', units: 2, color: '#171717', passthrough: false, groups: [g('RJ45', 1, 1, 'rear', 'Net '), g('Power', 8, 2, 'rear', 'Out ')] },
      { id: 'tpl_pdu', name: 'PDU 8 outlet', maker: 'Generic', model: 'PDU-8', category: 'Power', units: 1, color: '#171717', passthrough: false, groups: [g('Power', 8, 1, 'rear', 'Out ')] },
      { id: 'tpl_kvm', name: 'KVM console 8 port', maker: 'Generic', model: 'KVM-8', category: 'Accessory', units: 1, color: '#3f3f46', passthrough: false, groups: [g('RJ45', 8, 1, 'rear', 'KVM ')] },
      { id: 'tpl_cm', name: 'Cable manager', maker: 'Generic', model: 'CM-1U', category: 'Accessory', units: 1, color: '#52525b', passthrough: false, groups: [] },
      { id: 'tpl_shelf', name: 'Shelf', maker: 'Generic', model: 'SH-1U', category: 'Accessory', units: 1, color: '#71717a', passthrough: false, groups: [] },
      { id: 'tpl_blank', name: 'Blank panel', maker: 'Generic', model: 'BP-1U', category: 'Accessory', units: 1, color: '#a1a1aa', passthrough: false, groups: [] },
      // Endpoints (zero rack units): they live in rooms, not racks.
      { id: 'tpl_wo2', name: 'Wall outlet 2 × RJ45', maker: 'Generic', model: 'WO-2', category: 'Endpoint', units: 0, color: '#e5e5e5', passthrough: true, groups: [g('RJ45', 2, 1, 'front', '')] },
      { id: 'tpl_fo4', name: 'Floor outlet 4 × RJ45', maker: 'Generic', model: 'FO-4', category: 'Endpoint', units: 0, color: '#e5e5e5', passthrough: true, groups: [g('RJ45', 4, 1, 'front', '')] },
      { id: 'tpl_ap', name: 'Access point', maker: 'Generic', model: 'AP', category: 'Access point', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
      { id: 'tpl_cam', name: 'Camera', maker: 'Generic', model: 'CAM', category: 'Camera', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
      { id: 'tpl_prn', name: 'Printer', maker: 'Generic', model: 'PRN', category: 'Endpoint', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
      { id: 'tpl_pc', name: 'Workstation', maker: 'Generic', model: 'PC', category: 'Endpoint', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
      { id: 'tpl_phone', name: 'IP phone', maker: 'Generic', model: 'PHONE', category: 'Phone', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 2, 1, 'front', '')] },
      { id: 'tpl_screen', name: 'Screen', maker: 'Generic', model: 'SCR', category: 'Display / AV', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
      { id: 'tpl_spk', name: 'Speaker', maker: 'Generic', model: 'SPK', category: 'Display / AV', units: 0, color: '#f5f5f5', passthrough: false, groups: [g('RJ45', 1, 1, 'front', 'LAN ')] },
    ].concat(RB.extraTemplates());
  };

  /**
   * Ubiquiti UniFi, nurse call, one simple Dell / Lenovo / HP server in 1U and 2U, APC power, and the other kinds of device in a care
   * site's port registers. LIBRARY_VERSION goes up when the library changes: older workspaces get the new templates added once, and
   * the retired ones are removed if no device uses them (see normalise()).
   */
  RB.LIBRARY_VERSION = 5;
  /** Library templates that were dropped in version 4 (replaced by the simple server set, UniFi switches and gateways). */
  RB.RETIRED_TEMPLATES = ['tpl_sw24', 'tpl_sw48', 'tpl_agg', 'tpl_fw', 'tpl_srv1', 'tpl_srv2', 'tpl_pbs_host',
    'tpl_dell_r650', 'tpl_dell_r660', 'tpl_dell_r640', 'tpl_dell_r750', 'tpl_dell_r760', 'tpl_dell_r740', 'tpl_dell_r450', 'tpl_dell_r550',
    'tpl_len_sr630v2', 'tpl_len_sr630v3', 'tpl_len_sr650v2', 'tpl_len_sr650v3', 'tpl_len_sr250v2', 'tpl_len_st250v2'];
  RB.extraTemplates = function () {
    const T = (id, maker, model, name, category, units, color, groups, passthrough) => ({ id: 'tpl_' + id, name, maker, model, category, units, color, passthrough: !!passthrough, groups });
    const UI = '#d4d4d8', UIDARK = '#a1a1aa', WHITE = '#f5f5f5';
    const lan = (n, prefix) => g('RJ45', n || 1, 1, 'front', prefix == null ? 'LAN ' : prefix);
    const psu = (n) => g('Power', n || 1, 1, 'rear', 'PSU ');
    // One simple server per brand and height: front USB, NIC ports, the brand's management port (iDRAC / XCC / iLO), SFP+ and two PSUs.
    const server = (id, maker, mgmt, units) => T('srv_' + id + '_' + units + 'u', maker, maker + ' server ' + units + 'U', maker + ' server ' + units + 'U', 'Server', units, maker === 'Dell' ? '#1f2937' : '#111827',
      [g('USB', 2, 1, 'front', 'USB '), g('RJ45', 4, units > 1 ? 2 : 1, 'rear', 'NIC '), g('SFP+', 2, 1, 'rear', 'SFP ', 1), g('RJ45', 1, 1, 'rear', mgmt + ' ', 1), g('USB', 2, 1, 'rear', 'USB ', 3), psu(2)]);
    // UniFi switch: RJ45 1..n, then the SFP cages numbered on from n+1 (as UniFi numbers them).
    const usw = (id, model, name, rj, sfpType, sfp, color, extra) => T('ui_' + id, 'Ubiquiti', model, name, 'Switch', 1, color || UI,
      [g('RJ45', rj, rj > 8 ? 2 : 1, 'front', '', 1)].concat(sfp ? [g(sfpType, sfp, sfp > 2 ? 2 : 1, 'front', '', rj + 1)] : [], extra || [], [psu(1)]));
    return [
      // UniFi gateways
      T('ui_efg', 'Ubiquiti', 'EFG', 'UniFi Enterprise Fortress Gateway', 'Gateway', 1, UI, [lan(2, ''), g('SFP+', 2, 1, 'front', '', 3), g('SFP28', 2, 1, 'front', '', 5), g('Console', 1, 1, 'front', 'Con '), psu(2)]),
      T('ui_udmpro', 'Ubiquiti', 'UDM-Pro', 'UniFi Dream Machine Pro', 'Gateway', 1, UI, [lan(8, ''), g('RJ45', 1, 1, 'front', 'WAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ LAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ WAN ', 1), psu(1)]),
      T('ui_udmse', 'Ubiquiti', 'UDM-SE', 'UniFi Dream Machine SE', 'Gateway', 1, UI, [lan(8, ''), g('RJ45', 1, 1, 'front', 'WAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ LAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ WAN ', 1), psu(1)]),
      T('ui_udmpromax', 'Ubiquiti', 'UDM-Pro-Max', 'UniFi Dream Machine Pro Max', 'Gateway', 1, UI, [lan(8, ''), g('RJ45', 1, 1, 'front', 'WAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ LAN ', 1), g('SFP+', 1, 1, 'front', 'SFP+ WAN ', 1), psu(2)]),
      T('ui_uxgpro', 'Ubiquiti', 'UXG-Pro', 'UniFi Next-Gen Gateway Pro', 'Gateway', 1, UI, [lan(2, 'Port '), g('SFP+', 2, 1, 'front', 'SFP+ ', 1), psu(1)]),
      T('ui_uxgent', 'Ubiquiti', 'UXG-Enterprise', 'UniFi Next-Gen Gateway Enterprise', 'Gateway', 1, UI, [lan(2, 'Port '), g('SFP28', 2, 1, 'front', 'SFP28 ', 1), g('Console', 1, 1, 'front', 'Con '), psu(2)]),
      T('ui_ucgultra', 'Ubiquiti', 'UCG-Ultra', 'UniFi Cloud Gateway Ultra', 'Gateway', 0, WHITE, [lan(4, ''), g('RJ45', 1, 1, 'front', 'WAN ', 1)]),
      T('ui_ucgmax', 'Ubiquiti', 'UCG-Max', 'UniFi Cloud Gateway Max', 'Gateway', 0, WHITE, [lan(4, ''), g('RJ45', 1, 1, 'front', 'WAN ', 1)]),
      // UniFi switches
      usw('usw48poe', 'USW-48-PoE', 'UniFi Switch 48 PoE', 48, 'SFP', 4),
      usw('usw48', 'USW-48', 'UniFi Switch 48', 48, 'SFP', 4),
      usw('uswpro48poe', 'USW-Pro-48-PoE', 'UniFi Switch Pro 48 PoE', 48, 'SFP+', 4),
      usw('uswpro48', 'USW-Pro-48', 'UniFi Switch Pro 48', 48, 'SFP+', 4),
      usw('uswpromax48poe', 'USW-Pro-Max-48-PoE', 'UniFi Switch Pro Max 48 PoE', 48, 'SFP+', 4),
      usw('uswpromax48', 'USW-Pro-Max-48', 'UniFi Switch Pro Max 48', 48, 'SFP+', 4),
      usw('uswent48poe', 'USW-Enterprise-48-PoE', 'UniFi Switch Enterprise 48 PoE', 48, 'SFP+', 4, UIDARK),
      usw('usw24poe', 'USW-24-PoE', 'UniFi Switch 24 PoE', 24, 'SFP', 2),
      usw('usw24', 'USW-24', 'UniFi Switch 24', 24, 'SFP', 2),
      usw('uswpro24poe', 'USW-Pro-24-PoE', 'UniFi Switch Pro 24 PoE', 24, 'SFP+', 2),
      usw('uswpro24', 'USW-Pro-24', 'UniFi Switch Pro 24', 24, 'SFP+', 2),
      usw('uswpromax24poe', 'USW-Pro-Max-24-PoE', 'UniFi Switch Pro Max 24 PoE', 24, 'SFP+', 2),
      usw('uswpromax16poe', 'USW-Pro-Max-16-PoE', 'UniFi Switch Pro Max 16 PoE', 16, 'SFP+', 2),
      usw('uswent24poe', 'USW-Enterprise-24-PoE', 'UniFi Switch Enterprise 24 PoE', 24, 'SFP+', 2, UIDARK),
      usw('uswent8poe', 'USW-Enterprise-8-PoE', 'UniFi Switch Enterprise 8 PoE', 8, 'SFP+', 2, UIDARK),
      usw('uswentxg24', 'USW-EnterpriseXG-24', 'UniFi Switch Enterprise XG 24', 24, 'SFP28', 2, UIDARK),
      usw('usw16poe', 'USW-16-PoE', 'UniFi Switch 16 PoE', 16, 'SFP', 2),
      T('ui_uswlite16poe', 'Ubiquiti', 'USW-Lite-16-PoE', 'UniFi Switch Lite 16 PoE', 'Switch', 1, UI, [g('RJ45', 16, 2, 'front', '', 1), psu(1)]),
      T('ui_uswlite8poe', 'Ubiquiti', 'USW-Lite-8-PoE', 'UniFi Switch Lite 8 PoE', 'Switch', 0, WHITE, [g('RJ45', 8, 1, 'front', '', 1)]),
      T('ui_uswflex', 'Ubiquiti', 'USW-Flex', 'UniFi Switch Flex', 'Switch', 0, WHITE, [g('RJ45', 5, 1, 'front', '', 1)]),
      T('ui_uswflexmini', 'Ubiquiti', 'USW-Flex-Mini', 'UniFi Switch Flex Mini', 'Switch', 0, WHITE, [g('RJ45', 5, 1, 'front', '', 1)]),
      T('ui_uswagg', 'Ubiquiti', 'USW-Aggregation', 'UniFi Switch Aggregation', 'Switch', 1, UI, [g('SFP+', 8, 1, 'front', '', 1), psu(1)]),
      T('ui_uswproagg', 'Ubiquiti', 'USW-Pro-Aggregation', 'UniFi Switch Pro Aggregation', 'Switch', 1, UI, [g('SFP+', 28, 2, 'front', '', 1), g('SFP28', 4, 2, 'front', '', 29), psu(2)]),
      // FOBOT: a rack-mount fibre break-out tray. Front adapters take the patch cables, the rear takes the backbone cable to the next cabinet.
      T('fobot12lc', 'Generic', 'FOBOT-12LC', 'FOBOT fibre tray 12 × LC (1U)', 'Patch panel', 1, '#334155', [g('LC', 12, 1, 'front')], true),
      T('fobot24lc', 'Generic', 'FOBOT-24LC', 'FOBOT fibre tray 24 × LC (1U)', 'Patch panel', 1, '#334155', [g('LC', 24, 1, 'front')], true),
      T('fobot12mtp', 'Generic', 'FOBOT-12MTP', 'FOBOT fibre tray 12 × MTP/MPO (1U)', 'Patch panel', 1, '#334155', [g('MTP', 12, 1, 'front')], true),
      // UniFi Protect recorders
      T('ui_unvr', 'Ubiquiti', 'UNVR', 'UniFi Network Video Recorder', 'NVR', 1, UI, [lan(1, 'LAN '), g('SFP+', 1, 1, 'front', 'SFP+ ', 1), psu(1)]),
      T('ui_unvrpro', 'Ubiquiti', 'UNVR-Pro', 'UniFi NVR Pro', 'NVR', 2, UI, [lan(1, 'LAN '), g('SFP+', 1, 1, 'front', 'SFP+ ', 1), psu(2)]),
      T('ui_envr', 'Ubiquiti', 'ENVR', 'UniFi Enterprise NVR', 'NVR', 3, UIDARK, [lan(1, 'LAN '), g('SFP+', 2, 1, 'front', 'SFP+ ', 1), psu(2)]),
      T('nvr_3rd', 'Generic', 'NVR', 'Third-party NVR', 'NVR', 2, '#262626', [lan(2, 'LAN '), psu(1)]),
      // UniFi access points (ceiling, wall and outdoor)
      T('ui_u7pro', 'Ubiquiti', 'U7-Pro', 'UniFi U7 Pro', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u7promax', 'Ubiquiti', 'U7-Pro-Max', 'UniFi U7 Pro Max', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u7prowall', 'Ubiquiti', 'U7-Pro-Wall', 'UniFi U7 Pro Wall', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u7outdoor', 'Ubiquiti', 'U7-Outdoor', 'UniFi U7 Outdoor', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6pro', 'Ubiquiti', 'U6-Pro', 'UniFi U6 Pro', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6plus', 'Ubiquiti', 'U6+', 'UniFi U6+', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6lr', 'Ubiquiti', 'U6-LR', 'UniFi U6 Long-Range', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6lite', 'Ubiquiti', 'U6-Lite', 'UniFi U6 Lite', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6ent', 'Ubiquiti', 'U6-Enterprise', 'UniFi U6 Enterprise', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6mesh', 'Ubiquiti', 'U6-Mesh', 'UniFi U6 Mesh', 'Access point', 0, WHITE, [lan(1, 'Uplink ')]),
      T('ui_u6iw', 'Ubiquiti', 'U6-IW', 'UniFi U6 In-Wall', 'Access point', 0, WHITE, [lan(1, 'Uplink '), g('RJ45', 4, 1, 'front', '', 1)]),
      T('ui_uacpro', 'Ubiquiti', 'UAP-AC-Pro', 'UniFi AC Pro', 'Access point', 0, WHITE, [lan(2, 'LAN ')]),
      T('ui_uaclr', 'Ubiquiti', 'UAP-AC-LR', 'UniFi AC Long-Range', 'Access point', 0, WHITE, [lan(1, 'LAN ')]),
      // UniFi Protect cameras
      T('ui_g5bullet', 'Ubiquiti', 'UVC-G5-Bullet', 'UniFi G5 Bullet camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_g5dome', 'Ubiquiti', 'UVC-G5-Dome', 'UniFi G5 Dome camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_g5turret', 'Ubiquiti', 'UVC-G5-Turret-Ultra', 'UniFi G5 Turret Ultra camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_g5flex', 'Ubiquiti', 'UVC-G5-Flex', 'UniFi G5 Flex camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_g5ptz', 'Ubiquiti', 'UVC-G5-PTZ', 'UniFi G5 PTZ camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_g4pro', 'Ubiquiti', 'UVC-G4-Pro', 'UniFi G4 Pro camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_aibullet', 'Ubiquiti', 'UVC-AI-Bullet', 'UniFi AI Bullet camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_ai360', 'Ubiquiti', 'UVC-AI-360', 'UniFi AI 360 camera', 'Camera', 0, WHITE, [lan(1)]),
      T('ui_viewport', 'Ubiquiti', 'UP-Viewport', 'UniFi Protect Viewport', 'Display / AV', 0, WHITE, [lan(1)]),
      // UniFi Access, Talk and other UniFi gear
      T('ui_uahub', 'Ubiquiti', 'UA-Hub', 'UniFi Access Hub', 'Access control', 0, WHITE, [lan(1, 'Uplink '), g('RJ45', 1, 1, 'front', 'Reader ', 1)]),
      T('ui_uaultra', 'Ubiquiti', 'UA-Ultra', 'UniFi Access Ultra', 'Access control', 0, WHITE, [lan(1, 'PoE in ')]),
      T('ui_uag2pro', 'Ubiquiti', 'UA-G2-Pro', 'UniFi Access Reader G2 Pro', 'Access control', 0, WHITE, [lan(1, 'PoE in ')]),
      T('ui_uaintercom', 'Ubiquiti', 'UA-Intercom', 'UniFi Access Intercom', 'Access control', 0, WHITE, [lan(1, 'PoE in ')]),
      T('ui_talktouch', 'Ubiquiti', 'UTP-Touch', 'UniFi Talk Touch phone', 'Phone', 0, WHITE, [lan(1, 'LAN '), g('RJ45', 1, 1, 'front', 'PC ', 1)]),
      T('ui_ck2plus', 'Ubiquiti', 'UCK-G2-Plus', 'UniFi Cloud Key Gen2 Plus', 'Accessory', 0, WHITE, [lan(1)]),
      T('ui_poeinj', 'Ubiquiti', 'U-PoE-at', 'UniFi PoE injector', 'Power', 0, '#e5e5e5', [g('RJ45', 1, 1, 'front', 'LAN ', 1), g('RJ45', 1, 1, 'front', 'PoE ', 1)]),
      T('ui_pp24', 'Ubiquiti', 'UACC-Rack-Panel-Patch-24', 'UniFi patch panel 24 × RJ45', 'Patch panel', 1, UI, [g('RJ45', 24, 1, 'front')], true),
      T('ui_ups2u', 'Ubiquiti', 'UPS-2U', 'UniFi UPS 2U', 'Power', 2, UI, [g('RJ45', 1, 1, 'rear', 'Net '), g('Power', 8, 2, 'rear', 'Out ')]),
      // Nurse call (any brand: edit the maker and model to match the system on site)
      T('nc_server', 'Nurse call', 'NC-SRV', 'Nurse call server / controller', 'Nurse call', 1, '#6b21a8', [lan(2, 'LAN '), psu(1)]),
      T('nc_gateway', 'Nurse call', 'NC-GW', 'Nurse call IP gateway', 'Nurse call', 1, '#7e22ce', [lan(2, 'LAN '), g('RJ45', 4, 1, 'front', 'Bus ', 1), psu(1)]),
      T('nc_master', 'Nurse call', 'NC-MS', 'Nurse station / master console', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      T('nc_room', 'Nurse call', 'NC-RU', 'Nurse call room unit', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      T('nc_bed', 'Nurse call', 'NC-BED', 'Nurse call bedside / call point', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      T('nc_display', 'Nurse call', 'NC-DSP', 'Nurse call corridor display / dome light', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      T('nc_dect', 'Nurse call', 'NC-DECT', 'DECT / paging base station', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      T('nc_rx', 'Nurse call', 'NC-RX', 'Wireless pendant receiver / locator', 'Nurse call', 0, '#e9d5ff', [lan(1)]),
      // Phones, building systems and other things found on switch ports
      T('ph_t31g', 'Yealink', 'SIP-T31G', 'Yealink SIP-T31G IP phone', 'Phone', 0, WHITE, [lan(1, 'LAN '), g('RJ45', 1, 1, 'front', 'PC ', 1)]),
      T('ph_t53w', 'Yealink', 'SIP-T53W', 'Yealink SIP-T53W IP phone', 'Phone', 0, WHITE, [lan(1, 'LAN '), g('RJ45', 1, 1, 'front', 'PC ', 1)]),
      T('ph_dect', 'Generic', 'DECT-BASE', 'DECT phone base station', 'Phone', 0, WHITE, [lan(1)]),
      T('ph_ata', 'Generic', 'ATA', 'VoIP gateway / ATA', 'Phone', 0, WHITE, [lan(1)]),
      T('ac_door', 'Generic', 'DOOR-CTL', 'Door / access controller', 'Access control', 0, '#fed7aa', [lan(1)]),
      T('bms_ctl', 'Generic', 'BMS-CTL', 'Building management (BMS) controller', 'Building management', 0, '#fed7aa', [lan(1)]),
      T('iot_dev', 'Generic', 'IOT', 'IoT device', 'IoT', 0, '#fbcfe8', [lan(1)]),
      T('res_dev', 'Generic', 'RES', 'Resident device', 'Endpoint', 0, '#bbf7d0', [lan(1)]),
      T('av_tv', 'Generic', 'TV', 'TV / display', 'Display / AV', 0, WHITE, [lan(1)]),
      T('av_amp', 'Generic', 'AMP', 'Audio amplifier / PA', 'Display / AV', 1, '#262626', [lan(1, 'LAN '), psu(1)]),
      // Servers: Dell, Lenovo or HP, 1U or 2U (set Platform / OS and the real model on each device)
      server('dell', 'Dell', 'iDRAC', 1), server('dell', 'Dell', 'iDRAC', 2),
      server('lenovo', 'Lenovo', 'XCC', 1), server('lenovo', 'Lenovo', 'XCC', 2),
      server('hp', 'HP', 'iLO', 1), server('hp', 'HP', 'iLO', 2),
      T('pdu_sw', 'Generic', 'PDU-SW', 'Switched PDU 16 outlet', 'Power', 1, '#171717', [g('RJ45', 1, 1, 'front', 'Net '), g('Power', 16, 2, 'rear', 'Out ')]),
      // APC Smart-UPS (rack mount, with a network management card) and the service bypass panel that sits in front of them.
      T('apc_smt1500', 'APC', 'SMT1500RMI2UC', 'APC Smart-UPS 1500VA 2U (SMT1500RMI2UC)', 'Power', 2, '#1c1917',
        [g('RJ45', 1, 1, 'rear', 'NMC ', 1), g('RJ45', 1, 1, 'rear', 'Serial ', 1), g('USB', 1, 1, 'rear', 'USB ', 1), g('Power', 1, 1, 'rear', 'AC in ', 1), g('Power', 4, 1, 'rear', 'C13 ', 1)]),
      T('apc_smt3000', 'APC', 'SMT3000RMI2UC', 'APC Smart-UPS 3000VA 2U (SMT3000RMI2UC)', 'Power', 2, '#1c1917',
        [g('RJ45', 1, 1, 'rear', 'NMC ', 1), g('RJ45', 1, 1, 'rear', 'Serial ', 1), g('USB', 1, 1, 'rear', 'USB ', 1), g('Power', 1, 1, 'rear', 'AC in ', 1), g('Power', 8, 2, 'rear', 'C13 ', 1), g('Power', 1, 1, 'rear', 'C19 ', 1)]),
      T('apc_sbp3000', 'APC', 'SBP3000RMI', 'APC Service Bypass Panel 3000VA (SBP3000RMI)', 'Power', 1, '#292524',
        [g('Power', 1, 1, 'rear', 'Mains in ', 1), g('Power', 1, 1, 'rear', 'To UPS ', 1), g('Power', 1, 1, 'rear', 'From UPS ', 1), g('Power', 8, 2, 'rear', 'Out ', 1)]),
    ].map((t) => {
      t.groups = t.groups.filter((x) => x.count > 0);
      // UniFi rack gear (switches, gateways, recorders) has the small front screen.
      if (t.maker === 'Ubiquiti' && t.units >= 1 && ['Switch', 'Gateway', 'NVR'].includes(t.category)) t.screen = true;
      return t;
    });
  };

  function emptyWorkspace() {
    return {
      version: 1,
      workspace: 'My workspace',
      sites: [], floors: [], rooms: [], racks: [],
      templates: RB.defaultTemplates(), libraryVersion: RB.LIBRARY_VERSION,
      devices: [], connections: [], vlans: [], wlans: [], rackStandards: [], history: [],
    };
  }

  /** A small example so the tool is not empty on first open. */
  RB.demoWorkspace = function () {
    const s = emptyWorkspace();
    s.workspace = 'Example workspace';
    s.sites.push({ id: 'site_1', name: 'Head office', code: 'HQ', address: '12 Example Street', contact: 'Facilities desk', notes: '', lat: -37.8136, lon: 144.9631,
      nets: { vlan_1: { subnet: '10.0.10.0/24', gateway: '10.0.10.1' }, vlan_2: { subnet: '10.0.20.0/24', gateway: '10.0.20.1' }, vlan_3: { subnet: '10.0.30.0/24', gateway: '10.0.30.1' }, vlan_4: { subnet: '10.0.99.0/24', gateway: '10.0.99.1' } } });
    s.sites.push({ id: 'site_2', name: 'Regional site', code: 'RG1', address: 'Example Road, Warragul', contact: '', notes: 'Same VLAN colours as head office, its own IP ranges.', lat: -38.1597, lon: 145.9314,
      nets: { vlan_1: { subnet: '10.1.10.0/24', gateway: '10.1.10.1' }, vlan_2: { subnet: '10.1.20.0/24', gateway: '10.1.20.1' }, vlan_3: { subnet: '10.1.30.0/24', gateway: '10.1.30.1' }, vlan_4: { subnet: '10.1.99.0/24', gateway: '10.1.99.1' } } });
    s.rooms.push({ id: 'room_srv', siteId: 'site_1', floorId: null, name: 'Main comms room', notes: '', plan: null });
    s.rooms.push({ id: 'room_off', siteId: 'site_1', floorId: null, name: 'Open office', notes: '', plan: null });
    s.racks.push({ id: 'rack_1', roomId: 'room_srv', name: 'RK01', units: 24, numbering: 'bottom', notes: 'Main distribution rack. Keys are at the facilities desk.', pos: { x: 30, y: 40 } });
    s.vlans.push({ id: 'vlan_1', vid: 10, name: 'Office', subnet: '10.0.10.0/24', color: '#2563eb', lead: 'Blue' });
    s.vlans.push({ id: 'vlan_2', vid: 20, name: 'Voice', subnet: '10.0.20.0/24', color: '#16a34a', lead: 'Yellow' });
    s.vlans.push({ id: 'vlan_3', vid: 30, name: 'Cameras', subnet: '10.0.30.0/24', color: '#f59e0b', lead: 'Red' });
    s.vlans.push({ id: 'vlan_4', vid: 99, name: 'Management', subnet: '10.0.99.0/24', color: '#9333ea', lead: 'Black' });
    s.wlans.push({ id: 'wlan_1', ssid: 'Office', vlanId: 'vlan_1', security: 'WPA3', band: '2.4 / 5 GHz' });

    function dev(id, tpl, name, pos, extra) {
      s.devices.push(Object.assign({
        id, templateId: tpl, name, rackId: pos != null ? 'rack_1' : null, roomId: pos != null ? null : 'room_off',
        position: pos, ip: '', serial: '', assetTag: '', purchaseDate: '', startDate: '', notes: '', photo: null, portMeta: {},
      }, extra || {}));
    }
    dev('dev_pp1', 'tpl_pp24', 'PP-A', 22);
    dev('dev_cm1', 'tpl_cm', 'Cable manager', 21);
    dev('dev_sw1', 'tpl_ui_usw24poe', 'SW-CORE-01', 20, { ip: '10.0.99.2', serial: 'SN-0042-A', purchaseDate: '2025-03-01', startDate: '2025-03-15' });
    dev('dev_fw1', 'tpl_ui_uxgpro', 'FW-01', 18, { ip: '10.0.99.1' });
    dev('dev_rt1', 'tpl_rt', 'ISP router', 17, { notes: 'Provided by the internet provider.' });
    dev('dev_srv1', 'tpl_srv_dell_2u', 'SRV-HOST-01', 13, { ip: '10.0.99.10' });
    dev('dev_ups1', 'tpl_apc_smt3000', 'UPS-01', 2, { ip: '10.0.99.20', notes: 'APC Smart-UPS 3000 with network management card.' });
    dev('dev_byp1', 'tpl_apc_sbp3000', 'UPS-BYPASS-01', 4, { notes: 'Service bypass for UPS-01.' });
    dev('dev_wo1', 'tpl_wo2', 'WO-101', null, { pos: { x: 25, y: 30 } });
    dev('dev_wo2', 'tpl_wo2', 'WO-102', null, { pos: { x: 55, y: 30 } });
    dev('dev_ap1', 'tpl_ap', 'AP-01', null, { pos: { x: 45, y: 65 } });
    dev('dev_pc1', 'tpl_pc', 'Reception PC', null, { pos: { x: 20, y: 70 } });

    const pm = (d, key, meta) => { s.devices.find((x) => x.id === d).portMeta[key] = meta; };
    pm('dev_sw1', 'g0n0', { label: 'Reception', vlan: 'vlan_1' });
    pm('dev_sw1', 'g0n1', { label: 'Office desk 2', vlan: 'vlan_1' });
    pm('dev_sw1', 'g0n2', { label: 'AP-01', vlan: 'vlan_1' });
    pm('dev_sw1', 'g0n22', { label: 'Uplink FW', vlan: 'vlan_4' });

    function con(a, ap, b, bp, cable, color) {
      s.connections.push({ id: RB.uid('con'), a: { d: a, p: ap }, b: { d: b, p: bp }, cable: cable || 'Cat6', color: color || '#2563eb', length: '', label: '' });
    }
    con('dev_pp1', 'g0n0', 'dev_sw1', 'g0n0', 'Cat6', '#2563eb');
    con('dev_pp1', 'g0n1', 'dev_sw1', 'g0n1', 'Cat6', '#2563eb');
    con('dev_pp1', 'g0n2', 'dev_sw1', 'g0n2', 'Cat6', '#16a34a');
    con('dev_sw1', 'g0n22', 'dev_fw1', 'g0n1', 'Cat6a', '#dc2626');
    con('dev_fw1', 'g0n0', 'dev_rt1', 'g0n0', 'Cat6a', '#f59e0b');
    con('dev_sw1', 'g0n23', 'dev_srv1', 'g1n0', 'Cat6a', '#9333ea');
    con('dev_sw1', 'g0n20', 'dev_ups1', 'g0n0', 'Cat6', '#171717');
    pm('dev_sw1', 'g0n20', { label: 'UPS-01 NMC', vlan: 'vlan_4' });
    // Rear of the patch panel to the wall outlets in the office.
    con('dev_pp1', 'g0n0r', 'dev_wo1', 'g0n0r', 'Cat6', '#a3a3a3');
    con('dev_pp1', 'g0n1r', 'dev_wo1', 'g0n1r', 'Cat6', '#a3a3a3');
    con('dev_pp1', 'g0n2r', 'dev_wo2', 'g0n0r', 'Cat6', '#a3a3a3');
    con('dev_wo1', 'g0n0', 'dev_pc1', 'g0n0', 'Cat6', '#525252');
    con('dev_wo2', 'g0n0', 'dev_ap1', 'g0n0', 'Cat6', '#525252');
    s.history.push({ ts: Date.now(), text: 'Example workspace created' });
    return s;
  };

  RB.emptyWorkspace = emptyWorkspace;

  /** Fill in anything an older or hand-edited file may lack, and drop broken links. */
  function normalise(s) {
    if (RB.get) RB.get.reset();
    const base = emptyWorkspace();
    for (const k of Object.keys(base)) if (s[k] == null) s[k] = base[k];
    ['sites', 'floors', 'rooms', 'racks', 'templates', 'devices', 'connections', 'vlans', 'wlans', 'rackStandards', 'history']
      .forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
    s.devices.forEach((d) => { if (!d.portMeta || typeof d.portMeta !== 'object') d.portMeta = {}; });
    // Each site keeps its own IP range for every VLAN; the VLAN numbers, names and colours are shared by all sites.
    s.sites.forEach((x) => {
      if (!x.nets || typeof x.nets !== 'object' || Array.isArray(x.nets)) x.nets = {};
      ['lat', 'lon'].forEach((k) => { const v = parseFloat(x[k]); x[k] = Number.isFinite(v) ? v : null; });
      if (x.lat != null && Math.abs(x.lat) > 90) x.lat = null;
      if (x.lon != null && Math.abs(x.lon) > 180) x.lon = null;
    });
    s.racks.forEach((r) => { r.units = RB.clamp(parseInt(r.units, 10) || 42, 1, 60); if (!r.numbering) r.numbering = 'bottom'; });
    // Comms rooms sit under a site, either directly or through a floor / building.
    s.rooms.forEach((r) => {
      if (!r.floorId) r.floorId = null;
      const f = r.floorId && s.floors.find((x) => x.id === r.floorId);
      if (r.floorId && !f) r.floorId = null;
      if (f) r.siteId = f.siteId;
    });
    // Workspaces saved before the bigger device library get its new models added once.
    if ((s.libraryVersion || 1) < RB.LIBRARY_VERSION) {
      const have = new Set(s.templates.map((t) => t.id));
      const fresh = RB.extraTemplates().concat(RB.defaultTemplates());
      fresh.forEach((t) => { if (!have.has(t.id)) { s.templates.push(t); have.add(t.id); } });
      // Existing UniFi templates gain the front screen.
      s.templates.forEach((t) => { const f = fresh.find((x) => x.id === t.id); if (f && f.screen && !t.screen) t.screen = true; });
      // Retired templates go, unless a device still uses them.
      const used = new Set(s.devices.map((d) => d.templateId));
      s.templates = s.templates.filter((t) => !RB.RETIRED_TEMPLATES.includes(t.id) || used.has(t.id));
      s.libraryVersion = RB.LIBRARY_VERSION;
    }
    const devIds = new Set(s.devices.map((d) => d.id));
    s.connections = s.connections.filter((c) => c && c.a && c.b && devIds.has(c.a.d) && devIds.has(c.b.d));
    return s;
  }

  /* ---------- keeping locations in order ---------- */
  /** Natural compare: "Room 2" comes before "Room 10", and case is ignored. */
  RB.natCmp = (a, b) => String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { numeric: true, sensitivity: 'base' });
  const byName = (a, b) => RB.natCmp(a.name, b.name);
  RB.SITE_SORTS = [['az', 'Name, A to Z'], ['za', 'Name, Z to A'], ['code', 'Site code'], ['added', 'Order added']];
  /** Sites in the order the person chose (A to Z by default, so a new location lands in the right place by itself). Rooms, floors and racks are always in name order. */
  RB.sortSites = (list) => {
    const mode = (RB.ui && RB.ui.siteSort) || 'az';
    const a = list.slice();
    if (mode === 'added') return a;
    if (mode === 'za') return a.sort((x, y) => RB.natCmp(y.name, x.name));
    if (mode === 'code') return a.sort((x, y) => { const cx = x.code || '', cy = y.code || ''; return !cx !== !cy ? (cx ? -1 : 1) : RB.natCmp(cx, cy) || RB.natCmp(x.name, y.name); });
    return a.sort(byName);
  };

  const store = (RB.store = {
    state: null,
    undoStack: [],
    redoStack: [],
    listeners: [],
    // Each tenant keeps its own workspace; the first ("default") one uses the original key.
    key: KEY,
    tenantName: null,

    keyFor(tenantId) { return !tenantId || tenantId === 'default' ? KEY : KEY + ':' + tenantId; },

    tenantId: 'default',
    serverRev: 0,

    /** Take a workspace saved on the server as it is (not a change of ours, so no history or undo step). */
    adopt(next, rev) {
      this.state = normalise(next);
      this.serverRev = rev || 0;
      this.undoStack = []; this.redoStack = [];
      this.adopting = true;
      try { this.persist(); this.emit(); } finally { this.adopting = false; }
    },

    useTenant(tenantId, name) {
      this.tenantId = tenantId || 'default';
      this.key = this.keyFor(tenantId);
      this.tenantName = name || null;
      this.undoStack = []; this.redoStack = [];
      this.load();
    },

    load() {
      let s = null;
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) s = JSON.parse(raw);
      } catch (e) { s = null; }
      let fresh = s;
      if (!fresh) {
        if (this.key === KEY && RB.CONFIG.startWith !== 'blank') fresh = RB.demoWorkspace();
        else if (this.key === KEY) { fresh = emptyWorkspace(); fresh.history.push({ ts: Date.now(), text: 'Workspace created' }); }
        else { fresh = emptyWorkspace(); fresh.workspace = this.tenantName || 'New tenant'; fresh.history.push({ ts: Date.now(), text: 'Tenant created' }); }
      }
      this.state = normalise(fresh);
      if (!s) this.persist();
    },

    persist() {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.state));
        return true;
      } catch (e) {
        RB.toast('Could not save: browser storage is full. Remove large photos or floor plans.', 'error');
        return false;
      }
    },

    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach((fn) => fn(this.state)); },

    /** Change the workspace: snapshot for undo, apply, log, save, redraw. */
    commit(label, mutate) {
      // The signed-in person's role decides which changes they may make.
      if (RB.auth && !RB.auth.mayCommit(label)) { RB.auth.refuse(label); return false; }
      const before = JSON.stringify(this.state);
      const result = mutate(this.state);
      if (result === false) return false;
      this.undoStack.push(before);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
      if (label) {
        const by = RB.auth && RB.auth.currentName();
        this.state.history.unshift(by ? { ts: Date.now(), text: label, by } : { ts: Date.now(), text: label });
        if (this.state.history.length > 400) this.state.history.length = 400;
      }
      this.persist();
      this.emit();
      return true;
    },

    undo() {
      if (RB.auth && !RB.auth.can('undo')) { RB.auth.refuse('Undo'); return; }
      if (!this.undoStack.length) { RB.toast('Nothing to undo'); return; }
      this.redoStack.push(JSON.stringify(this.state));
      this.state = normalise(JSON.parse(this.undoStack.pop()));
      this.persist();
      this.emit();
      RB.toast('Undone');
    },

    redo() {
      if (RB.auth && !RB.auth.can('undo')) { RB.auth.refuse('Redo'); return; }
      if (!this.redoStack.length) { RB.toast('Nothing to redo'); return; }
      this.undoStack.push(JSON.stringify(this.state));
      this.state = normalise(JSON.parse(this.redoStack.pop()));
      this.persist();
      this.emit();
      RB.toast('Redone');
    },

    replace(next, label) {
      return this.commit(label, (s) => {
        const n = normalise(next);
        Object.keys(s).forEach((k) => delete s[k]);
        Object.assign(s, n);
      });
    },

    exportJSON() { return JSON.stringify(this.state, null, 2); },

    importJSON(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
      if (!data || typeof data !== 'object' || !Array.isArray(data.racks) || !Array.isArray(data.devices)) {
        throw new Error('That file is not a CommsAtlas export.');
      }
      return this.replace(data, 'Workspace imported from file');
    },
  });

  /* ---------- lookups ---------- */
  const S = () => store.state;
  // Lookups by id and the room / rack lists are indexed once per state, so a big workspace (hundreds of sites, thousands of racks
  // and devices) does not scan every list for every port drawn. The index is thrown away whenever the state is replaced (normalise),
  // when a drawing pass starts (RB.render) and whenever a list changes size.
  let ixCache = null;
  function ix() {
    const s = S();
    const sig = s.sites.length + '|' + s.floors.length + '|' + s.rooms.length + '|' + s.racks.length + '|' + s.devices.length + '|' + s.templates.length + '|' + s.vlans.length;
    if (ixCache && ixCache.s === s && ixCache.sig === sig) return ixCache;
    const ids = (a) => { const m = new Map(); a.forEach((x) => { if (!m.has(x.id)) m.set(x.id, x); }); return m; };
    const by = (a, key, keep) => { const m = new Map(); a.forEach((x) => { if (keep && !keep(x)) return; let l = m.get(x[key]); if (!l) m.set(x[key], (l = [])); l.push(x); }); m.forEach((l) => l.sort(byName)); return m; };
    ixCache = {
      s, sig, site: ids(s.sites), floor: ids(s.floors), room: ids(s.rooms), rack: ids(s.racks), device: ids(s.devices), template: ids(s.templates), vlan: ids(s.vlans),
      floorsBy: by(s.floors, 'siteId'), roomsBy: by(s.rooms, 'floorId', (x) => x.floorId), siteRooms: by(s.rooms, 'siteId', (x) => !x.floorId), racksBy: by(s.racks, 'roomId'),
    };
    return ixCache;
  }
  const list = (m, k) => (m.get(k) || []).slice();
  RB.get = {
    reset: () => { ixCache = null; if (RB.resetVlanMemo) RB.resetVlanMemo(); },
    site: (id) => ix().site.get(id),
    floor: (id) => ix().floor.get(id),
    room: (id) => ix().room.get(id),
    rack: (id) => ix().rack.get(id),
    device: (id) => ix().device.get(id),
    template: (id) => ix().template.get(id),
    vlan: (id) => ix().vlan.get(id),
    /** The site a device sits at. */
    siteOfDevice: (d) => RB.get.siteOfRoom(RB.get.roomOfDevice(d)),
    floorsOf: (siteId) => list(ix().floorsBy, siteId),
    roomsOf: (floorId) => list(ix().roomsBy, floorId),
    /** Comms rooms that sit straight under a site (no floor level). */
    siteRoomsOf: (siteId) => list(ix().siteRooms, siteId),
    /** The site a room belongs to, directly or through its floor. */
    siteOfRoom(room) {
      if (!room) return null;
      if (room.siteId && !room.floorId) return RB.get.site(room.siteId);
      const f = RB.get.floor(room.floorId);
      return f ? RB.get.site(f.siteId) : null;
    },
    racksOf: (roomId) => list(ix().racksBy, roomId),
    devicesInRack: (rackId) => S().devices.filter((x) => x.rackId === rackId).sort((a, b) => b.position - a.position),
    endpointsOf: (roomId) => S().devices.filter((x) => !x.rackId && x.roomId === roomId),
    /** Room a device sits in (directly or through its rack). */
    roomOfDevice(d) {
      if (!d) return null;
      if (d.rackId) { const r = RB.get.rack(d.rackId); return r ? RB.get.room(r.roomId) : null; }
      return RB.get.room(d.roomId);
    },
    /** "Head office › Ground floor › Server room" */
    pathOfRoom(room) {
      if (!room) return '';
      const f = room.floorId ? RB.get.floor(room.floorId) : null;
      const s = RB.get.siteOfRoom(room);
      return [s && s.name, f && f.name, room.name].filter(Boolean).join(' › ');
    },
    whereIsDevice(d) {
      if (!d) return '';
      if (d.rackId) { const r = RB.get.rack(d.rackId); return r ? r.name + ' · U' + d.position : ''; }
      const room = RB.get.room(d.roomId);
      return room ? room.name : 'Unplaced';
    },
  };

  /** A VLAN's IP range at one site: the site's own range, else the VLAN's usual one. */
  RB.vlanNet = function (v, siteOrId) {
    const site = typeof siteOrId === 'string' ? RB.get.site(siteOrId) : siteOrId;
    const n = (v && site && site.nets && site.nets[v.id]) || {};
    return { subnet: n.subnet || (v && v.subnet) || '', gateway: n.gateway || '', dhcp: n.dhcp || '', notes: n.notes || '', own: !!n.subnet };
  };

  /* ---------- UI preferences (not part of the workspace) ---------- */
  RB.loadUi = function () {
    const def = { face: 'front', zoom: 1, showCables: true, colorBy: 'vlan', cbv2: 1, bottomOpen: true, bottomTab: 'devices', expanded: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      const ui = Object.assign(def, saved);
      // Ports are coloured by VLAN unless someone chose otherwise after this was introduced.
      if (!saved.cbv2) { ui.colorBy = 'vlan'; ui.cbv2 = 1; }
      return ui;
    } catch (e) { return def; }
  };
  RB.saveUi = function (ui) {
    const keep = { face: ui.face, zoom: ui.zoom, showCables: ui.showCables, colorBy: ui.colorBy, cbv2: 1, bottomOpen: ui.bottomOpen, bottomTab: ui.bottomTab, expanded: ui.expanded, sel: ui.sel, nav: ui.nav, zoomMode: ui.zoomMode, libCat: ui.libCat, siteSort: ui.siteSort, lastSiteId: ui.lastSiteId };
    try { localStorage.setItem(UI_KEY, JSON.stringify(keep)); } catch (e) { /* preferences are optional */ }
  };
})();
