/*
 * CommsAtlas mock workspace: invented sites, racks and cabling that exercise every part of the app (nothing here is real customer data).
 * Not loaded by the app. Add it with a script tag, then:  const ws = RB.mockWorkspace(); RB.store.commit('Loaded mock data', (s) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, ws); });
 * Every rack is 45U. Each main rack has an APC 3000VA UPS at the bottom. The main rack has an EFG feeding six switches.
 * Cabinets are joined with FOBOT fibre trays (LC) over OS2 / OM4, with legacy SC / ST / FC and an MTP trunk as well.
 */
(function () {
  'use strict';
  const RB = window.RB;

  RB.mockWorkspace = function () {
    const s = RB.emptyWorkspace();
    s.workspace = 'Mockup test workspace';
    s.templates = RB.extraTemplates().concat(RB.defaultTemplates().filter((t) => !RB.extraTemplates().some((x) => x.id === t.id)));
    s.libraryVersion = RB.LIBRARY_VERSION;
    const tpl = (id) => { const t = s.templates.find((x) => x.id === id); if (!t) throw new Error('No template ' + id); return t; };

    /* ---------- VLANs and Wi-Fi ---------- */
    const V = {};
    [['mgmt', 10, 'Management', '#9333ea', 'Black'], ['srv', 20, 'Servers', '#dc2626', 'Red'], ['staff', 30, 'Staff', '#2563eb', 'Blue'],
      ['voice', 40, 'Voice', '#16a34a', 'Yellow'], ['cctv', 50, 'CCTV', '#f59e0b', 'Red'], ['guest', 60, 'Guest Wi-Fi', '#0891b2', 'White'],
      ['iot', 70, 'IoT and building', '#db2777', 'Blue'], ['oob', 99, 'Out of band', '#525252', 'Black']].forEach(([k, vid, name, color, lead]) => {
      V[k] = 'vlan_' + k; s.vlans.push({ id: V[k], vid, name, subnet: '', color, lead });
    });
    s.wlans.push({ id: 'wlan_staff', siteId: 'site_hq', ssid: 'Mock-Staff', vlanId: V.staff, security: 'WPA3', band: '2.4 / 5 GHz' },
      { id: 'wlan_guest', siteId: 'site_hq', ssid: 'Mock-Guest', vlanId: V.guest, security: 'WPA2', band: '2.4 / 5 GHz' },
      { id: 'wlan_iot', siteId: 'site_hq', ssid: 'Mock-IoT', vlanId: V.iot, security: 'WPA2', band: '2.4 GHz' },
      { id: 'wlan_br_staff', siteId: 'site_br', ssid: 'Mock-Staff', vlanId: V.staff, security: 'WPA2/WPA3', band: '2.4 / 5 GHz' });

    /* ---------- sites, floors, rooms, racks ---------- */
    const nets = (n) => ({ [V.mgmt]: { subnet: '10.' + n + '.10.0/24', gateway: '10.' + n + '.10.1' }, [V.srv]: { subnet: '10.' + n + '.20.0/24', gateway: '10.' + n + '.20.1' },
      [V.staff]: { subnet: '10.' + n + '.30.0/24', gateway: '10.' + n + '.30.1', dhcp: '10.' + n + '.30.50 - 10.' + n + '.30.250' }, [V.voice]: { subnet: '10.' + n + '.40.0/24', gateway: '10.' + n + '.40.1' },
      [V.cctv]: { subnet: '10.' + n + '.50.0/24', gateway: '10.' + n + '.50.1' }, [V.guest]: { subnet: '172.16.' + n + '.0/24', gateway: '172.16.' + n + '.1' },
      [V.iot]: { subnet: '10.' + n + '.70.0/24', gateway: '10.' + n + '.70.1' }, [V.oob]: { subnet: '10.' + n + '.99.0/24', gateway: '10.' + n + '.99.1' } });
    const site = (id, name, code, address, lat, lon, n, notes) => s.sites.push({ id, name, code, address, contact: 'Mock contact (test data)', notes, lat, lon, nets: nets(n) });
    site('site_hq', 'Mock Campus HQ', 'MCH', '1 Example Street, Testville', -37.8136, 144.9631, 1, 'Mock data: main campus with three cabinets joined by fibre.');
    site('site_br', 'Mock Regional Branch', 'MRB', '22 Sample Road, Branchton', -38.1597, 145.9314, 2, 'Mock data: branch with a gateway, ISP router and a fibre link back to the campus.');
    site('site_wh', 'Mock Legacy Warehouse', 'MLW', '5 Old Depot Lane, Warehouseby', -37.9, 145.1, 3, 'Mock data: older site with SC, ST and FC fibre connectors.');
    s.floors.push({ id: 'fl_a', siteId: 'site_hq', name: 'Building A' }, { id: 'fl_b', siteId: 'site_hq', name: 'Building B' }, { id: 'fl_c', siteId: 'site_hq', name: 'Plant building C' });
    const room = (id, siteId, floorId, name, notes) => s.rooms.push({ id, siteId, floorId, name, notes: notes || '', plan: null });
    room('room_mdf', 'site_hq', 'fl_a', 'Main comms room (MDF)', 'Core cabinet: gateway, six switches, servers.');
    room('room_off', 'site_hq', 'fl_a', 'Open office', 'Outlets, access points, cameras and desks (no rack).');
    room('room_idfb', 'site_hq', 'fl_b', 'Building B comms room (IDF)', 'Second cabinet, fed from the MDF over fibre.');
    room('room_idfc', 'site_hq', 'fl_c', 'Plant room (IDF)', 'Third cabinet, fed from the MDF and from Building B.');
    room('room_br', 'site_br', null, 'Branch comms cupboard');
    room('room_bro', 'site_br', null, 'Branch office', 'Outlets and desks (no rack).');
    room('room_wh', 'site_wh', null, 'Warehouse comms room');
    const rack = (id, roomId, name, notes, x) => s.racks.push({ id, roomId, name, units: 45, numbering: 'bottom', notes, pos: { x, y: 40 } });
    rack('rk_mdf', 'room_mdf', 'RK-MDF-01', 'Mock main rack. 45U, UPS at the bottom, gateway and six switches above.', 30);
    rack('rk_idfb', 'room_idfb', 'RK-IDF-B1', 'Mock second cabinet, 45U.', 30);
    rack('rk_idfc', 'room_idfc', 'RK-IDF-C1', 'Mock third cabinet, 45U.', 30);
    rack('rk_br', 'room_br', 'RK-BR-01', 'Mock branch rack, 45U.', 30);
    rack('rk_wh', 'room_wh', 'RK-WH-01', 'Mock warehouse rack, 45U, legacy fibre.', 30);

    /* ---------- devices ---------- */
    const dev = (id, tplId, name, rackId, pos, extra) => {
      const t = tpl(tplId);
      s.devices.push(Object.assign({ id, templateId: tplId, name, rackId: rackId || null, roomId: null, position: rackId ? pos : null, ip: '', serial: 'MOCK-' + id.slice(-6).toUpperCase(),
        assetTag: '', purchaseDate: '2025-01-15', startDate: '2025-02-01', notes: '', photo: null, portMeta: {} }, extra || {}));
      if (rackId && pos + Math.max(1, t.units) - 1 > 45) throw new Error(name + ' does not fit in 45U');
    };
    const loose = (id, tplId, name, roomId, x, y, extra) => { dev(id, tplId, name, null, null, extra); const d = s.devices.find((q) => q.id === id); d.roomId = roomId; d.pos = { x, y }; };

    // Main rack: UPS at the bottom, power, servers, fibre, gateway, switches 1 to 6.
    const R = 'rk_mdf';
    dev('d_ups_m', 'tpl_apc_smt3000', 'UPS-MDF-01', R, 1, { ip: '10.1.99.20', notes: 'APC Smart-UPS 3000VA with network management card.' });
    dev('d_byp_m', 'tpl_apc_sbp3000', 'UPS-MDF-BYPASS', R, 3);
    dev('d_pdu_m', 'tpl_pdu_sw', 'PDU-MDF-A', R, 4, { ip: '10.1.99.21' });
    dev('d_srv1', 'tpl_srv_dell_2u', 'SRV-HOST-01', R, 5, { ip: '10.1.20.10', platform: 'Proxmox VE 9' });
    dev('d_srv2', 'tpl_srv_hp_2u', 'SRV-HOST-02', R, 7, { ip: '10.1.20.11', platform: 'Windows Server 2025' });
    dev('d_nas', 'tpl_nas', 'NAS-01', R, 9, { ip: '10.1.20.20' });
    dev('d_blank1', 'tpl_blank', 'Blank', R, 11);
    dev('d_shelf1', 'tpl_shelf', 'Shelf', R, 12);
    dev('d_fob_a1', 'tpl_fobot24lc', 'FOBOT-A1', R, 13, { notes: 'Backbone to Building B and the plant room (OS2).' });
    dev('d_cm1', 'tpl_cm', 'Cable manager', R, 14);
    dev('d_fob_a2', 'tpl_fobot12lc', 'FOBOT-A2', R, 15, { notes: 'Diverse route to Building B (OM4), branch dark fibre and the warehouse.' });
    dev('d_cm2', 'tpl_cm', 'Cable manager', R, 16);
    dev('d_fob_a3', 'tpl_fobot12mtp', 'FOBOT-A3', R, 17, { notes: 'MTP/MPO trunk to the plant room.' });
    dev('d_efg', 'tpl_ui_efg', 'EFG-01', R, 18, { ip: '10.1.10.1' });
    dev('d_cm3', 'tpl_cm', 'Cable manager', R, 19);
    dev('d_sw1', 'tpl_ui_uswpro48poe', 'SW-01', R, 20, { ip: '10.1.10.11' });
    dev('d_pp1', 'tpl_pp48', 'PP-01', R, 21);
    dev('d_cm4', 'tpl_cm', 'Cable manager', R, 23);
    dev('d_sw2', 'tpl_ui_uswpro48poe', 'SW-02', R, 24, { ip: '10.1.10.12' });
    dev('d_pp2', 'tpl_pp48', 'PP-02', R, 25);
    dev('d_cm5', 'tpl_cm', 'Cable manager', R, 27);
    dev('d_sw3', 'tpl_ui_uswpromax48', 'SW-03', R, 28, { ip: '10.1.10.13' });
    dev('d_cm6', 'tpl_cm', 'Cable manager', R, 29);
    dev('d_sw4', 'tpl_ui_uswent48poe', 'SW-04', R, 30, { ip: '10.1.10.14' });
    dev('d_cm7', 'tpl_cm', 'Cable manager', R, 31);
    dev('d_sw5', 'tpl_ui_uswentxg24', 'SW-05', R, 32, { ip: '10.1.10.15', notes: '10G / 25G switch for the server and storage network.' });
    dev('d_cm8', 'tpl_cm', 'Cable manager', R, 33);
    dev('d_sw6', 'tpl_ui_uswpromax24poe', 'SW-06', R, 34, { ip: '10.1.10.16' });
    dev('d_cm9', 'tpl_cm', 'Cable manager', R, 35);
    dev('d_kvm', 'tpl_kvm', 'KVM-01', R, 36);
    dev('d_blank2', 'tpl_blank', 'Blank', R, 37);

    // Building B cabinet.
    const B = 'rk_idfb';
    dev('d_ups_b', 'tpl_apc_smt3000', 'UPS-IDFB-01', B, 1, { ip: '10.1.99.22' });
    dev('d_pdu_b', 'tpl_pdu_sw', 'PDU-IDFB-A', B, 3);
    dev('d_fob_b1', 'tpl_fobot24lc', 'FOBOT-B1', B, 5);
    dev('d_cmb1', 'tpl_cm', 'Cable manager', B, 6);
    dev('d_fob_b2', 'tpl_fobot12lc', 'FOBOT-B2', B, 7);
    dev('d_cmb2', 'tpl_cm', 'Cable manager', B, 8);
    dev('d_swb1', 'tpl_ui_uswpro48poe', 'SW-B1', B, 9, { ip: '10.1.10.21' });
    dev('d_ppb1', 'tpl_pp48', 'PP-B1', B, 10);
    dev('d_cmb3', 'tpl_cm', 'Cable manager', B, 12);
    dev('d_swb2', 'tpl_ui_uswpro24poe', 'SW-B2', B, 13, { ip: '10.1.10.22' });
    dev('d_ppb2', 'tpl_pp24', 'PP-B2', B, 14);
    dev('d_cmb4', 'tpl_cm', 'Cable manager', B, 15);
    dev('d_nvr', 'tpl_ui_unvrpro', 'NVR-B1', B, 16, { ip: '10.1.50.5', platform: 'UniFi Protect' });

    // Plant room cabinet.
    const C = 'rk_idfc';
    dev('d_ups_c', 'tpl_apc_smt3000', 'UPS-IDFC-01', C, 1, { ip: '10.1.99.23' });
    dev('d_fob_c1', 'tpl_fobot12lc', 'FOBOT-C1', C, 5);
    dev('d_fob_c2', 'tpl_fobot12mtp', 'FOBOT-C2', C, 6, { notes: 'MTP/MPO trunk from the MDF.' });
    dev('d_cmc1', 'tpl_cm', 'Cable manager', C, 7);
    dev('d_aggc', 'tpl_ui_uswagg', 'AGG-C1', C, 8, { ip: '10.1.10.31' });
    dev('d_swc1', 'tpl_ui_usw24poe', 'SW-C1', C, 9, { ip: '10.1.10.32', notes: 'Older switch with 1G SFP cages.' });
    dev('d_ppc1', 'tpl_pp24', 'PP-C1', C, 10);

    // Branch.
    const BR = 'rk_br';
    dev('d_ups_r', 'tpl_apc_smt3000', 'UPS-BR-01', BR, 1, { ip: '10.2.99.20' });
    dev('d_rt', 'tpl_rt', 'ISP-ROUTER-BR', BR, 5, { notes: 'Provided by the internet provider.' });
    dev('d_udm', 'tpl_ui_udmpro', 'UDM-BR-01', BR, 6, { ip: '10.2.10.1' });
    dev('d_swr', 'tpl_ui_uswpro24poe', 'SW-BR-01', BR, 7, { ip: '10.2.10.11' });
    dev('d_ppr', 'tpl_pp24', 'PP-BR-01', BR, 8);
    dev('d_fob_r1', 'tpl_fobot12lc', 'FOBOT-R1', BR, 9, { notes: 'Dark fibre back to the campus.' });

    // Warehouse (legacy fibre).
    const W = 'rk_wh';
    dev('d_ups_w', 'tpl_apc_smt3000', 'UPS-WH-01', W, 1, { ip: '10.3.99.20' });
    dev('d_fob_wsc', 'tpl_fp24sc', 'FP-WH-SC', W, 5, { notes: 'Older 62.5 µm multimode on SC.' });
    dev('d_fob_wst', 'tpl_fp12st', 'FP-WH-ST', W, 6, { notes: 'ST connectors, older building run.' });
    dev('d_fob_wfc', 'tpl_fp12fc', 'FP-WH-FC', W, 7, { notes: 'FC connectors, test and telco leftovers.' });
    dev('d_sww', 'tpl_ui_usw24', 'SW-WH-01', W, 8, { ip: '10.3.10.11' });
    dev('d_ppw', 'tpl_pp24', 'PP-WH-01', W, 9);

    // Devices that sit in rooms rather than racks.
    ['1', '2', '3', '4', '5', '6'].forEach((n, i) => loose('d_wo' + n, 'tpl_wo2', 'WO-10' + n, 'room_off', 15 + i * 14, 25));
    loose('d_ap1', 'tpl_ap', 'AP-01', 'room_off', 30, 55, { ip: '10.1.70.11' });
    loose('d_ap2', 'tpl_ap', 'AP-02', 'room_off', 70, 55, { ip: '10.1.70.12' });
    loose('d_cam1', 'tpl_cam', 'CAM-01', 'room_off', 10, 80, { ip: '10.1.50.21' });
    loose('d_cam2', 'tpl_cam', 'CAM-02', 'room_off', 90, 80, { ip: '10.1.50.22' });
    loose('d_pc1', 'tpl_pc', 'Reception PC', 'room_off', 20, 40);
    loose('d_ph1', 'tpl_phone', 'Reception phone', 'room_off', 20, 48);
    loose('d_prn', 'tpl_prn', 'Office printer', 'room_off', 50, 40);
    loose('d_scr', 'tpl_screen', 'Meeting screen', 'room_off', 80, 40);
    loose('d_wob1', 'tpl_wo2', 'WO-B01', 'room_bro', 20, 30);
    loose('d_wob2', 'tpl_wo2', 'WO-B02', 'room_bro', 40, 30);
    loose('d_apb', 'tpl_ap', 'AP-BR-01', 'room_bro', 50, 60, { ip: '10.2.70.11' });
    loose('d_pcb', 'tpl_pc', 'Branch PC', 'room_bro', 20, 50);

    /* ---------- cabling ---------- */
    const byId = (id) => s.devices.find((d) => d.id === id);
    const used = new Set();
    const portsOf = (id) => RB.portsOf(tpl(byId(id).templateId));
    /** A port by type; `o.prefix` narrows by name, `o.n` takes the nth (1-based) of those, otherwise the first one still free. */
    const pick = (id, type, o) => {
      o = o || {};
      let list = portsOf(id).filter((p) => !p.twin && p.type === type && (!o.prefix || o.prefix.test(p.name)) && (!o.side || p.side === o.side));
      const p = o.n ? list[o.n - 1] : list.find((q) => !used.has(id + '|' + q.key));
      if (!p) throw new Error('No free ' + type + ' port on ' + byId(id).name + (o.n ? ' number ' + o.n : ''));
      return p.key;
    };
    const rearOf = (key) => key + 'r';
    let cableNo = 0;
    const con = (a, ap, b, bp, cable, color, extra) => {
      for (const [d, p] of [[a, ap], [b, bp]]) {
        const port = portsOf(d).find((q) => q.key === p);
        if (!port) throw new Error('No port ' + p + ' on ' + d);
        if (used.has(d + '|' + p)) throw new Error('Port used twice: ' + byId(d).name + ' ' + p);
        used.add(d + '|' + p);
      }
      const ta = portsOf(a).find((q) => q.key === ap).type, tb = portsOf(b).find((q) => q.key === bp).type;
      if (!RB.canLink(ta, tb)) throw new Error('Cannot link ' + ta + ' to ' + tb + ' (' + byId(a).name + ' to ' + byId(b).name + ')');
      s.connections.push(Object.assign({ id: 'con_' + (++cableNo), a: { d: a, p: ap }, b: { d: b, p: bp }, cable, color, length: '', label: '' }, extra || {}));
    };
    const pm = (id, key, meta) => { const d = byId(id); d.portMeta[key] = Object.assign(d.portMeta[key] || {}, meta); };
    const vcol = (k) => s.vlans.find((v) => v.id === V[k]).color;
    const OS2 = '#eab308', OM4 = '#0891b2', OM1 = '#f59e0b', DAC = '#525252', PWR = '#0a0a0a';

    // Power: UPS to the bypass and then to the main equipment.
    s.devices.filter((d) => /^d_ups_/.test(d.id)).forEach((u) => { pm(u.id, pick(u.id, 'RJ45', { prefix: /^NMC/, n: 1 }), { label: 'Network management card', vlan: V.oob }); });
    con('d_byp_m', pick('d_byp_m', 'Power', { prefix: /^To UPS/ }), 'd_ups_m', pick('d_ups_m', 'Power', { prefix: /^AC in/ }), 'Power', PWR, { length: '1 m', label: 'Bypass to UPS' });
    [['d_efg', 1], ['d_srv1', 2], ['d_srv2', 3], ['d_nas', 4], ['d_sw1', 5], ['d_sw2', 6]].forEach(([d, i]) => {
      con(d, pick(d, 'Power'), 'd_ups_m', pick('d_ups_m', 'Power', { prefix: /^C13/, n: i }), 'Power', PWR, { length: '1 m' });
    });

    // The gateway feeds all six switches, over every kind of port it has.
    const E = 'd_efg';
    const up = (sw, type, o) => pick(sw, type, o);
    con(E, pick(E, 'RJ45', { n: 1 }), 'd_sw1', up('d_sw1', 'RJ45', { n: 48 }), 'Cat6a', vcol('mgmt'), { length: '1 m', label: 'EFG to SW-01 (RJ45)' });
    con(E, pick(E, 'RJ45', { n: 2 }), 'd_sw6', up('d_sw6', 'RJ45', { n: 24 }), 'Cat6a', vcol('mgmt'), { length: '1 m', label: 'EFG to SW-06 (RJ45)' });
    con(E, pick(E, 'SFP+', { n: 1 }), 'd_sw2', up('d_sw2', 'SFP+', { n: 1 }), 'DAC', DAC, { length: '1 m', label: 'EFG to SW-02 (SFP+ DAC)' });
    con(E, pick(E, 'SFP+', { n: 2 }), 'd_sw3', up('d_sw3', 'SFP+', { n: 1 }), 'DAC', DAC, { length: '1 m', label: 'EFG to SW-03 (SFP+ DAC)' });
    con(E, pick(E, 'SFP28', { n: 1 }), 'd_sw4', up('d_sw4', 'SFP+', { n: 1 }), 'DAC', DAC, { length: '1 m', label: 'EFG SFP28 to SW-04 SFP+ (links at 10G)' });
    con(E, pick(E, 'SFP28', { n: 2 }), 'd_sw5', up('d_sw5', 'SFP28', { n: 1 }), 'DAC', DAC, { length: '1 m', label: 'EFG to SW-05 (SFP28 DAC)' });
    pm(E, pick(E, 'Console', { n: 1 }), { label: 'Console', status: 'Reserved' });
    ['d_sw2', 'd_sw3', 'd_sw4', 'd_sw5'].forEach((sw) => pm(sw, 'g1n0', { label: 'Uplink to EFG-01', vlan: V.mgmt, tagged: 'All' }));
    pm('d_sw1', 'g0n47', { label: 'Uplink to EFG-01', vlan: V.mgmt, tagged: 'All' });
    pm('d_sw6', 'g0n23', { label: 'Uplink to EFG-01', vlan: V.mgmt, tagged: 'All' });
    // UPS network card and the servers on the switches.
    con('d_sw1', pick('d_sw1', 'RJ45', { n: 47 }), 'd_ups_m', pick('d_ups_m', 'RJ45', { prefix: /^NMC/ }), 'Cat6', vcol('oob'), { length: '1 m', label: 'UPS-MDF-01 NMC' });
    pm('d_sw1', 'g0n46', { label: 'UPS-MDF-01 NMC', vlan: V.oob });
    const srvLink = (srv, sw, swPort, label, vlan) => {
      con(srv, pick(srv, 'RJ45', { prefix: /^(NIC|LAN)/ }), sw, pick(sw, 'RJ45', { n: swPort }), 'Cat6a', vcol(vlan), { length: '2 m', label });
      pm(sw, 'g0n' + (swPort - 1), { label, vlan: V[vlan] });
    };
    srvLink('d_srv1', 'd_sw1', 45, 'SRV-HOST-01 NIC 1', 'srv');
    srvLink('d_srv2', 'd_sw1', 46, 'SRV-HOST-02 NIC 1', 'srv');
    srvLink('d_nas', 'd_sw1', 44, 'NAS-01 LAN 1', 'srv');
    con('d_srv1', pick('d_srv1', 'SFP+'), 'd_sw5', pick('d_sw5', 'SFP28', { n: 2 }), 'DAC', DAC, { length: '1 m', label: 'SRV-HOST-01 SFP+ to SW-05 SFP28' });
    con('d_nas', pick('d_nas', 'SFP+'), 'd_sw3', pick('d_sw3', 'SFP+', { n: 4 }), 'DAC', DAC, { length: '1 m', label: 'NAS-01 SFP+ to SW-03' });

    // Patch panels: front to the switch, rear to the wall outlets. A mix of VLANs, statuses and cable types.
    const patch = (pp, sw, count, vlanFor, cableFor) => {
      for (let i = 1; i <= count; i++) {
        const vk = vlanFor(i);
        con(pp, 'g0n' + (i - 1), sw, pick(sw, 'RJ45', { n: i }), cableFor(i), vcol(vk), { length: '0.5 m' });
        pm(sw, 'g0n' + (i - 1), { vlan: V[vk], label: pp.replace('d_', '').toUpperCase() + ' ' + i, status: 'Active' });
      }
    };
    patch('d_pp1', 'd_sw1', 24, (i) => (i <= 16 ? 'staff' : i <= 20 ? 'voice' : 'cctv'), (i) => (i % 5 === 0 ? 'Cat6a' : 'Cat6'));
    patch('d_pp2', 'd_sw2', 16, (i) => (i <= 10 ? 'staff' : 'iot'), () => 'Cat6');
    for (let i = 40; i <= 43; i++) pm('d_sw1', 'g0n' + (i - 1), { label: 'Spare', status: 'Spare' });
    pm('d_sw1', 'g0n38', { label: 'Reserved for expansion', status: 'Reserved' });
    pm('d_sw1', 'g0n37', { label: 'Switched off', status: 'Disabled', notes: 'Disabled in UniFi' });
    pm('d_sw1', 'g0n36', { label: 'Damaged socket', status: 'Faulty' });
    // Rear of PP-01 to the office outlets, and the outlets to devices.
    ['1', '2', '3', '4', '5', '6'].forEach((n, i) => {
      con('d_pp1', rearOf('g0n' + (i * 2)), 'd_wo' + n, 'g0n0r', 'Cat6', '#a3a3a3', { length: '25 m' });
      con('d_pp1', rearOf('g0n' + (i * 2 + 1)), 'd_wo' + n, 'g0n1r', 'Cat6', '#a3a3a3', { length: '25 m' });
    });
    con('d_wo1', 'g0n0', 'd_pc1', 'g0n0', 'Cat6', '#525252', { length: '2 m' });
    con('d_wo1', 'g0n1', 'd_ph1', 'g0n0', 'Cat6', '#525252', { length: '2 m' });
    con('d_wo2', 'g0n0', 'd_prn', 'g0n0', 'Cat6', '#525252', { length: '2 m' });
    con('d_wo3', 'g0n0', 'd_ap1', 'g0n0', 'Cat6a', '#525252', { length: '3 m' });
    con('d_wo4', 'g0n0', 'd_ap2', 'g0n0', 'Cat6a', '#525252', { length: '3 m' });
    con('d_wo5', 'g0n0', 'd_cam1', 'g0n0', 'Cat6', '#525252', { length: '3 m' });
    con('d_wo6', 'g0n0', 'd_cam2', 'g0n0', 'Cat6', '#525252', { length: '3 m' });
    con('d_wo2', 'g0n1', 'd_scr', 'g0n0', 'Cat6', '#525252', { length: '2 m' });

    // Fibre: switch SFP+ to a FOBOT front adapter (patch cable), FOBOT rear to the next cabinet's FOBOT rear (backbone).
    const lead = (sw, type, n, fob, port, label, cable) => {
      con(sw, pick(sw, type, { n }), fob, 'g0n' + (port - 1), cable || 'OM4', cable === 'OS2' ? OS2 : OM4, { length: '2 m', label });
    };
    const backbone = (fa, pa, fb, pb, cable, label, length) => {
      con(fa, rearOf('g0n' + (pa - 1)), fb, rearOf('g0n' + (pb - 1)), cable, cable === 'OS2' ? OS2 : cable === 'OM1' || cable === 'OM2' ? OM1 : OM4, { length, label });
    };
    lead('d_sw2', 'SFP+', 2, 'd_fob_a1', 1, 'SW-02 to Building B (OS2 path)');
    lead('d_sw3', 'SFP+', 2, 'd_fob_a1', 2, 'SW-03 to the plant room');
    lead('d_sw3', 'SFP+', 3, 'd_fob_a2', 1, 'SW-03 to Building B (diverse path)');
    lead('d_sw4', 'SFP+', 2, 'd_fob_a2', 2, 'SW-04 dark fibre to the branch');
    lead('d_sw4', 'SFP+', 3, 'd_fob_a2', 3, 'SW-04 to the warehouse');
    backbone('d_fob_a1', 1, 'd_fob_b1', 1, 'OS2', 'MDF to Building B', '180 m');
    backbone('d_fob_a1', 2, 'd_fob_c1', 1, 'OS2', 'MDF to the plant room', '240 m');
    backbone('d_fob_a2', 1, 'd_fob_b2', 1, 'OM4', 'MDF to Building B (diverse route)', '210 m');
    backbone('d_fob_b1', 3, 'd_fob_c1', 2, 'OS2', 'Building B to the plant room', '95 m');
    backbone('d_fob_a2', 2, 'd_fob_r1', 1, 'OS2', 'Campus to branch dark fibre', '9 km');
    backbone('d_fob_a2', 3, 'd_fob_wsc', 1, 'OM1', 'Campus to warehouse (LC to SC)', '1.2 km');
    backbone('d_fob_a3', 1, 'd_fob_c2', 1, 'OM4', 'MTP/MPO trunk MDF to plant room', '240 m');
    // Building B.
    lead('d_swb1', 'SFP+', 1, 'd_fob_b1', 1, 'SW-B1 uplink', 'OS2');
    lead('d_swb2', 'SFP+', 1, 'd_fob_b2', 1, 'SW-B2 uplink (diverse)', 'OM4');
    con('d_swb2', pick('d_swb2', 'SFP+', { n: 2 }), 'd_swb1', pick('d_swb1', 'SFP+', { n: 2 }), 'DAC', DAC, { length: '1 m', label: 'SW-B1 to SW-B2 stack link' });
    con('d_nvr', pick('d_nvr', 'SFP+'), 'd_swb1', pick('d_swb1', 'SFP+', { n: 3 }), 'DAC', DAC, { length: '1 m', label: 'NVR-B1 to SW-B1' });
    patch('d_ppb1', 'd_swb1', 12, (i) => (i <= 6 ? 'staff' : 'cctv'), () => 'Cat6');
    patch('d_ppb2', 'd_swb2', 8, () => 'iot', () => 'Cat5e');
    // Plant room (many fibre kinds).
    con('d_aggc', pick('d_aggc', 'SFP+', { n: 1 }), 'd_fob_c1', 'g0n0', 'OS2', OS2, { length: '2 m', label: 'AGG-C1 uplink to MDF (OS2)' });
    con('d_aggc', pick('d_aggc', 'SFP+', { n: 2 }), 'd_fob_c1', 'g0n1', 'OS2', OS2, { length: '2 m', label: 'AGG-C1 second uplink via Building B' });
    con('d_swc1', pick('d_swc1', 'SFP', { n: 1 }), 'd_aggc', pick('d_aggc', 'SFP+', { n: 3 }), 'DAC', DAC, { length: '1 m', label: 'SW-C1 1G SFP to AGG-C1 SFP+' });
    patch('d_ppc1', 'd_swc1', 10, () => 'iot', () => 'Cat6');
    // Branch.
    con('d_rt', 'g0n0', 'd_udm', pick('d_udm', 'RJ45', { prefix: /^WAN/ }), 'Cat6a', '#14532d', { length: '1 m', label: 'ISP handoff to UDM WAN' });
    con('d_udm', pick('d_udm', 'SFP+', { prefix: /^SFP\+ LAN/ }), 'd_swr', pick('d_swr', 'SFP+', { n: 1 }), 'DAC', DAC, { length: '1 m', label: 'UDM to SW-BR-01' });
    lead('d_swr', 'SFP+', 2, 'd_fob_r1', 1, 'Branch uplink to campus');
    patch('d_ppr', 'd_swr', 8, (i) => (i <= 4 ? 'staff' : 'voice'), () => 'Cat6');
    con('d_ppr', rearOf('g0n0'), 'd_wob1', 'g0n0r', 'Cat6', '#a3a3a3', { length: '15 m' });
    con('d_ppr', rearOf('g0n1'), 'd_wob2', 'g0n0r', 'Cat6', '#a3a3a3', { length: '15 m' });
    con('d_ppr', rearOf('g0n2'), 'd_wob1', 'g0n1r', 'Cat6', '#a3a3a3', { length: '15 m' });
    con('d_wob1', 'g0n0', 'd_pcb', 'g0n0', 'Cat6', '#525252', { length: '2 m' });
    con('d_wob2', 'g0n0', 'd_apb', 'g0n0', 'Cat6a', '#525252', { length: '3 m' });
    // Warehouse: SC, ST and FC panels and older multimode.
    con('d_sww', pick('d_sww', 'SFP', { n: 1 }), 'd_fob_wsc', 'g0n0', 'OM1', OM1, { length: '2 m', label: 'SW-WH-01 uplink (SFP to SC)' });
    con('d_sww', pick('d_sww', 'SFP', { n: 2 }), 'd_fob_wst', 'g0n0', 'OM2', OM1, { length: '2 m', label: 'SW-WH-01 to the old building (SFP to ST)' });
    backbone('d_fob_wst', 1, 'd_fob_wfc', 1, 'OM2', 'Old building run (ST to FC)', '120 m');
    backbone('d_fob_wsc', 2, 'd_fob_wst', 2, 'OM1', 'Spare SC to ST run', '60 m');
    patch('d_ppw', 'd_sww', 6, () => 'iot', () => 'Cat5e');

    // Documented spare and reserved fibre so the registers show more than the cabled links.
    pm('d_fob_a1', 'g0n2', { label: 'Spare pair', status: 'Spare' });
    pm('d_fob_a1', 'g0n3', { label: 'Reserved (future building D)', status: 'Reserved' });
    pm('d_fob_a3', 'g0n1', { label: 'Spare MTP trunk', status: 'Spare' });

    // What a UniFi pull would have kept for the campus (invented), so the site page's boxes show a recorder and cameras.
    s.sites[0].unifi = { at: new Date().toISOString(), from: 'Mock UniFi', console: { model: 'UniFi Enterprise Fortress Gateway', firmware: '5.0.0', name: 'EFG-01', timezone: 'Australia/Melbourne', isp: 'Mock ISP', wanIp: '203.0.113.10', wanUptimePct: 100, devices: 18, offlineDevices: 0, pendingUpdates: 1 },
      system: { version: '10.0.0' }, wans: ['Mock fibre', 'Mock backup 4G'],
      protect: { version: '6.0.0', devices: [{ kind: 'nvr', name: 'NVR-B1', model: 'UNVR-Pro', mac: '00:00:5e:00:53:01' }, { kind: 'camera', name: 'CAM-01', model: 'UVC G5 Bullet', state: 'CONNECTED', mac: '00:00:5e:00:53:21' }, { kind: 'camera', name: 'CAM-02', model: 'UVC G5 Dome', state: 'CONNECTED', mac: '00:00:5e:00:53:22' }] } };
    s.history.push({ ts: Date.now(), text: 'Mockup test workspace created (invented data, no real sites)' });
    return s;
  };
})();
