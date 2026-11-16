// UniFi connector, part 2: the few site facts beyond devices and ports that this system keeps.
// What it reads (all read-only, all with the same X-API-KEY): from Site Manager the console and its site (model, firmware, WAN and ISP); from the
// console's Network API the Wi-Fi broadcasts and WANs; from the older Network API the Wi-Fi networks with the VLAN each one uses, the system
// information and every wired client (so a port can name what is plugged into it); and from Protect the recorder and the UniFi cameras.
// Firewall rules, VPN, DNS, RADIUS and the like are not pulled: nothing here uses them. Every call is optional; one that is refused or missing is
// noted in the diagnostics and the rest carry on. Wi-Fi passphrases are never read.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

partial class UnifiConnector
{
    /** Where a background pull reports what it is doing (the page shows the latest line). */
    public static readonly AsyncLocal<Action<string>?> Say = new();
    static void Progress(string s) { try { Say.Value?.Invoke(s); } catch (Exception) { /* progress is only for show */ } }

    static JsonNode? At(JsonNode? n, string path)
    {
        foreach (var p in path.Split('.')) { n = (n as JsonObject)?[p]; if (n is null) return null; }
        return n;
    }

    static JsonNode? Scalar(JsonNode? n) => n is null ? null : n is JsonValue ? n.DeepClone() : JsonValue.Create(Snip(n.ToJsonString()));

    /** The chosen fields of each item (a column is an output name and a dotted path into the item), skipping what is missing. */
    static JsonArray Compact(IEnumerable<JsonNode> items, int cap, params (string key, string path)[] cols)
    {
        var a = new JsonArray();
        foreach (var it in items.Take(cap))
        {
            var o = new JsonObject();
            foreach (var (k, p) in cols) if (Scalar(At(it, p)) is { } v) o[k] = v;
            a.Add(o);
        }
        return a;
    }

    static string Shape(IEnumerable<JsonNode> items) => items.FirstOrDefault() is JsonObject o ? string.Join(", ", o.Select(kv => kv.Key)) : "";

    /** What Site Manager says about a console and its site, kept to what is useful on a site's page. Account details (email, permissions) are not copied. */
    static JsonObject ConsoleInfo(JsonNode? host, List<JsonNode> smSites)
    {
        var o = new JsonObject();
        var rs = (host as JsonObject)?["reportedState"];
        var st = smSites.FirstOrDefault();
        void Put(string key, JsonNode? v) { if (v is JsonValue && Str(v).Length > 0) o[key] = v.DeepClone(); }
        Put("model", At(rs, "hardware.name") ?? At(rs, "name")); Put("firmware", At(rs, "hardware.firmwareVersion")); Put("shortname", At(rs, "hardware.shortname"));
        Put("name", At(rs, "name") ?? At(rs, "hostname")); Put("country", At(rs, "country"));
        Put("ip", host?["ipAddress"]); Put("lastSeenChange", host?["lastConnectionStateChange"]); Put("lastBackup", host?["latestBackupTime"]); Put("owner", host?["owner"]);
        Put("timezone", At(st, "meta.timezone")); Put("isp", At(st, "statistics.ispInfo.name")); Put("wanIp", At(st, "statistics.wans.WAN.externalIp"));
        Put("wanUptimePct", At(st, "statistics.percentages.wanUptime")); Put("devices", At(st, "statistics.counts.totalDevice")); Put("offlineDevices", At(st, "statistics.counts.offlineDevice"));
        Put("pendingUpdates", At(st, "statistics.counts.pendingUpdateDevice")); Put("wifiClients", At(st, "statistics.counts.wifiClient")); Put("wiredClients", At(st, "statistics.counts.wiredClient"));
        return o;
    }

    /** Site Manager's own view of a device: whether its firmware is current and whether an update is waiting. */
    static void AddSiteManagerFacts(JsonObject device, JsonNode? sm)
    {
        if (sm is not JsonObject s) return;
        var o = new JsonObject();
        foreach (var k in new[] { "shortname", "version", "firmwareStatus", "updateAvailable", "adoptionTime", "note" })
            if (s[k] is JsonValue v && Str(v).Length > 0) o[k] = v.DeepClone();
        if (o.Count > 0) device["cloud"] = o;
    }

    static async Task<List<JsonNode>> Items(HttpClient hc, string url, string key, CancellationToken ct)
    {
        var j = await Get(hc, url, key, ct);
        if (j is JsonArray a) return a.Where(x => x is not null).Select(x => x!).ToList();
        if (j is JsonObject o && o["data"] is JsonArray d) return d.Where(x => x is not null).Select(x => x!).ToList();
        return j is JsonObject ? new List<JsonNode> { j } : new List<JsonNode>();
    }

    /** A camera Protect adopted is a UniFi camera; a third-party (ONVIF) one carries its maker's name as its type. */
    static bool IsUnifiCamera(string type) => !Regex.IsMatch(type, @"hikvision|dahua|axis|hanwha|vivotek|reolink|amcrest|bosch|panasonic|onvif|uniview|lorex|swann", RegexOptions.IgnoreCase);

    /**
     * What else this system keeps about one site, added to the site result as `info` (system, wifi, wlans, wans), `clients` (the wired clients that
     * sit on a switch port) and `protect` (the recorder and the UniFi cameras). Sections that fail are left out and explained in the diagnostics.
     */
    async Task GatherInfo(JsonObject site, HttpClient hc, string api, string legacy, string protect, string sid, string iref, string key, SiteInfo si, JsonArray diag, string label, CancellationToken ct)
    {
        var info = new JsonObject();
        var lg = legacy + Uri.EscapeDataString(iref);
        var sp = api + "/sites/" + sid;
        using var gate = new SemaphoreSlim(4);
        var jobs = new List<(string name, JsonArray d, Task<JsonNode?> t)>();
        var finished = 0;
        var say = Say.Value;
        Progress(label + ": reading Wi-Fi, WAN and Protect");
        void Job(string name, Func<JsonArray, Task<JsonNode?>> work)
        {
            var d = new JsonArray();
            jobs.Add((name, d, Task.Run<JsonNode?>(async () =>
            {
                await gate.WaitAsync(ct);
                try { return await work(d); }
                catch (ConnectorException e) { d.Add(label + " " + name + ": " + e.Message); return null; }
                finally { gate.Release(); say?.Invoke(label + ": " + name + " read (" + Interlocked.Increment(ref finished) + " of " + jobs.Count + ")"); }
            })));
        }

        Job("wifi", async d =>
        {
            var l = await Paged(hc, sp + "/wifi/broadcasts", key, ct);
            d.Add(label + " wifi (Network API): " + l.Count + " found; fields: " + Shape(l));
            var arr = new JsonArray();
            foreach (var w in l.Take(40))
            {
                var o = new JsonObject { ["name"] = Str(w["name"]), ["enabled"] = w["enabled"]?.DeepClone(), ["security"] = Str(w["securityConfiguration"]?["type"]) };
                var netId = Str(w["network"]?["networkId"]);
                if (netId.Length > 0 && si.Nets.TryGetValue(netId, out var nv)) { o["vlan"] = nv.vid; o["vlanName"] = nv.name; }
                if (w["broadcastingFrequenciesGHz"] is JsonArray fr) o["bands"] = string.Join(", ", fr.Select(Str));
                arr.Add(o);
            }
            return arr;
        });
        Job("wans", async d =>
        {
            var l = await Paged(hc, sp + "/wans", key, ct);
            d.Add(label + " wans: " + l.Count + " found");
            return l.Count == 0 ? null : Compact(l, 20, ("name", "name"));
        });
        // The older API knows the network (VLAN) of each Wi-Fi network. The passphrase (x_passphrase) is deliberately not read.
        Job("wlans", async d =>
        {
            var j = await Get(hc, lg + "/rest/wlanconf", key, ct);
            var rows = (j["data"] as JsonArray ?? new JsonArray()).Where(x => x is not null).Select(x => x!).ToList();
            d.Add(label + " wlans (legacy): " + rows.Count + " found");
            var arr = new JsonArray();
            foreach (var w in rows.Take(60))
            {
                var vid = FirstBool(w, "vlan_enabled") == true ? FirstInt(w, "vlan") : null;
                string vname = "";
                var nid = Str(w["networkconf_id"]);
                if (vid is null && nid.Length > 0 && si.Nets.TryGetValue(nid, out var nv)) { vid = nv.vid; vname = nv.name; }
                else if (vid is not null) vname = si.Nets.Values.FirstOrDefault(x => x.vid == vid.Value).name ?? "";
                arr.Add(new JsonObject
                {
                    ["name"] = Str(w["name"]), ["enabled"] = FirstBool(w, "enabled") ?? true, ["security"] = Str(w["security"]), ["wpaMode"] = Str(w["wpa_mode"]), ["wpa3"] = FirstBool(w, "wpa3_support") ?? false,
                    ["vlan"] = vid, ["vlanName"] = vname, ["guest"] = FirstBool(w, "is_guest") ?? false, ["hidden"] = FirstBool(w, "hide_ssid") ?? false,
                    ["bands"] = (w["wlan_bands"] as JsonArray) is { } b ? string.Join(", ", b.Select(Str)) : Str(w["wlan_band"]),
                });
            }
            return arr;
        });
        Job("system", async d =>
        {
            var j = await Get(hc, lg + "/stat/sysinfo", key, ct);
            var row = (j["data"] as JsonArray)?.FirstOrDefault();
            if (row is null) return null;
            var o = new JsonObject();
            foreach (var k in new[] { "name", "hostname", "version", "timezone", "update_available" }) if (Scalar(row[k]) is { } v) o[k] = v;
            return o;
        });

        // Protect: the recorder, and the cameras Protect adopted (UniFi cameras only).
        Job("protect", async d =>
        {
            var meta = await Get(hc, protect + "/meta/info", key, ct);
            var po = new JsonObject { ["version"] = Str(meta["applicationVersion"]) };
            var arr = new JsonArray();
            try
            {
                foreach (var n in await Items(hc, protect + "/nvrs", key, ct))
                    arr.Add(new JsonObject { ["kind"] = "nvr", ["id"] = Str(n["id"]), ["name"] = FirstStr(n, "name", "type"), ["mac"] = Str(n["mac"]).ToLowerInvariant(), ["model"] = Str(n["type"]), ["state"] = "" });
            }
            catch (ConnectorException e) { d.Add(label + " protect recorder: " + e.Message); }
            try
            {
                var cams = await Items(hc, protect + "/cameras", key, ct);
                var own = cams.Where(c => IsUnifiCamera(Str(c["type"]))).ToList();
                d.Add(label + " protect cameras: " + cams.Count + " found, " + own.Count + " UniFi; fields: " + Shape(cams));
                foreach (var c in own.Take(300))
                    arr.Add(new JsonObject { ["kind"] = "camera", ["id"] = Str(c["id"]), ["name"] = FirstStr(c, "name", "type"), ["mac"] = Str(c["mac"]).ToLowerInvariant(), ["model"] = Str(c["type"]), ["state"] = Str(c["state"]) });
            }
            catch (ConnectorException e) { d.Add(label + " protect cameras: " + e.Message); }
            po["devices"] = arr;
            return po;
        });

        var summary = new List<string>();
        foreach (var (name, d, t) in jobs)
        {
            var r = await t;
            foreach (var x in d) diag.Add(x!.DeepClone());
            if (r is null) continue;
            if (name == "protect") { site["protect"] = r; summary.Add("protect " + ((r["devices"] as JsonArray)?.Count ?? 0)); continue; }
            info[name] = r;
            summary.Add(name + (r is JsonArray ra ? " " + ra.Count : ""));
        }

        // The wired clients that sit on a switch port, with the name of that switch. (Wireless clients are not kept.)
        var names = new Dictionary<string, string>();
        foreach (var dv in site["devices"] as JsonArray ?? new JsonArray()) { var m = Serial(Str(dv?["mac"])); if (m.Length > 0) names.TryAdd(m, Str(dv?["name"])); }
        var wired = new JsonArray();
        foreach (var c in si.ClientList.OfType<JsonObject>())
        {
            if (c["wired"]?.GetValue<bool>() != true || c["swPort"] is null) continue;
            if (names.TryGetValue(Serial(Str(c["swMac"])), out var sn)) c["switch"] = sn;
            wired.Add(c.DeepClone());
        }
        site["clients"] = wired;
        site["info"] = info;
        diag.Add(label + ": site details gathered (" + string.Join(", ", summary) + "; wired clients " + wired.Count + ")");
    }
}
