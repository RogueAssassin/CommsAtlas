// CommsAtlas server: hosts the web app, keeps everything in one SQLite database (workspaces, accounts, sessions, settings),
// handles sign-in (passwords, two-step codes, single sign-on) and runs connectors that pull devices from other systems' APIs
// (UniFi today) with keys kept on the server.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.HttpOverrides;

var selfTest = args.Contains("--selftest");
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => { o.Limits.MaxRequestBodySize = 64L * 1024 * 1024; o.AddServerHeader = false; });
builder.Services.AddHttpClient();
builder.Services.AddResponseCompression(o => { o.EnableForHttps = true; o.MimeTypes = o.MimeTypes.Concat(new[] { "image/svg+xml", "application/javascript", "text/javascript", "text/css", "application/json" }); });
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    // The server only listens on the loopback address behind nginx, so the proxy's headers can be trusted.
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear(); o.KnownProxies.Clear();
});
var app = builder.Build();
// The web app is inside the program file itself (embedded at build time). A wwwroot folder beside the program, when there is one
// (working from source), is served instead.
if (string.IsNullOrEmpty(app.Environment.WebRootPath) || !Directory.Exists(app.Environment.WebRootPath))
{
    try { app.Environment.WebRootFileProvider = new Microsoft.Extensions.FileProviders.ManifestEmbeddedFileProvider(typeof(Build).Assembly, "wwwroot"); }
    catch (InvalidOperationException) { app.Logger.LogWarning("This copy of the program has no web app inside it."); }
}
app.UseForwardedHeaders();
app.UseResponseCompression();

var section = app.Configuration.GetSection("CommsAtlas");
var dataPath = selfTest ? Path.Combine(Path.GetTempPath(), "commsatlas-selftest-" + Guid.NewGuid().ToString("N"))
    : Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, section["DataPath"] ?? "data"));
Directory.CreateDirectory(dataPath);
var client = Cfg.ToJson(section.GetSection("Client")) as JsonObject ?? new JsonObject();
var appName = client["name"]?.GetValue<string>() ?? "CommsAtlas";
var build = Build.Number(app.Environment.ContentRootPath);
var db = new Db(Path.Combine(dataPath, "commsatlas.db")) { Keep = Math.Clamp(section.GetValue("BackupsToKeep", 14), 1, 365) };
var store = new WorkspaceStore(db);
var tokens = new TokenService(Path.Combine(dataPath, "secret.key"));
var accounts = new Accounts(db, tokens);
var oidc = new OidcValidator(app.Services.GetRequiredService<IHttpClientFactory>());
var connectors = new ConnectorStore(dataPath, tokens.Derive("connector-keys-v1"));
var unifi = new UnifiConnector(app.Services.GetRequiredService<IHttpClientFactory>(), selfTest);
var json = new JsonSerializerOptions { WriteIndented = false };
var imported = store.ImportLegacy(dataPath);
if (imported > 0) app.Logger.LogInformation("Imported {N} workspace(s) from the older file store into the database", imported);
store.SyncTenants();
// A provider set in appsettings.json (CommsAtlas:Client:sso) seeds the sign-in providers the first time.
if (client["sso"] is JsonObject seed && accounts.Providers().Count == 0 && OidcValidator.Usable(seed))
{
    var p = (JsonObject)seed.DeepClone(); p["id"] = "sso1"; p["enabled"] = true; if (p["name"] is null) p["name"] = "single sign-on";
    accounts.SetProviders(new JsonArray(p));
}
client.Remove("sso"); // the browser learns about providers from /api/v1/auth/state, not from config.js
if (!selfTest)
{
    // A consistent copy of the database every day; the newest few (CommsAtlas:BackupsToKeep, default 14) are kept in data/backups.
    var backupTimer = new Timer(_ => { try { db.Backup(Path.Combine(dataPath, "backups")); } catch (Exception e) { app.Logger.LogWarning("Backup failed: {M}", e.Message); } }, null, TimeSpan.FromMinutes(1), TimeSpan.FromHours(24));
    app.Lifetime.ApplicationStopping.Register(() => backupTimer.Dispose());
}

// Safe defaults for every answer.
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    h["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; " +
        "connect-src 'self' https: ; worker-src 'self' blob: https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    // The start page must be re-checked every time (it names this build's scripts). "/" is served without the static-file header, so say it here;
    // otherwise a browser may keep the old page for hours and keep running an old build.
    var rawPath = ctx.Request.Path.Value ?? "/";
    if (rawPath == "/" || rawPath.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) h["Cache-Control"] = "no-cache";
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        h["Cache-Control"] = "no-store";
        // Only saving a workspace needs a large body; everything else (including all sign-in requests) is small.
        var big = HttpMethods.IsPut(ctx.Request.Method) && ctx.Request.Path.Value!.EndsWith("/workspace", StringComparison.Ordinal);
        // A floor plan picture is sent as the raw file, up to the limit set in WorkspaceStore.
        if (HttpMethods.IsPost(ctx.Request.Method) && ctx.Request.Path.Value!.EndsWith("/plans", StringComparison.Ordinal) && ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } pl) pl.MaxRequestBodySize = WorkspaceStore.MaxPlanBytes + 1024;
        else if (!big && ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } lim) lim.MaxRequestBodySize = 256 * 1024;
    }
    await next();
});
// The app's settings come from appsettings.json, so there is one place to change them.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.Equals("/config.js", StringComparison.OrdinalIgnoreCase))
    {
        ctx.Response.ContentType = "application/javascript; charset=utf-8";
        ctx.Response.Headers["Cache-Control"] = "no-cache";
        await ctx.Response.WriteAsync("window.APP_CONFIG = " + client.ToJsonString(json) + ";\n");
        return;
    }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Scripts, styles and fonts carry the build number in their address, so they can be kept; the page and settings must always be re-checked.
    OnPrepareResponse = c =>
    {
        var n = c.File.Name;
        // An address with ?b=<build number> never changes its content, so it can be kept for a year; everything else is re-checked.
        var p = c.Context.Request.Path.Value ?? "";
        c.Context.Response.Headers["Cache-Control"] = c.Context.Request.Query.ContainsKey("b") && n != "index.html" ? "public, max-age=31536000, immutable"
            : n is "index.html" or "config.js" or "version.js" ? "no-cache"
            // Pictures and the bundled libraries (pdf.js, Tesseract) almost never change: keep them a week and refresh quietly in the background after that.
            : p.StartsWith("/img/", StringComparison.Ordinal) || p.StartsWith("/vendor/", StringComparison.Ordinal) ? "public, max-age=604800, stale-while-revalidate=86400"
            : "public, max-age=3600";
    },
});

/* ---------------- who is asking: a signed-in person's session ---------------- */
Caller? Who(HttpContext ctx)
{
    var auth = ctx.Request.Headers.Authorization.ToString();
    return auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? accounts.Resolve(auth[7..].Trim()) : null;
}
static int Rank(string role) => Accounts.Rank(role);
IResult? Deny(Caller? c, int need, string? tenant = null)
{
    if (c is null) return Results.Json(new { error = "Sign in first." }, statusCode: 401);
    if (tenant is not null && !store.Exists(tenant)) return Results.Json(new { error = "Unknown tenant." }, statusCode: 404);
    if (Rank(c.Role) < need) return Results.Json(new { error = "Your level can not do that." }, statusCode: 403);
    if (tenant is not null && !Accounts.CanTenant(c, tenant)) return Results.Json(new { error = "You have not been given access to that tenant." }, statusCode: 403);
    return null;
}
async Task<JsonObject?> Body(HttpContext ctx)
{
    try { return await JsonNode.ParseAsync(ctx.Request.Body) as JsonObject; } catch (JsonException) { return null; }
}
static string Str(JsonObject? o, string k) => o?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

/* ---------------- health, sign-in ---------------- */
app.MapGet("/api/v1/health", () => Results.Json(new { app = appName, api = 3, accounts = true, build, connectors = true, time = DateTimeOffset.UtcNow }));
AuthApi.Map(app, accounts, tokens, oidc, store, db, appName, build);

/* ---------------- the app's own records (what the app saves) ---------------- */
app.MapGet("/api/v1/tenants", (HttpContext ctx) =>
{
    var c = Who(ctx); if (Deny(c, 1) is { } d) return d;
    var list = store.List().Where(t => Accounts.CanTenant(c!, t.Id)).Select(t => new { id = t.Id, name = t.Name, rev = t.Rev, savedAt = t.SavedAt, savedBy = t.SavedBy });
    return Results.Json(new { tenants = list });
});
// Super Admins add, rename and remove tenants (each is one client with its own sites, rooms, racks and device library).
app.MapPost("/api/v1/tenants", async (HttpContext ctx) =>
{
    var c = Who(ctx); if (Deny(c, 5) is { } d) return d;
    var name = Str(await Body(ctx), "name");
    var id = store.Create(name);
    if (id is null) return Results.Json(new { error = "Give the tenant a name (up to 80 characters)." }, statusCode: 400);
    accounts.Audit(c!.Name, "tenant-add", $"{WorkspaceStore.CleanName(name)} ({id})");
    return Results.Json(new { id, name = WorkspaceStore.CleanName(name), rev = 0 });
});
app.MapPatch("/api/v1/tenants/{tenant}", async (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 5, tenant) is { } d) return d;
    var name = Str(await Body(ctx), "name");
    if (!store.Rename(tenant, name)) return Results.Json(new { error = "Give the tenant a name (up to 80 characters)." }, statusCode: 400);
    accounts.Audit(c!.Name, "tenant-rename", $"{tenant} is now {WorkspaceStore.CleanName(name)}");
    return Results.Json(new { id = tenant, name = WorkspaceStore.CleanName(name) });
});
app.MapDelete("/api/v1/tenants/{tenant}", (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 5, tenant) is { } d) return d;
    if (store.Count() <= 1) return Results.Json(new { error = "There must be at least one tenant." }, statusCode: 409);
    var name = store.NameOf(tenant);
    store.Delete(tenant);
    accounts.Audit(c!.Name, "tenant-remove", $"{name} ({tenant})");
    return Results.Json(new { deleted = tenant });
});
app.MapGet("/api/v1/tenants/{tenant}/rev", (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 1, tenant) is { } d) return d;
    return Results.Json(new { rev = store.Rev(tenant) });
});
app.MapGet("/api/v1/tenants/{tenant}/workspace", (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 1, tenant) is { } d) return d;
    var w = store.Read(tenant);
    if (w is null) return Results.Json(new { rev = 0, workspace = (object?)null });
    return Results.Json(new { rev = w.Rev, savedAt = w.SavedAt, savedBy = w.SavedBy, workspace = w.Workspace });
});
app.MapPut("/api/v1/tenants/{tenant}/workspace", async (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 2, tenant) is { } d) return d;
    var body = await Body(ctx);
    if (body?["workspace"] is not JsonObject ws || ws["racks"] is not JsonArray || ws["devices"] is not JsonArray)
        return Results.Json(new { error = "Send { rev, workspace } with a whole workspace." }, statusCode: 400);
    // The saved version the sender started from is required, so a stale save is always noticed (a missing or non-numeric one is refused).
    if (body["rev"] is not JsonValue rv || !rv.TryGetValue<long>(out var baseRev))
        return Results.Json(new { error = "Send { rev, workspace } with the number of the version you started from." }, statusCode: 400);
    var result = await store.Write(tenant, ws, baseRev, c!.Name);
    if (result.Conflict) return Results.Json(new { error = "Someone else saved first.", rev = result.Rev }, statusCode: 409);
    return Results.Json(new { rev = result.Rev });
});

/* ---------------- floor plan pictures: stored per tenant, shown only to people who may open that tenant ---------------- */
app.MapPost("/api/v1/tenants/{tenant}/plans", async (HttpContext ctx, string tenant) =>
{
    var c = Who(ctx); if (Deny(c, 2, tenant) is { } d) return d;
    if (ctx.Request.ContentLength > WorkspaceStore.MaxPlanBytes) return Results.Json(new { error = "That picture is too large (the limit is 12 MB)." }, statusCode: 413);
    using var ms = new MemoryStream();
    try { await ctx.Request.Body.CopyToAsync(ms); }
    catch (Microsoft.AspNetCore.Http.BadHttpRequestException) { return Results.Json(new { error = "That picture is too large (the limit is 12 MB)." }, statusCode: 413); }
    var bytes = ms.ToArray();
    if (bytes.Length == 0 || bytes.Length > WorkspaceStore.MaxPlanBytes) return Results.Json(new { error = "Send the picture file (up to 12 MB)." }, statusCode: 413);
    var mime = WorkspaceStore.PlanMime(bytes);
    if (mime is null) return Results.Json(new { error = "Only PNG, JPEG or WebP pictures can be stored." }, statusCode: 415);
    var id = store.PutPlan(tenant, mime, bytes, c!.Name);
    if (id is null) return Results.Json(new { error = "This tenant already holds the maximum number of floor plan pictures." }, statusCode: 409);
    return Results.Json(new { id, bytes = bytes.Length, mime });
});
app.MapGet("/api/v1/tenants/{tenant}/plans/{id}", (HttpContext ctx, string tenant, string id) =>
{
    var c = Who(ctx); if (Deny(c, 1, tenant) is { } d) return d;
    var p = store.GetPlan(tenant, id);
    if (p is null) return Results.Json(new { error = "No such picture." }, statusCode: 404);
    // A stored picture never changes (a new upload gets a new id); it is private to the signed-in person.
    // Checked with the server each time (so a person who may no longer open the tenant is not served from the browser's cache), but a 304 costs nothing.
    ctx.Response.Headers["Cache-Control"] = "private, no-cache";
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    var etag = "\"" + id + "\"";
    ctx.Response.Headers["ETag"] = etag;
    if (ctx.Request.Headers.IfNoneMatch.ToString() == etag) return Results.StatusCode(304);
    return Results.Bytes(p.Value.Data, p.Value.Mime);
});

/* ---------------- connectors: this server calling other systems' APIs with their keys ----------------
   Admins add a connector with its key; the key is encrypted on disk and never sent back. Editors pull from it;
   the app then shows what was found and merges the chosen sites into the records. */
app.MapGet("/api/v1/connectors", (HttpContext ctx) =>
{
    var c = Who(ctx); if (Deny(c, 3) is { } d) return d;
    return Results.Json(new { types = UnifiConnector.Types, connectors = connectors.List().Select(ConnectorStore.Public) });
});
app.MapPut("/api/v1/connectors", async (HttpContext ctx) =>
{
    var c = Who(ctx); if (Deny(c, 4) is { } d) return d;
    var b = await Body(ctx);
    if (b is null) return Results.Json(new { error = "Send the connector's settings as JSON." }, statusCode: 400);
    try
    {
        var saved = connectors.Save(b, c!.Name, unifi.CheckSettings);
        app.Logger.LogInformation("Connector {Name} saved by {Who}", saved.Name, c.Name);
        return Results.Json(ConnectorStore.Public(saved));
    }
    catch (ConnectorException e) { return Results.Json(new { error = e.Message }, statusCode: 400); }
});
app.MapDelete("/api/v1/connectors/{id}", (HttpContext ctx, string id) =>
{
    var c = Who(ctx); if (Deny(c, 4) is { } d) return d;
    return connectors.Delete(id) ? Results.Json(new { deleted = id }) : Results.Json(new { error = "No such connector." }, statusCode: 404);
});
var pullJobs = new System.Collections.Concurrent.ConcurrentDictionary<string, PullJob>();
app.MapGet("/api/v1/connector-jobs/{job}", (HttpContext ctx, string job) =>
{
    var c = Who(ctx); if (Deny(c, 3) is { } d) return d;
    if (!pullJobs.TryGetValue(job, out var j)) return Results.Json(new { error = "No such pull (it may have finished a while ago)." }, statusCode: 404);
    var secs = Math.Round((DateTime.UtcNow - j.Started).TotalSeconds, 1);
    if (!j.Done) return Results.Json(new { state = "running", stage = j.Stage, secs });
    if (j.Error is not null) return Results.Json(new { state = "failed", error = j.Error, secs });
    return Results.Json(new JsonObject { ["state"] = "done", ["secs"] = secs, ["result"] = j.Result });
});
app.MapPost("/api/v1/connectors/{id}/{action}", async (HttpContext ctx, string id, string action) =>
{
    var c = Who(ctx);
    if (action is not ("test" or "pull" or "pull-start")) return Results.Json(new { error = "Use test, pull or pull-start." }, statusCode: 404);
    if (Deny(c, action == "test" ? 4 : 3) is { } d) return d;
    var con = connectors.Get(id);
    if (con is null) return Results.Json(new { error = "No such connector." }, statusCode: 404);
    if (action == "pull-start")
    {
        // A full pull of a big site takes longer than the web server waits for one answer, so it runs in the background and the page asks how it is going.
        foreach (var old in pullJobs.Where(j => j.Value.Done && DateTime.UtcNow - j.Value.Started > TimeSpan.FromMinutes(20)).Select(j => j.Key).ToList()) pullJobs.TryRemove(old, out _);
        var job = new PullJob(); var jid = Guid.NewGuid().ToString("N");
        pullJobs[jid] = job;
        var key = connectors.KeyOf(con);
        _ = Task.Run(async () =>
        {
            UnifiConnector.Say.Value = s => job.Stage = s;
            try
            {
                job.Result = await unifi.Pull(con, key, false, app.Lifetime.ApplicationStopping);
                connectors.Note(id, "Pulled " + job.Result["deviceCount"] + " devices", true);
            }
            catch (ConnectorException e) { job.Error = e.Message; connectors.Note(id, e.Message, false); }
            catch (Exception e) when (e is not OperationCanceledException) { job.Error = "The pull stopped unexpectedly."; app.Logger.LogError(e, "Connector pull failed"); }
            finally { job.Done = true; }
        });
        return Results.Json(new { job = jid });
    }
    try
    {
        var got = await unifi.Pull(con, connectors.KeyOf(con), action == "test", ctx.RequestAborted);
        connectors.Note(id, action == "test" ? "Test passed" : "Pulled " + got["deviceCount"] + " devices", true);
        return Results.Json(got);
    }
    catch (ConnectorException e)
    {
        connectors.Note(id, e.Message, false);
        return Results.Json(new { error = e.Message }, statusCode: 502);
    }
});

if (selfTest) SelfTest.MapFakeUnifi(app);
app.MapFallback("/api/{**rest}", () => Results.Json(new { error = "No such API address." }, statusCode: 404));
app.MapFallbackToFile("index.html");
if (selfTest) return await SelfTest.Run(app, accounts, dataPath);
app.Logger.LogInformation("{App} is storing its records in {Path}", appName, dataPath);
app.Run();
return 0;

/* ======================================================================= */

static class Cfg
{
    /** appsettings.json section → JSON for the browser (numbers and true/false come back as such). */
    public static JsonNode? ToJson(IConfigurationSection s)
    {
        var kids = s.GetChildren().ToList();
        if (kids.Count == 0)
        {
            var v = s.Value;
            if (v is null || v.Length == 0) return null;
            if (v == "true" || v == "false") return JsonValue.Create(v == "true");
            if (Regex.IsMatch(v, @"^-?\d+(\.\d+)?$") && double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d)) return JsonValue.Create(d);
            return JsonValue.Create(v);
        }
        if (kids.All(k => int.TryParse(k.Key, out _)))
        {
            var arr = new JsonArray();
            foreach (var k in kids.OrderBy(k => int.Parse(k.Key))) arr.Add(ToJson(k));
            return arr;
        }
        var obj = new JsonObject();
        foreach (var k in kids) obj[k.Key] = ToJson(k);
        return obj;
    }
    public static bool SameSecret(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(a)), SHA256.HashData(Encoding.UTF8.GetBytes(b)));
    public static byte[] B64u(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
    public static string ToB64u(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/* ---------------- connectors ---------------- */
/** A connector pull running in the background. */
class PullJob
{
    public DateTime Started = DateTime.UtcNow;
    public volatile bool Done;
    public volatile string Stage = "Starting";
    public JsonObject? Result;
    public string? Error;
}

record Connector(string Id, string Name, string Type, string Url, string Site, bool AllowSelfSigned, string KeyEnc, string KeyHint,
    string UpdatedBy, DateTimeOffset UpdatedAt, string LastResult, bool LastOk, DateTimeOffset? LastAt);

class ConnectorException(string m) : Exception(m);

/** Connectors in data/connectors.json. Each API key is encrypted (AES-GCM, a key derived from data/secret.key) and never sent back. */
class ConnectorStore(string root, byte[] key)
{
    readonly object gate = new();
    string FilePath => Path.Combine(root, "connectors.json");
    List<Connector> Load() => File.Exists(FilePath) ? JsonSerializer.Deserialize<List<Connector>>(File.ReadAllText(FilePath)) ?? new List<Connector>() : new List<Connector>();
    void Store(List<Connector> list)
    {
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(list));
        File.Move(tmp, FilePath, true);
    }
    public List<Connector> List() { lock (gate) return Load(); }
    public Connector? Get(string id) => List().FirstOrDefault(x => x.Id == id);
    public static object Public(Connector c) => new
    {
        id = c.Id, name = c.Name, type = c.Type, url = c.Url, site = c.Site, allowSelfSigned = c.AllowSelfSigned, keyHint = c.KeyHint,
        updatedBy = c.UpdatedBy, updatedAt = c.UpdatedAt, lastResult = c.LastResult, lastOk = c.LastOk, lastAt = c.LastAt,
    };

    public Connector Save(JsonObject b, string by, Action<string, string> check)
    {
        string S(string k) => b[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s.Trim() : "";
        var id = S("id"); var name = S("name"); var type = S("type"); var url = S("url").TrimEnd('/'); var site = S("site"); var apiKey = S("apiKey");
        var selfSigned = b["allowSelfSigned"] is JsonValue sv && sv.TryGetValue<bool>(out var flag) && flag;
        if (name.Length is 0 or > 80) throw new ConnectorException("Give the connector a name (up to 80 characters).");
        if (site.Length > 120) throw new ConnectorException("The site filter is too long.");
        if (apiKey.Length > 1024 || apiKey.Any(char.IsControl)) throw new ConnectorException("That doesn't look like an API key.");
        check(type, url);
        if (type == "unifi-cloud") url = "";
        lock (gate)
        {
            var list = Load();
            var old = id.Length > 0 ? list.FirstOrDefault(x => x.Id == id) : null;
            if (id.Length > 0 && old is null) throw new ConnectorException("No such connector.");
            if (old is null && apiKey.Length < 8) throw new ConnectorException("Paste the API key.");
            var c = new Connector(old?.Id ?? "con_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant(), name, type, url, site, selfSigned,
                apiKey.Length > 0 ? Encrypt(apiKey) : old!.KeyEnc, apiKey.Length > 0 ? "…" + apiKey[^4..] : old!.KeyHint,
                by, DateTimeOffset.UtcNow, old?.LastResult ?? "", old?.LastOk ?? false, old?.LastAt);
            list.RemoveAll(x => x.Id == c.Id);
            list.Add(c);
            Store(list);
            return c;
        }
    }
    public bool Delete(string id)
    {
        lock (gate) { var l = Load(); var n = l.RemoveAll(x => x.Id == id); if (n > 0) Store(l); return n > 0; }
    }
    public void Note(string id, string result, bool ok)
    {
        lock (gate)
        {
            var l = Load(); var i = l.FindIndex(x => x.Id == id); if (i < 0) return;
            l[i] = l[i] with { LastResult = result.Length > 300 ? result[..300] : result, LastOk = ok, LastAt = DateTimeOffset.UtcNow };
            Store(l);
        }
    }
    public string KeyOf(Connector c)
    {
        try
        {
            var all = Convert.FromBase64String(c.KeyEnc);
            var pt = new byte[all.Length - 28];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(all.AsSpan(0, 12), all.AsSpan(28), all.AsSpan(12, 16), pt);
            return Encoding.UTF8.GetString(pt);
        }
        catch (Exception e) when (e is CryptographicException or FormatException or ArgumentException)
        {
            throw new ConnectorException("The stored key can't be read (was data/secret.key replaced?). Edit the connector and paste its key again.");
        }
    }
    string Encrypt(string s)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var pt = Encoding.UTF8.GetBytes(s);
        var ct = new byte[pt.Length]; var tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, pt, ct, tag);
        return Convert.ToBase64String(nonce.Concat(tag).Concat(ct).ToArray());
    }
}

/** UniFi: Site Manager in the cloud (api.ui.com) or a UniFi Network console on site (its Integration API), both with an X-API-KEY. */
partial class UnifiConnector(IHttpClientFactory http, bool allowHttp)
{
    public static readonly object[] Types =
    {
        new { id = "unifi-cloud", name = "UniFi Site Manager (cloud)", needsUrl = false, help = "Every console on your UniFi account. Make the key at unifi.ui.com › API (Site Manager API). Gives each device's name, model, MAC, IP and firmware." },
        new { id = "unifi-local", name = "UniFi Network console (on site)", needsUrl = true, help = "One console on your network, for example https://192.168.1.1. Make the key in UniFi Network › Settings › Control Plane › Integrations. Also gives each switch's ports and what it uplinks to. The server must be able to reach the console." },
    };
    const string Cloud = "https://api.ui.com";

    public void CheckSettings(string type, string url)
    {
        if (type == "unifi-cloud") return;
        if (type != "unifi-local") throw new ConnectorException("Pick a connector type.");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "https" && !(allowHttp && u.Scheme == "http")) || u.Host.Length == 0 || u.UserInfo.Length > 0)
            throw new ConnectorException("Give the console's https address, for example https://192.168.1.1");
    }

    HttpClient Client(Connector c)
    {
        var hc = c.Type == "unifi-local" && c.AllowSelfSigned
            ? new HttpClient(new HttpClientHandler { ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator })
            : http.CreateClient();
        hc.Timeout = TimeSpan.FromSeconds(30);
        return hc;
    }

    static string Str(JsonNode? n) => n is null ? "" : n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToString();
    static bool Has(JsonNode? n, string name) => n switch
    {
        JsonArray a => a.Any(x => string.Equals(Str(x), name, StringComparison.OrdinalIgnoreCase)),
        JsonObject o => o.ContainsKey(name),
        _ => false,
    };
    public static string Kind(string model, JsonNode? features)
    {
        const RegexOptions I = RegexOptions.IgnoreCase;
        if (Regex.IsMatch(model, @"\b(udm|uxg|ucg|efg|udr|usg|gateway)\b|dream\s*(machine|router)|^ux\b", I)) return "gateway";
        if (Has(features, "switching") || Regex.IsMatch(model, @"\b(usw|usl|us-?\d+|switch|ecs)\b", I)) return "switch";
        if (Has(features, "accessPoint") || Regex.IsMatch(model, @"\b(uap|u6|u7|nanohd|access point)\b", I)) return "ap";
        return "other";
    }
    static string Serial(string mac) => Regex.Replace(mac, "[^0-9A-Fa-f]", "").ToUpperInvariant();

    static string Snip(string text) { text = Regex.Replace(text ?? "", @"\s+", " ").Trim(); return text.Length > 160 ? text[..160] + "..." : text; }

    // At most this many requests to UniFi are in flight at once across the whole server: Site Manager's connector tunnel to a console times
    // out (HTTP 408) when it is asked for too much at the same time.
    static readonly SemaphoreSlim Wire = new(3);

    /** One GET with the key. A timeout, rate limit or gateway error (408, 429, 5xx) is tried again up to three times, waiting as the answer asks. */
    static async Task<JsonNode> Get(HttpClient hc, string url, string key, CancellationToken ct)
    {
        var where = new Uri(url);
        for (var attempt = 1; ; attempt++)
        {
            HttpResponseMessage res;
            await Wire.WaitAsync(ct);
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("X-API-KEY", key);
                req.Headers.Accept.ParseAdd("application/json");
                try { res = await hc.SendAsync(req, ct); }
                catch (HttpRequestException e)
                {
                    if (attempt < 3) { await Task.Delay(700 * attempt, ct); continue; }
                    throw new ConnectorException("Could not reach " + where.Host + ": " + (e.InnerException?.Message ?? e.Message));
                }
                catch (TaskCanceledException) when (!ct.IsCancellationRequested)
                {
                    if (attempt < 3) continue;
                    throw new ConnectorException("No answer from " + where.Host + " within 30 seconds.");
                }
                using (res)
                {
                    var text = await res.Content.ReadAsStringAsync(ct);
                    var code = (int)res.StatusCode;
                    if (code is 408 or 429 or 500 or 502 or 503 or 504)
                    {
                        if (attempt < 3)
                        {
                            var wait = res.Headers.RetryAfter?.Delta is { } d ? Math.Min(d.TotalMilliseconds, 5000) : 800 * attempt;
                            await Task.Delay((int)wait, ct);
                            continue;
                        }
                    }
                    if (code is 401 or 403) throw new ConnectorException("The API key was refused (HTTP " + code + ")" + (text.Length > 0 ? ": " + Snip(text) : "") + ".");
                    if (!res.IsSuccessStatusCode) throw new ConnectorException(where.AbsolutePath + " answered HTTP " + code + (text.Length > 0 ? ": " + Snip(text) : "") + ".");
                    try { return JsonNode.Parse(text) ?? throw new JsonException(); }
                    catch (JsonException) { throw new ConnectorException(where.AbsolutePath + " didn't answer with JSON. Is the address right?"); }
                }
            }
            finally { Wire.Release(); }
        }
    }

    /** Every item of a { data: [...] } list: UniFi Network pages with offset/limit/totalCount, Site Manager with nextToken. */
    static async Task<List<JsonNode>> Paged(HttpClient hc, string url, string key, CancellationToken ct)
    {
        var all = new List<JsonNode>();
        // Site Manager's own lists (hosts, sites, devices) page with nextToken; a console's Network API, even reached through the cloud, pages with offset.
        var cloud = url.StartsWith(Cloud, StringComparison.OrdinalIgnoreCase) && !url.Contains("/connector/", StringComparison.OrdinalIgnoreCase);
        var offset = 0; string? next = null;
        for (var guard = 0; guard < 50; guard++)
        {
            var u = cloud ? url + (next is null ? "" : "?nextToken=" + Uri.EscapeDataString(next)) : url + "?offset=" + offset + "&limit=200";
            var j = await Get(hc, u, key, ct);
            var data = j["data"] as JsonArray ?? throw new ConnectorException(new Uri(url).AbsolutePath + " gave no data list (it answered: " + Snip(j.ToJsonString()) + ").");
            foreach (var x in data) if (x is not null) all.Add(x);
            if (cloud) { next = Str(j["nextToken"]); if (next.Length == 0) break; }
            else
            {
                offset += data.Count;
                var total = j["totalCount"] is JsonValue tv && tv.TryGetValue<int>(out var t) ? t : offset;
                if (data.Count == 0 || offset >= total) break;
            }
        }
        return all;
    }

    /** Like Paged, but a failure is noted in the diagnostics and gives an empty list. */
    static async Task<List<JsonNode>> TryPaged(HttpClient hc, string url, string key, JsonArray diag, string what, CancellationToken ct)
    {
        try { var l = await Paged(hc, url, key, ct); diag.Add(what + ": " + l.Count + " found"); return l; }
        catch (ConnectorException e) { diag.Add(what + ": " + e.Message); return new List<JsonNode>(); }
    }

    static JsonObject Device(string name, string model, string mac, string ip, string state, string kind) => new()
    {
        ["name"] = name.Length > 0 ? name : model, ["model"] = model, ["mac"] = mac, ["serial"] = Serial(mac), ["ip"] = ip, ["state"] = state,
        ["kind"] = kind, ["firmware"] = "", ["uplink"] = "", ["ports"] = new JsonArray(),
    };

    static string FirstStr(JsonNode? o, params string[] names) { foreach (var n in names) { var s = Str(o?[n]); if (s.Length > 0) return s; } return ""; }
    static bool? FirstBool(JsonNode? o, params string[] names) { foreach (var n in names) if (o?[n] is JsonValue v && v.TryGetValue<bool>(out var b)) return b; return null; }
    static int? FirstInt(JsonNode? o, params string[] names)
    {
        foreach (var n in names)
            if (o?[n] is JsonValue v) { if (v.TryGetValue<int>(out var i)) return i; if (v.TryGetValue<string>(out var s) && int.TryParse(s, out var k)) return k; }
        return null;
    }

    /** What a site's console tells us about its networks, port profiles and connected clients (all optional: each is read if the key may). */
    class SiteInfo
    {
        public Dictionary<string, (int vid, string name)> Nets = new();
        public Dictionary<string, Prof> Profiles = new();
        public string DefaultNet = "";
        public Dictionary<string, List<string>> Clients = new();     // "mac|port" -> who is plugged into that port
        public JsonArray ClientList = new();                         // every active client: name, mac, ip, wired or wireless, the switch port or access point, VLAN
    }
    record Prof(string Name, string Forward, string Native, string TaggedMgmt, HashSet<string> Excluded);

    /** 192.168.10.1/24 -> subnet 192.168.10.0/24 and gateway 192.168.10.1. */
    static (string subnet, string gateway) SubnetOf(string ipSubnet)
    {
        var m = Regex.Match(ipSubnet ?? "", @"^(\d+)\.(\d+)\.(\d+)\.(\d+)/(\d+)$");
        if (!m.Success) return ("", "");
        var o = Enumerable.Range(1, 4).Select(i => int.Parse(m.Groups[i].Value)).ToArray(); var len = int.Parse(m.Groups[5].Value);
        if (o.Any(x => x > 255) || len is < 8 or > 30) return ("", "");
        var ip = ((uint)o[0] << 24) | ((uint)o[1] << 16) | ((uint)o[2] << 8) | (uint)o[3];
        var mask = uint.MaxValue << (32 - len); var net = ip & mask;
        string Dot(uint v) => $"{v >> 24}.{(v >> 16) & 255}.{(v >> 8) & 255}.{v & 255}";
        return (Dot(net) + "/" + len, Dot(ip));
    }

    /**
     * One port as the app wants it, from whatever the console gives. The Integration API's port has an index, link state, connector and
     * speed; the older (legacy) device record adds the port's name, whether it is enabled, its port profile and so which network (VLAN)
     * it is on and which others it carries. Every key a console may use is tried, and what is found is passed on: n, up, connector,
     * speedMbps, name, disabled, vlan, vlanName, tagged, profile, poe. Nothing is dropped because a port is not patched or not linked.
     */
    static JsonObject PortOf(JsonNode p, int idx, SiteInfo info)
    {
        var cfg = p["portConfiguration"] ?? p["configuration"] ?? p["settings"];
        var state = FirstStr(p, "state", "linkState");
        var adm = FirstStr(p, "adminState", "adminStatus", "operationalState");
        var en = FirstBool(p, "enabled", "enable", "isEnabled", "adminEnabled") ?? FirstBool(cfg, "enabled", "enable", "isEnabled");
        var dis = FirstBool(p, "disabled", "isDisabled") ?? FirstBool(cfg, "disabled", "isDisabled");
        // The port profile decides most of this on a UniFi switch: "Disabled" is a profile, and a profile has the native network and which others are carried.
        info.Profiles.TryGetValue(FirstStr(p, "portconf_id", "portProfileId"), out var prof);
        var disabled = en == false || dis == true || Regex.IsMatch(state + " " + adm, @"\b(disabled|admin[_ ]?down|admin[_ ]?off|off)\b", RegexOptions.IgnoreCase)
            || FirstStr(p, "forward").Equals("disabled", StringComparison.OrdinalIgnoreCase)
            || (prof is not null && (prof.Forward.Equals("disabled", StringComparison.OrdinalIgnoreCase) || Regex.IsMatch(prof.Name, @"^\s*disabled\s*$", RegexOptions.IgnoreCase)));
        var wan = Regex.IsMatch(FirstStr(p, "network_name", "networkName"), @"^\s*wan", RegexOptions.IgnoreCase) || FirstStr(p, "wan_networkgroup").Length > 0;
        int? vid = FirstInt(p, "nativeVlanId", "nativeVlan", "vlanId", "vlan", "pvid") ?? FirstInt(cfg, "nativeVlanId", "nativeVlan", "vlanId", "vlan");
        var netId = FirstStr(p, "nativeNetworkId", "networkId", "native_networkconf_id");
        if (netId.Length == 0) netId = FirstStr(cfg, "nativeNetworkId", "networkId", "native_networkconf_id");
        if (netId.Length == 0 && prof is not null && prof.Native.Length > 0) netId = prof.Native;
        // A port that is not on a named network is on the default one (untagged VLAN 1), unless it is a WAN port or turned off.
        if (netId.Length == 0 && vid is null && !wan && !disabled && info.DefaultNet.Length > 0 && (info.Profiles.Count > 0 || p["forward"] is not null)) netId = info.DefaultNet;
        var vname = "";
        if (netId.Length > 0 && info.Nets.TryGetValue(netId, out var nv)) { vid ??= nv.vid; vname = nv.name; }
        var tagged = "";
        if (!disabled && !wan)
        {
            // The profile's rules if there is one; otherwise the port's own (the legacy port table carries forward, tagged_vlan_mgmt and the excluded networks).
            var fwd = prof?.Forward ?? FirstStr(p, "forward").ToLowerInvariant();
            var mgmt = prof?.TaggedMgmt ?? FirstStr(p, "tagged_vlan_mgmt").ToLowerInvariant();
            var excl = prof?.Excluded ?? new HashSet<string>((p["excluded_networkconf_ids"] as JsonArray ?? new JsonArray()).Select(x => Str(x)));
            if (mgmt == "block_all" || fwd == "native") tagged = "";
            else if (mgmt == "auto" || (mgmt.Length == 0 && fwd == "all")) tagged = "All";
            else if (mgmt == "custom" || fwd == "customize" || excl.Count > 0)
                tagged = string.Join(", ", info.Nets.Where(kv => kv.Key != netId && !excl.Contains(kv.Key)).Select(kv => kv.Value.vid).Distinct().OrderBy(x => x));
        }
        var poe = p["poe"];
        var poeOn = FirstBool(poe, "enabled", "enable") ?? FirstBool(p, "poe_enable", "poeEnabled");
        var up = state.Equals("UP", StringComparison.OrdinalIgnoreCase) || (FirstBool(p, "up") ?? false);
        var o = new JsonObject
        {
            ["n"] = idx, ["up"] = up, ["connector"] = FirstStr(p, "connector", "media"), ["speedMbps"] = (p["speedMbps"] ?? p["speed"])?.DeepClone(),
            ["name"] = FirstStr(p, "name", "label"), ["disabled"] = disabled, ["poe"] = poeOn is null ? "" : poeOn.Value ? "PoE on" : "PoE off",
            ["profile"] = prof?.Name ?? "", ["tagged"] = tagged, ["wan"] = wan, ["isUplink"] = FirstBool(p, "is_uplink", "isUplink") ?? false,
        };
        if (vid is not null) { o["vlan"] = vid; o["vlanName"] = vname; }
        return o;
    }

    /** The legacy device record (port_table): each port's name, enabled flag, profile and network, plus what is plugged in (LLDP neighbour or connected clients). Best effort: an API key may not be allowed to read it. */
    static async Task LegacyPorts(HttpClient hc, string legacy, string siteRef, string mac, string key, JsonArray ports, SiteInfo info, JsonArray diag, string label, Dictionary<string, JsonNode> recs, CancellationToken ct)
    {
        try
        {
            var j = await Get(hc, legacy + Uri.EscapeDataString(siteRef) + "/stat/device/" + Uri.EscapeDataString(mac.ToLowerInvariant()), key, ct);
            var rec = (j["data"] as JsonArray)?.FirstOrDefault();
            if (rec is not null) lock (recs) recs[mac.ToLowerInvariant()] = rec;
            var table = rec?["port_table"] as JsonArray;
            if (table is null || table.Count == 0) { diag.Add(label + ": the legacy device record had no port table"); return; }
            var added = 0; var withVlan = 0; var off = 0;
            foreach (var t in table)
            {
                var idx = FirstInt(t, "port_idx", "idx"); if (idx is null || idx < 1) continue;
                var lp = PortOf(t!, idx.Value, info);
                var who = new List<string>();
                if (info.Clients.TryGetValue(mac.ToLowerInvariant() + "|" + idx.Value, out var cl)) who.AddRange(cl);
                var lldp = t!["lldp_table"] as JsonArray;
                if (who.Count == 0 && lldp is not null) foreach (var l in lldp) { var nm = FirstStr(l, "lldp_system_name", "chassis_name", "lldp_chassis_id"); if (nm.Length > 0) who.Add(nm); }
                var mine = ports.OfType<JsonObject>().FirstOrDefault(x => (int)x["n"]! == idx.Value);
                if (mine is null) { mine = lp; ports.Add(lp); added++; }
                else
                {
                    if (Str(mine["name"]).Length == 0) mine["name"] = lp["name"]?.DeepClone();
                    if (lp["disabled"]?.GetValue<bool>() == true) mine["disabled"] = true;
                    // The legacy record knows the port's profile, so its network wins over a guess made without it.
                    if (lp["vlan"] is not null) { mine["vlan"] = lp["vlan"]!.DeepClone(); mine["vlanName"] = lp["vlanName"]?.DeepClone(); }
                    else if (lp["disabled"]?.GetValue<bool>() == true || lp["wan"]?.GetValue<bool>() == true) { mine.Remove("vlan"); mine.Remove("vlanName"); }
                    if (Str(mine["poe"]).Length == 0) mine["poe"] = lp["poe"]?.DeepClone();
                    foreach (var k in new[] { "profile", "tagged", "wan", "isUplink" }) mine[k] = lp[k]?.DeepClone();
                }
                mine["connected"] = new JsonArray(who.Take(4).Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
                mine["connectedCount"] = who.Count;
                if (mine["vlan"] is not null) withVlan++;
                if (mine["disabled"]?.GetValue<bool>() == true) off++;
            }
            diag.Add(label + ": legacy port table read, " + table.Count + " ports, " + withVlan + " with a VLAN, " + off + " disabled" + (added > 0 ? " (" + added + " added)" : "") +
                (table[0] is JsonObject t0 ? "; a port has: " + string.Join(", ", t0.Select(kv => kv.Key).Where(k => Regex.IsMatch(k, "net|conf|enable|vlan|forward|name|poe|lldp", RegexOptions.IgnoreCase))) : ""));
        }
        catch (ConnectorException e) { diag.Add(label + ": legacy port table not available (" + e.Message + ")"); }
    }

    /**
     * Which port of which UniFi device is cabled to which port of another. Every device's legacy record has an `uplink` (the device above it,
     * and the port on each side); a port that is flagged as the uplink fills in the local side when it is not given. Each end gets `peer`
     * ({ name, port }), and the device gets `uplinkPort` (the port on the device above), so the import can draw the cable.
     */
    static void LinkUplinks(JsonArray devs, Dictionary<string, JsonNode> recs, JsonArray diag, string label)
    {
        var all = devs.OfType<JsonObject>().ToList();
        var byMac = new Dictionary<string, JsonObject>();
        foreach (var d in all) { var m = Str(d["mac"]).ToLowerInvariant(); if (m.Length > 0) byMac.TryAdd(m, d); }
        JsonObject? PortN(JsonObject d, int? n) => n is null ? null : (d["ports"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(p => (int?)p["n"] == n);
        var linked = 0; var shown = 0;
        foreach (var d in all)
        {
            var mac = Str(d["mac"]).ToLowerInvariant();
            if (!recs.TryGetValue(mac, out var rec)) continue;
            var upl = rec["uplink"] ?? rec["last_uplink"];
            if (upl is not JsonObject uo) continue;
            if (shown++ < 4) diag.Add(label + ": " + Str(d["name"]) + " uplink record has: " + string.Join(", ", uo.Where(kv => kv.Value is JsonValue).Select(kv => kv.Key + "=" + Str(kv.Value))));
            var rmac = FirstStr(uo, "uplink_mac", "mac").ToLowerInvariant();
            if (!byMac.TryGetValue(rmac, out var rd) || ReferenceEquals(rd, d)) continue;
            var rport = FirstInt(uo, "uplink_remote_port", "remote_port", "uplink_port_idx");
            var lport = FirstInt(uo, "port_idx", "local_port", "uplink_local_port");
            if (lport is null) lport = (d["ports"] as JsonArray)?.OfType<JsonObject>().Where(p => p["isUplink"]?.GetValue<bool>() == true).Select(p => (int?)p["n"]).FirstOrDefault();
            if (rport is not null) d["uplinkPort"] = rport;
            if (PortN(d, lport) is { } lp && lp["peer"] is null) { lp["peer"] = new JsonObject { ["name"] = Str(rd["name"]), ["kind"] = Str(rd["kind"]), ["port"] = rport is null ? null : (JsonNode)rport.Value }; linked++; }
            if (PortN(rd, rport) is { } rp && rp["peer"] is null) { rp["peer"] = new JsonObject { ["name"] = Str(d["name"]), ["kind"] = Str(d["kind"]), ["port"] = lport is null ? null : (JsonNode)lport.Value }; linked++; }
        }
        diag.Add(label + ": " + linked + " port end(s) matched to the UniFi device on the other side");
    }

    /** The sites of one console through its Network Integration API (directly, or through Site Manager's connector), with each switch's and gateway's ports. */
    async Task<List<JsonObject>> PullNetwork(HttpClient hc, string api, string legacy, string protect, Func<string, JsonNode?>? smDevice, string console, string key, bool testOnly, Func<string, bool> wanted, JsonArray diag, CancellationToken ct)
    {
        var result = new List<JsonObject>();
        var sites = await Paged(hc, api + "/sites", key, ct);
        diag.Add(console + ": " + sites.Count + " site(s)");
        foreach (var s in sites)
        {
            var sid = Uri.EscapeDataString(Str(s["id"])); var name = Str(s["name"]);
            var iref = Str(s["internalReference"]); if (iref.Length == 0) iref = "default";
            if (!wanted(name)) continue;
            Progress("Reading " + console + " / " + name + ": devices, networks and ports");
            var list = await Paged(hc, api + "/sites/" + sid + "/devices", key, ct);
            diag.Add(console + " / " + name + ": " + list.Count + " device(s)");
            var info = new SiteInfo(); var netList = new JsonArray();
            if (!testOnly)
            {
                // The site's networks give each VLAN its number, name and (from the legacy list) subnet, gateway and DHCP range.
                foreach (var nw in await TryPaged(hc, api + "/sites/" + sid + "/networks", key, diag, console + " / " + name + " networks", ct))
                {
                    var vid = FirstInt(nw, "vlanId", "vlan"); var nm = Str(nw["name"]); var id = Str(nw["id"]);
                    if (vid is null) continue;
                    if (id.Length > 0) info.Nets[id] = (vid.Value, nm);
                    netList.Add(new JsonObject { ["vid"] = vid, ["name"] = nm, ["subnet"] = "", ["gateway"] = "", ["dhcp"] = "" });
                }
                try
                {
                    var lj = await Get(hc, legacy + Uri.EscapeDataString(iref) + "/rest/networkconf", key, ct);
                    var seen = 0;
                    foreach (var nw in lj["data"] as JsonArray ?? new JsonArray())
                    {
                        var purpose = Str(nw?["purpose"]);
                        if (Regex.IsMatch(purpose, "^(wan|remote-user-vpn|site-vpn)$", RegexOptions.IgnoreCase)) continue;
                        var vid = FirstInt(nw, "vlan");
                        var vlanOn = FirstBool(nw, "vlan_enabled");
                        if (vid is null && vlanOn != true) vid = 1;                         // the default network has no VLAN tag: it is VLAN 1
                        var id = Str(nw?["_id"]); var nm = Str(nw?["name"]);
                        if (vid is null || id.Length == 0) continue;
                        info.Nets[id] = (vid.Value, nm);
                        if (info.DefaultNet.Length == 0 && vlanOn != true && purpose.Equals("corporate", StringComparison.OrdinalIgnoreCase)) info.DefaultNet = id;
                        var (subnet, gw) = SubnetOf(Str(nw?["ip_subnet"]));
                        var dhcp = FirstBool(nw, "dhcpd_enabled") == true && Str(nw?["dhcpd_start"]).Length > 0 ? Str(nw?["dhcpd_start"]) + " - " + Str(nw?["dhcpd_stop"]) : "";
                        var row = netList.OfType<JsonObject>().FirstOrDefault(x => (int)x["vid"]! == vid.Value);
                        if (row is null) { row = new JsonObject { ["vid"] = vid, ["name"] = nm, ["subnet"] = "", ["gateway"] = "", ["dhcp"] = "" }; netList.Add(row); }
                        if (subnet.Length > 0) { row["subnet"] = subnet; row["gateway"] = gw; }
                        if (dhcp.Length > 0) row["dhcp"] = dhcp;
                        seen++;
                    }
                    diag.Add(console + " / " + name + ": legacy network list read, " + seen + " networks");
                }
                catch (ConnectorException e) { diag.Add(console + " / " + name + ": legacy network list not available (" + e.Message + ")"); }
                // Port profiles: which network a port is on, which others it carries, and which profile is "Disabled".
                try
                {
                    var pj = await Get(hc, legacy + Uri.EscapeDataString(iref) + "/rest/portconf", key, ct);
                    foreach (var pc in pj["data"] as JsonArray ?? new JsonArray())
                    {
                        var id = Str(pc?["_id"]); if (id.Length == 0) continue;
                        var ex = new HashSet<string>((pc?["excluded_networkconf_ids"] as JsonArray ?? new JsonArray()).Select(x => Str(x)));
                        info.Profiles[id] = new Prof(Str(pc?["name"]), Str(pc?["forward"]).ToLowerInvariant(), Str(pc?["native_networkconf_id"]), Str(pc?["tagged_vlan_mgmt"]).ToLowerInvariant(), ex);
                    }
                    diag.Add(console + " / " + name + ": " + info.Profiles.Count + " port profiles read");
                }
                catch (ConnectorException e) { diag.Add(console + " / " + name + ": port profiles not available (" + e.Message + ")"); }
                // What is plugged into each switch port (the active clients, by the switch and port they are on).
                try
                {
                    var cj = await Get(hc, legacy + Uri.EscapeDataString(iref) + "/stat/sta", key, ct);
                    var n = 0;
                    foreach (var cl in cj["data"] as JsonArray ?? new JsonArray())
                    {
                        if (info.ClientList.Count < 1500)
                        {
                            var cvid = FirstInt(cl, "vlan");
                            if (cvid is null && Str(cl?["network_id"]).Length > 0 && info.Nets.TryGetValue(Str(cl?["network_id"]), out var cn)) cvid = cn.vid;
                            info.ClientList.Add(new JsonObject
                            {
                                ["name"] = FirstStr(cl, "name", "hostname"), ["mac"] = Str(cl?["mac"]).ToLowerInvariant(), ["ip"] = FirstStr(cl, "ip", "last_ip"), ["wired"] = FirstBool(cl, "is_wired") ?? false,
                                ["swMac"] = Str(cl?["sw_mac"]).ToLowerInvariant(), ["swPort"] = FirstInt(cl, "sw_port"), ["apMac"] = Str(cl?["ap_mac"]).ToLowerInvariant(), ["essid"] = Str(cl?["essid"]),
                                ["vlan"] = cvid, ["network"] = FirstStr(cl, "network", "network_name"), ["oui"] = Str(cl?["oui"]), ["guest"] = FirstBool(cl, "is_guest") ?? false,
                            });
                        }
                        var swMac = Str(cl?["sw_mac"]).ToLowerInvariant(); var swPort = FirstInt(cl, "sw_port");
                        if (swMac.Length == 0 || swPort is null) continue;
                        var who = FirstStr(cl, "name", "hostname"); if (who.Length == 0) who = Str(cl?["mac"]);
                        var ip = Str(cl?["ip"]);
                        var k = swMac + "|" + swPort;
                        if (!info.Clients.TryGetValue(k, out var l)) info.Clients[k] = l = new List<string>();
                        l.Add(ip.Length > 0 ? who + " (" + ip + ")" : who); n++;
                    }
                    diag.Add(console + " / " + name + ": " + n + " wired clients matched to ports");
                }
                catch (ConnectorException e) { diag.Add(console + " / " + name + ": client list not available (" + e.Message + ")"); }
            }
            var names = list.ToDictionary(d => Str(d["id"]), d => Str(d["name"]));
            var devs = new JsonArray();
            var recs = new Dictionary<string, JsonNode>();
            // Each device's own requests (detail, latest statistics, legacy record) run side by side, a few at a time, so a big site stays well inside the web server's timeout.
            using var gate = new SemaphoreSlim(6);
            var built = await Task.WhenAll(list.Select((d, i) => Task.Run(async () =>
            {
                var ld = new JsonArray();
                await gate.WaitAsync(ct);
                try
                {
                    var model = Str(d["model"]);
                    var o = Device(Str(d["name"]), model, Str(d["macAddress"]), Str(d["ipAddress"]), Str(d["state"]), Kind(model, d["features"]));
                    var kind = (string)o["kind"]!;
                    o["id"] = Str(d["id"]);
                    if (testOnly) return (o, ld);
                    var devLabel = console + " / " + o["name"];
                    JsonNode? det = null;
                    try { det = await Get(hc, api + "/sites/" + sid + "/devices/" + Uri.EscapeDataString(Str(d["id"])), key, ct); }
                    catch (ConnectorException e) when (!e.Message.StartsWith("The API key was refused")) { ld.Add(devLabel + ": device detail not available (" + e.Message + ")"); }
                    if (det is not null)
                    {
                        o["firmware"] = Str(det["firmwareVersion"]);
                        o["firmwareUpdatable"] = FirstBool(det, "firmwareUpdatable") ?? false;
                        o["adoptedAt"] = Str(det["adoptedAt"]);
                        if (names.TryGetValue(Str(det["uplink"]?["deviceId"]), out var up)) o["uplink"] = up;
                    }
                    if (kind is "switch" or "gateway")
                    {
                        var ports = (JsonArray)o["ports"]!;
                        if (det?["interfaces"]?["ports"] is JsonArray ps)
                            foreach (var p in ps)
                                if (p is not null && FirstInt(p, "idx", "port_idx") is { } idx && idx > 0) ports.Add(PortOf(p, idx, info));
                        if (i == 0 && det?["interfaces"]?["ports"] is JsonArray fp && fp.Count > 0 && fp[0] is JsonObject f0)
                            ld.Add(console + " / " + name + ": a port from the Network API has these fields: " + string.Join(", ", f0.Select(kv => kv.Key)));
                        await LegacyPorts(hc, legacy, iref, Str(d["macAddress"]), key, ports, info, ld, devLabel, recs, ct);
                        var sorted = ports.OfType<JsonObject>().OrderBy(x => (int)x["n"]!).Select(x => (JsonNode)x.DeepClone()).ToList();
                        ports.Clear(); foreach (var x in sorted) ports.Add(x);
                    }
                    else
                        await LegacyPorts(hc, legacy, iref, Str(d["macAddress"]), key, (JsonArray)o["ports"]!, info, new JsonArray(), devLabel, recs, ct);
                    return (o, ld);
                }
                finally { gate.Release(); }
            })));
            foreach (var (o, ld) in built) { devs.Add(o); foreach (var x in ld) diag.Add(x!.DeepClone()); }
            if (!testOnly) LinkUplinks(devs, recs, diag, console + " / " + name);
            var siteObj = new JsonObject { ["name"] = name, ["console"] = console, ["devices"] = devs, ["networks"] = netList };
            if (!testOnly)
            {
                if (smDevice is not null) foreach (var o in devs.OfType<JsonObject>()) AddSiteManagerFacts(o, smDevice(Str(o["mac"])));
                await GatherInfo(siteObj, hc, api, legacy, protect, sid, iref, key, info, diag, console + " / " + name, ct);
            }
            result.Add(siteObj);
        }
        return result;
    }

    /** What the connector's system knows, as { sites: [{ name, console, devices: [...], networks: [...] }], diagnostics: [...] }. A test stops after the lists. */
    public async Task<JsonObject> Pull(Connector c, string key, bool testOnly, CancellationToken ct)
    {
        using var hc = Client(c);
        var sites = new JsonArray();
        var diag = new JsonArray();
        bool Wanted(params string[] names) => c.Site.Length == 0 || names.Any(n => n.Contains(c.Site, StringComparison.OrdinalIgnoreCase));
        if (c.Type == "unifi-cloud")
        {
            // Site Manager lists the consoles (hosts) on the account. Each console's own Network API is then reached through Site Manager's
            // connector, which gives the ports and VLANs; if that is not allowed, the plain device list is used (no ports).
            Progress("Reading the consoles on the account");
            var hosts = await TryPaged(hc, Cloud + "/v1/hosts", key, diag, "Consoles on the account (/v1/hosts)", ct);
            var byHost = await TryPaged(hc, Cloud + "/v1/devices", key, diag, "Devices by console (/v1/devices)", ct);
            if (hosts.Count == 0 && byHost.Count == 0)
            {
                hosts = await TryPaged(hc, Cloud + "/ea/hosts", key, diag, "Consoles, early-access list (/ea/hosts)", ct);
                byHost = await TryPaged(hc, Cloud + "/ea/devices", key, diag, "Devices, early-access list (/ea/devices)", ct);
            }
            var siteName = new Dictionary<string, string>();
            var smSites = await TryPaged(hc, Cloud + "/v1/sites", key, diag, "Sites (/v1/sites)", ct);
            foreach (var s in smSites)
            {
                var hid = Str(s["hostId"]); var nm = Str(s["meta"]?["desc"]);
                if (nm.Length == 0 || nm.Equals("default", StringComparison.OrdinalIgnoreCase)) continue;
                siteName.TryAdd(hid, nm);
            }
            var ids = hosts.Select(h => Str(h["id"])).Concat(byHost.Select(h => Str(h["hostId"]))).Where(x => x.Length > 0).Distinct().ToList();
            if (ids.Count == 0)
                diag.Add("The key is accepted but Site Manager lists no consoles for it. Site Manager only lists consoles that belong to the account the key was made on (owner access); a console you are only a member of is not listed. Make the key while signed in as the console's owner at unifi.ui.com > API, and check the console shows as online there.");
            foreach (var hid in ids)
            {
                var host = hosts.FirstOrDefault(h => Str(h["id"]) == hid);
                var dh = byHost.FirstOrDefault(h => Str(h["hostId"]) == hid);
                var hostName = FirstStr(dh, "hostName");
                if (hostName.Length == 0) hostName = FirstStr(host?["reportedState"], "name", "hostname");
                if (hostName.Length == 0) hostName = hid;
                var label = siteName.TryGetValue(hid, out var sn) ? sn : hostName;
                if (!Wanted(label, hostName)) continue;
                var enc = Uri.EscapeDataString(hid);
                var viaConnector = false;
                try
                {
                    var smDevs = (dh?["devices"] as JsonArray)?.OfType<JsonObject>().GroupBy(x => Serial(Str(x["mac"]))).ToDictionary(x => x.Key, x => (JsonNode)x.First()) ?? new Dictionary<string, JsonNode>();
                    var got = await PullNetwork(hc, Cloud + "/v1/connector/consoles/" + enc + "/proxy/network/integration/v1", Cloud + "/v1/connector/consoles/" + enc + "/proxy/network/api/s/", Cloud + "/v1/connector/consoles/" + enc + "/proxy/protect/integration/v1",
                        mac => smDevs.TryGetValue(Serial(mac), out var sd) ? sd : null, hostName, key, testOnly, n => true, diag, ct);
                    foreach (var g in got)
                    {
                        g["name"] = got.Count == 1 ? label : label + " / " + Str(g["name"]);
                        if (!testOnly) g["consoleInfo"] = ConsoleInfo(host, smSites.Where(x => Str(x["hostId"]) == hid).ToList());
                        sites.Add(g);
                    }
                    viaConnector = got.Count > 0;
                }
                catch (ConnectorException e) { diag.Add(hostName + ": the console's Network API was not reachable through Site Manager (" + e.Message + "); using the plain device list instead"); }
                if (viaConnector) continue;
                var devs = new JsonArray();
                foreach (var d in dh?["devices"] as JsonArray ?? new JsonArray())
                {
                    var model = Str(d?["model"]);
                    var o = Device(Str(d?["name"]), model, Str(d?["mac"]), Str(d?["ip"]), Str(d?["status"]), Kind(model, null));
                    o["firmware"] = Str(d?["version"]);
                    devs.Add(o);
                }
                sites.Add(new JsonObject { ["name"] = label, ["console"] = hostName, ["devices"] = devs, ["networks"] = new JsonArray() });
            }
        }
        else
        {
            var host = new Uri(c.Url).Host;
            foreach (var g in await PullNetwork(hc, c.Url + "/proxy/network/integration/v1", c.Url + "/proxy/network/api/s/", c.Url + "/proxy/protect/integration/v1", null, host, key, testOnly, n => Wanted(n), diag, ct)) sites.Add(g);
        }
        var count = sites.Sum(x => (x?["devices"] as JsonArray)?.Count ?? 0);
        return new JsonObject { ["connector"] = c.Name, ["type"] = c.Type, ["fetchedAt"] = DateTimeOffset.UtcNow, ["siteCount"] = sites.Count, ["deviceCount"] = count, ["sites"] = sites, ["diagnostics"] = diag };
    }
}

/** `CommsAtlas.Server --selftest`: starts privately on a free loopback port, checks every API route and a connector against a
    stand-in UniFi console with a throw-away data folder, then stops. */
static class SelfTest
{
    const string UnifiKey = "selftest-unifi-key-0123456789";
    const string FakeBase = "/_selftest/unifi/proxy/network/integration/v1";

    public static void MapFakeUnifi(WebApplication app)
    {
        static bool Ok(HttpContext c) => c.Request.Headers["X-API-KEY"].ToString() == UnifiKey;
        app.MapGet(FakeBase + "/sites", (HttpContext c) => Ok(c)
            ? Results.Json(new { offset = 0, limit = 200, count = 1, totalCount = 1, data = new[] { new { id = "site-1", internalReference = "default", name = "Test site" } } })
            : Results.StatusCode(401));
        // The console's older (legacy) API: networks, port profiles, the switch's port table and who is plugged in.
        const string Legacy = "/_selftest/unifi/proxy/network/api/s/default";
        app.MapGet(Legacy + "/rest/networkconf", (HttpContext c) => Ok(c)
            ? Results.Json(new { meta = new { rc = "ok" }, data = new object[] {
                new { _id = "n1", name = "Default", purpose = "corporate", vlan_enabled = false, ip_subnet = "192.168.1.1/24", dhcpd_enabled = true, dhcpd_start = "192.168.1.100", dhcpd_stop = "192.168.1.200" },
                new { _id = "n2", name = "Voice", purpose = "corporate", vlan_enabled = true, vlan = 20, ip_subnet = "10.0.20.1/24" },
                new { _id = "n3", name = "Internet", purpose = "wan" } } })
            : Results.StatusCode(401));
        app.MapGet(Legacy + "/rest/portconf", (HttpContext c) => Ok(c)
            ? Results.Json(new { meta = new { rc = "ok" }, data = new object[] {
                new { _id = "p-all", name = "All", forward = "all", native_networkconf_id = "n1", tagged_vlan_mgmt = "auto" },
                new { _id = "p-dis", name = "Disabled", forward = "disabled" },
                new { _id = "p-voice", name = "Voice", forward = "native", native_networkconf_id = "n2" } } })
            : Results.StatusCode(401));
        app.MapGet(Legacy + "/stat/sta", (HttpContext c) => Ok(c)
            ? Results.Json(new { meta = new { rc = "ok" }, data = new object[] { new { sw_mac = "aa:bb:cc:00:00:01", sw_port = 1, hostname = "PC-1", ip = "10.0.0.50", is_wired = true } } })
            : Results.StatusCode(401));
        app.MapGet(Legacy + "/stat/device/{mac}", (HttpContext c, string mac) => !Ok(c) ? Results.StatusCode(401)
            : Results.Json(new { meta = new { rc = "ok" }, data = new object[] { mac.EndsWith(":01")
                ? new { port_table = new object[] {
                    new { port_idx = 1, name = "Port 1", portconf_id = "p-voice", up = true, enable = true },
                    new { port_idx = 2, name = "Spare", portconf_id = "p-all", up = false, enable = true },
                    new { port_idx = 3, name = "Old", portconf_id = "p-dis", up = false, enable = true } },
                    uplink = new { uplink_mac = "aa:bb:cc:00:00:02", uplink_remote_port = 1, port_idx = 2 } }
                : new { port_table = Array.Empty<object>(), uplink = new { uplink_mac = "", uplink_remote_port = 0, port_idx = 0 } } } }));
        app.MapGet(Legacy + "/rest/wlanconf", (HttpContext c) => Ok(c)
            ? Results.Json(new { meta = new { rc = "ok" }, data = new object[] { new { name = "Corp", enabled = true, security = "wpapsk", wpa_mode = "wpa2", networkconf_id = "n2", x_passphrase = "secret-do-not-copy", is_guest = false } } })
            : Results.StatusCode(401));
        app.MapGet(Legacy + "/stat/health", (HttpContext c) => Ok(c)
            ? Results.Json(new { meta = new { rc = "ok" }, data = new object[] { new { subsystem = "wan", status = "ok", wan_ip = "203.0.113.5", isp_name = "Test ISP", num_adopted = 1 } } })
            : Results.StatusCode(401));
        app.MapGet("/_selftest/unifi/proxy/protect/integration/v1/meta/info", (HttpContext c) => Ok(c) ? Results.Json(new { applicationVersion = "7.0.0" }) : Results.StatusCode(401));
        app.MapGet("/_selftest/unifi/proxy/protect/integration/v1/cameras", (HttpContext c) => Ok(c)
            ? Results.Json(new object[] { new { id = "cam-1", modelKey = "camera", state = "CONNECTED", name = "Front door", mac = "AA:BB:CC:00:00:09", type = "UVC G5" },
                new { id = "cam-2", modelKey = "camera", state = "CONNECTED", name = "Yard", mac = "AA:BB:CC:00:00:0A", type = "HIKVISION DS-2CD" } })
            : Results.StatusCode(401));
        app.MapGet(FakeBase + "/sites/{sid}/wans", (HttpContext c, string sid) => Ok(c)
            ? Results.Json(new { offset = 0, limit = 200, count = 1, totalCount = 1, data = new[] { new { id = "wan-1", name = "Internet 1" } } })
            : Results.StatusCode(401));
        app.MapGet(FakeBase + "/sites/{sid}/wifi/broadcasts", (HttpContext c, string sid) => Ok(c)
            ? Results.Json(new { offset = 0, limit = 200, count = 1, totalCount = 1, data = new[] { new { id = "wb-1", name = "Corp", enabled = true, type = "STANDARD", securityConfiguration = new { type = "WPA2_PERSONAL" }, network = new { type = "SPECIFIC", networkId = "net-1" } } } })
            : Results.StatusCode(401));
        app.MapGet(FakeBase + "/sites/{sid}/networks", (HttpContext c, string sid) => Ok(c)
            ? Results.Json(new { offset = 0, limit = 200, count = 1, totalCount = 1, data = new[] { new { id = "net-1", name = "Office", vlanId = 10 } } })
            : Results.StatusCode(401));
        app.MapGet(FakeBase + "/sites/{sid}/devices", (HttpContext c, string sid) => Ok(c)
            ? Results.Json(new
            {
                offset = 0, limit = 200, count = 2, totalCount = 2,
                data = new object[]
                {
                    new { id = "dev-sw", name = "SW-TEST", model = "USW Pro 24", macAddress = "aa:bb:cc:00:00:01", ipAddress = "10.0.0.2", state = "ONLINE", features = new[] { "switching" }, interfaces = new[] { "ports" } },
                    new { id = "dev-ap", name = "AP-1", model = "U6 Pro", macAddress = "aa:bb:cc:00:00:02", ipAddress = "10.0.0.3", state = "ONLINE", features = new[] { "accessPoint" }, interfaces = new[] { "radios" } },
                },
            })
            : Results.StatusCode(401));
        app.MapGet(FakeBase + "/sites/{sid}/devices/{id}", (HttpContext c, string sid, string id) => !Ok(c) ? Results.StatusCode(401) : id != "dev-sw" ? Results.NotFound()
            : Results.Json(new
            {
                id, name = "SW-TEST", model = "USW Pro 24", macAddress = "aa:bb:cc:00:00:01", ipAddress = "10.0.0.2", state = "ONLINE", firmwareVersion = "7.1.0",
                uplink = new { deviceId = "dev-ap" },
                interfaces = new { ports = new object[] { new { idx = 1, state = "UP", connector = "RJ45", speedMbps = 1000 }, new { idx = 2, state = "DOWN", connector = "RJ45" }, new { idx = 25, state = "DOWN", connector = "SFP+", enabled = false }  } },
            }));
    }

    public static async Task<int> Run(WebApplication app, Accounts accounts, string dataPath)
    {
        app.Urls.Clear();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();
        var url = app.Urls.First().TrimEnd('/');
        var fails = 0;
        void Check(string what, bool ok, string got = "") { Console.WriteLine((ok ? "PASS " : "FAIL ") + what + (ok || got.Length == 0 ? "" : "  → " + got)); if (!ok) fails++; }
        using var http = new HttpClient { BaseAddress = new Uri(url) };
        async Task<(int Code, JsonNode? Body, string Text)> Call(HttpMethod m, string path, string? token = null, JsonNode? body = null)
        {
            using var req = new HttpRequestMessage(m, path);
            if (token is not null) req.Headers.Add("Authorization", "Bearer " + token);
            if (body is not null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var res = await http.SendAsync(req);
            var text = await res.Content.ReadAsStringAsync();
            JsonNode? j = null; try { j = JsonNode.Parse(text); } catch (JsonException) { }
            return ((int)res.StatusCode, j, text);
        }
        var ws = JsonNode.Parse("""{ "workspace": "Self test", "sites": [], "floors": [], "rooms": [], "racks": [], "templates": [], "devices": [], "connections": [], "vlans": [], "wlans": [], "history": [] }""")!;
        try
        {
            var r = await Call(HttpMethod.Get, "/api/v1/health");
            Check("health answers", r.Code == 200 && r.Body?["api"]?.GetValue<int>() == 3, r.Text);
            // ----- accounts, sign-in and two-step codes -----
            r = await Call(HttpMethod.Get, "/api/v1/auth/state");
            Check("a new install asks for first-time setup", r.Body?["setup"]?.GetValue<bool>() == true && (r.Body?["providers"] as JsonArray)?.Count == 0, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/signup", null, new JsonObject { ["name"] = "X", ["email"] = "x@example.com", ["password"] = "Sup3r-secret-pw" });
            Check("sign-up is closed until setup is done", r.Code == 409, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/setup", null, new JsonObject { ["name"] = "Boss", ["email"] = "boss@example.com", ["password"] = "short" });
            Check("a short password is refused", r.Code == 400, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/setup", null, new JsonObject { ["name"] = "Boss", ["email"] = "boss@example.com", ["password"] = "Correct-horse-9" });
            var boss = r.Body?["token"]?.ToString() ?? "";
            Check("setup makes the first Super Admin", r.Code == 200 && r.Body?["user"]?["role"]?.ToString() == "super_admin" && boss.StartsWith("cas_"), r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/setup", null, new JsonObject { ["name"] = "Mallory", ["email"] = "m@example.com", ["password"] = "Correct-horse-9" });
            Check("setup cannot be run twice", r.Code == 409, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "boss@example.com", ["password"] = "wrong-password-1" });
            Check("a wrong password is refused", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "BOSS@example.com", ["password"] = "Correct-horse-9" });
            Check("the right password signs in (email not case sensitive)", r.Code == 200 && r.Body?["token"] is not null, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/2fa/begin", boss);
            var secret = r.Body?["secret"]?.ToString() ?? "";
            Check("two-step set-up gives a key and an otpauth link", secret.Length == 32 && (r.Body?["uri"]?.ToString() ?? "").StartsWith("otpauth://totp/"), r.Text);
            var t0 = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
            Check("the code maths matches RFC 6238 (SHA-1 test vector)", Accounts.Code(Encoding.ASCII.GetBytes("12345678901234567890"), 59 / 30) == "287082");
            r = await Call(HttpMethod.Post, "/api/v1/auth/2fa/enable", boss, new JsonObject { ["secret"] = secret, ["code"] = "000000" });
            Check("a wrong code does not turn two-step on", r.Code == 400, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/2fa/enable", boss, new JsonObject { ["secret"] = secret, ["code"] = Accounts.Code(Accounts.UnBase32(secret), t0) });
            var recovery = (r.Body?["recovery"] as JsonArray)?.Select(x => x!.ToString()).ToArray() ?? [];
            Check("the right code turns it on and gives 8 recovery codes", r.Code == 200 && recovery.Length == 8, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "boss@example.com", ["password"] = "Correct-horse-9" });
            var ticket = r.Body?["ticket"]?.ToString() ?? "";
            Check("sign-in now asks for a code", r.Body?["step"]?.ToString() == "code" && r.Body?["token"] is null, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = ticket, ["code"] = "000000" });
            Check("a wrong code is refused", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = ticket, ["code"] = Accounts.Code(Accounts.UnBase32(secret), t0) });
            Check("a code cannot be used twice (replay)", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = ticket, ["code"] = Accounts.Code(Accounts.UnBase32(secret), t0 + 1) });
            Check("the next code signs in", r.Code == 200 && (r.Body?["token"]?.ToString() ?? "").StartsWith("cas_"), r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "boss@example.com", ["password"] = "Correct-horse-9" });
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = r.Body?["ticket"]?.ToString(), ["code"] = recovery[0] });
            Check("a recovery code signs in", r.Code == 200, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "boss@example.com", ["password"] = "Correct-horse-9" });
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = r.Body?["ticket"]?.ToString(), ["code"] = recovery[0] });
            Check("a recovery code works once only", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = "t1.fake.fake", ["code"] = "123456" });
            Check("a forged ticket is refused", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/2fa/disable", boss, new JsonObject { ["password"] = "Correct-horse-9" });
            Check("two-step can be turned off with the password", r.Code == 200, r.Text);
            // people
            r = await Call(HttpMethod.Post, "/api/v1/users", boss, new JsonObject { ["email"] = "admin@example.com", ["name"] = "Ann", ["role"] = "admin", ["password"] = "Temp-pass-12345" });
            Check("a Super Admin adds an Admin", r.Code == 200 && r.Body?["user"]?["mustChange"]?.GetValue<bool>() == true, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "admin@example.com", ["password"] = "Temp-pass-12345" });
            Check("a temporary password forces a change", r.Body?["step"]?.ToString() == "password", r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = r.Body?["ticket"]?.ToString(), ["newPassword"] = "Temp-pass-12345" });
            Check("the same password is refused", r.Code == 400, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "admin@example.com", ["password"] = "Temp-pass-12345" });
            r = await Call(HttpMethod.Post, "/api/v1/auth/step", null, new JsonObject { ["ticket"] = r.Body?["ticket"]?.ToString(), ["newPassword"] = "My-own-password-77" });
            var admin = r.Body?["token"]?.ToString() ?? "";
            Check("a new password signs in", r.Code == 200 && admin.StartsWith("cas_"), r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/users", admin, new JsonObject { ["email"] = "su2@example.com", ["role"] = "super_admin", ["password"] = "Temp-pass-12345" });
            Check("an Admin cannot make a Super Admin", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Get, "/api/v1/settings", admin);
            Check("settings are for Super Admins only", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/signup", null, new JsonObject { ["name"] = "New Person", ["email"] = "new@example.com", ["password"] = "Another-pass-55" });
            Check("sign-up waits for approval", r.Code == 200 && r.Body?["status"]?.ToString() == "pending", r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "new@example.com", ["password"] = "Another-pass-55" });
            Check("a pending account cannot sign in", r.Code == 403, r.Code.ToString());
            var pend = accounts.ByEmail("new@example.com")!;
            r = await Call(HttpMethod.Post, "/api/v1/users/" + pend.Id + "/approve", admin, new JsonObject { ["role"] = "viewer" });
            Check("an Admin approves it", r.Code == 200, r.Text);
            for (var i = 0; i < 5; i++) await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "new@example.com", ["password"] = "nope-nope-nope" });
            r = await Call(HttpMethod.Post, "/api/v1/auth/login", null, new JsonObject { ["email"] = "new@example.com", ["password"] = "Another-pass-55" });
            Check("five wrong passwords lock the account", r.Code == 429, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/logout", admin);
            r = await Call(HttpMethod.Get, "/api/v1/users", admin);
            Check("signing out ends the session", r.Code == 401, r.Code.ToString());
            string As(string role) { var u = accounts.ByEmail(role + "@example.com") ?? accounts.Create(role + "@example.com", role, role, "Correct-horse-9"); return accounts.Issue(u, "127.0.0.1", "selftest").Token; }
            var viewer = As("viewer"); var editor = As("editor"); admin = As("admin");

            r = await Call(HttpMethod.Get, "/api/v1/tenants");
            Check("not signed in → 401", r.Code == 401, r.Code.ToString());
            r = await Call(HttpMethod.Get, "/api/v1/sites", admin);
            Check("the old data API is gone → 404", r.Code == 404, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", viewer, new JsonObject { ["rev"] = 0, ["workspace"] = ws.DeepClone() });
            Check("a Viewer can't save → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["rev"] = 0, ["workspace"] = ws.DeepClone() });
            Check("an Editor saves → rev 1", r.Code == 200 && r.Body?["rev"]?.GetValue<long>() == 1, r.Text);
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["rev"] = 0, ["workspace"] = ws.DeepClone() });
            Check("a stale save → 409", r.Code == 409, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/tenants/bad%20id/workspace", editor, new JsonObject { ["rev"] = 0, ["workspace"] = ws.DeepClone() });
            Check("a bad tenant id is refused", r.Code == 404, r.Code.ToString());
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/workspace", viewer);
            Check("a Viewer reads the records", r.Code == 200 && r.Body?["rev"]?.GetValue<long>() == 1, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants", viewer);
            Check("tenants list", (r.Body?["tenants"] as JsonArray)?.Count == 1, r.Text);
            // saved versions
            var ws2 = ws.DeepClone(); ws2["workspace"] = "Second save";
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["rev"] = 1, ["workspace"] = ws2 });
            Check("a second save → rev 2", r.Code == 200 && r.Body?["rev"]?.GetValue<long>() == 2, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/history", editor);
            Check("an Editor can't list saved versions → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/history", admin);
            var hid = r.Body?["versions"]?[0]?["id"]?.GetValue<long>() ?? 0;
            Check("an Admin sees the earlier save", (r.Body?["versions"] as JsonArray)?.Count == 1 && hid > 0, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/tenants/default/history/" + hid + "/restore", admin);
            Check("restoring makes a new save (rev 3)", r.Code == 200 && r.Body?["rev"]?.GetValue<long>() == 3, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/workspace", viewer);
            Check("the restored records are the first save", r.Body?["workspace"]?["workspace"]?.ToString() == "Self test", r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/rev", viewer);
            Check("the revision check is cheap and right", r.Body?["rev"]?.GetValue<long>() == 3, r.Text);

            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/history", admin);
            Check("a restore keeps the version it replaced", (r.Body?["versions"] as JsonArray)?.Count == 2, r.Text);
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["rev"] = 3, ["workspace"] = ws.DeepClone() });
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/history", admin);
            Check("a quick follow-up save does not use up another history slot", (r.Body?["versions"] as JsonArray)?.Count == 2, r.Text);

            // tenants: one client each
            r = await Call(HttpMethod.Post, "/api/v1/tenants", admin, new JsonObject { ["name"] = "Nope" });
            Check("only a Super Admin adds a tenant → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/tenants", boss, new JsonObject { ["name"] = "  " });
            Check("a tenant needs a name → 400", r.Code == 400, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/tenants", boss, new JsonObject { ["name"] = "Acme Care" });
            var tid = r.Body?["id"]?.ToString() ?? "";
            Check("a Super Admin adds a tenant", r.Code == 200 && tid.StartsWith("acme-care-"), r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants", viewer);
            Check("everyone sees both tenants by default", (r.Body?["tenants"] as JsonArray)?.Count == 2, r.Text);
            r = await Call(HttpMethod.Put, "/api/v1/tenants/" + tid + "/workspace", editor, new JsonObject { ["rev"] = 0, ["workspace"] = ws.DeepClone() });
            Check("the new tenant keeps its own records (rev 1)", r.Code == 200 && r.Body?["rev"]?.GetValue<long>() == 1, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/rev", editor);
            Check("the other tenant is untouched (still rev 4)", r.Body?["rev"]?.GetValue<long>() == 4, r.Text);
            var vu = accounts.ByEmail("viewer@example.com")!;
            r = await Call(HttpMethod.Patch, "/api/v1/users/" + vu.Id, admin, new JsonObject { ["tenants"] = new JsonArray("default") });
            Check("an Admin limits a person to one tenant", r.Code == 200, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/" + tid + "/workspace", viewer);
            Check("…so the other tenant is closed to them → 401 after sessions end", r.Code == 401, r.Code.ToString());
            viewer = As("viewer");
            r = await Call(HttpMethod.Get, "/api/v1/tenants/" + tid + "/workspace", viewer);
            Check("…a fresh sign-in is refused that tenant → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Get, "/api/v1/tenants", viewer);
            Check("…and it is not listed for them", (r.Body?["tenants"] as JsonArray)?.Count == 1, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/default/workspace", viewer);
            Check("…but their own tenant opens", r.Code == 200, r.Code.ToString());
            r = await Call(HttpMethod.Patch, "/api/v1/tenants/" + tid, boss, new JsonObject { ["name"] = "Acme Care - Test" });
            Check("a Super Admin renames a tenant", r.Code == 200 && r.Body?["name"]?.ToString() == "Acme Care - Test", r.Text);
            /* floor plan pictures */
            var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 1, 2, 3 };
            async Task<(int Code, string Text, byte[] Raw, string? Type)> Raw(HttpMethod m, string path, string? token, byte[]? body)
            {
                using var req = new HttpRequestMessage(m, path);
                if (token is not null) req.Headers.Add("Authorization", "Bearer " + token);
                if (body is not null) { req.Content = new ByteArrayContent(body); req.Content.Headers.ContentType = new("application/octet-stream"); }
                using var res = await http.SendAsync(req);
                var raw = await res.Content.ReadAsByteArrayAsync();
                return ((int)res.StatusCode, Encoding.UTF8.GetString(raw.Length > 300 ? raw[..300] : raw), raw, res.Content.Headers.ContentType?.MediaType);
            }
            var pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", null, png);
            Check("a floor plan picture needs a sign-in → 401", pr.Code == 401, pr.Code.ToString());
            pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", viewer, png);
            Check("a Viewer cannot add a floor plan picture → 403", pr.Code == 403, pr.Code.ToString());
            pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", editor, Encoding.ASCII.GetBytes("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
            Check("an SVG (or anything that is not PNG, JPEG or WebP) is refused → 415", pr.Code == 415, pr.Code + " " + pr.Text);
            pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", editor, Array.Empty<byte>());
            Check("an empty upload is refused", pr.Code == 413, pr.Code.ToString());
            pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", editor, png);
            var planId = pr.Code == 200 ? (JsonNode.Parse(pr.Text)?["id"]?.ToString() ?? "") : "";
            Check("an Editor stores a floor plan picture", pr.Code == 200 && planId.Length == 16, pr.Code + " " + pr.Text);
            pr = await Raw(HttpMethod.Get, "/api/v1/tenants/default/plans/" + planId, viewer, null);
            Check("a Viewer of that tenant can see it, with the right type", pr.Code == 200 && pr.Type == "image/png" && pr.Raw.SequenceEqual(png), pr.Code + " " + pr.Type);
            using (var cond = new HttpRequestMessage(HttpMethod.Get, "/api/v1/tenants/default/plans/" + planId))
            {
                cond.Headers.Add("Authorization", "Bearer " + viewer); cond.Headers.Add("If-None-Match", "\"" + planId + "\"");
                using var cres = await http.SendAsync(cond);
                Check("a picture the browser already holds answers 304 (and is always re-checked)", (int)cres.StatusCode == 304 && cres.Headers.CacheControl?.NoCache == true, ((int)cres.StatusCode).ToString());
            }
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["workspace"] = ws.DeepClone() });
            Check("a save with no version number is refused → 400", r.Code == 400, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/tenants/default/workspace", editor, new JsonObject { ["rev"] = "x", ["workspace"] = ws.DeepClone() });
            Check("a save with a non-numeric version is refused → 400, not a crash", r.Code == 400, r.Code.ToString());
            pr = await Raw(HttpMethod.Get, "/api/v1/tenants/default/plans/" + planId, null, null);
            Check("…but not without signing in → 401", pr.Code == 401, pr.Code.ToString());
            pr = await Raw(HttpMethod.Get, "/api/v1/tenants/" + tid + "/plans/" + planId, editor, null);
            Check("…and not through another tenant → 404", pr.Code == 404, pr.Code.ToString());
            pr = await Raw(HttpMethod.Get, "/api/v1/tenants/default/plans/..%2F..%2Fx", editor, null);
            Check("a plan id that is not 16 hex characters finds nothing", pr.Code == 404 || pr.Code == 400, pr.Code.ToString());
            var bigBody = new byte[WorkspaceStore.MaxPlanBytes + 2048]; bigBody[0] = 0x89; bigBody[1] = 0x50; bigBody[2] = 0x4E; bigBody[3] = 0x47;
            var refusedBig = false; var bigCode = 0;
            try { pr = await Raw(HttpMethod.Post, "/api/v1/tenants/default/plans", editor, bigBody); bigCode = pr.Code; refusedBig = pr.Code == 413; }
            catch (Exception e) when (e is HttpRequestException or IOException) { refusedBig = true; } // the server may close the connection instead of reading an oversized upload
            Check("a picture over the size limit is refused (413, or the connection is closed)", refusedBig, bigCode.ToString());
            r = await Call(HttpMethod.Delete, "/api/v1/tenants/" + tid, admin);
            Check("an Admin cannot remove a tenant → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Delete, "/api/v1/tenants/" + tid, boss);
            Check("a Super Admin removes a tenant", r.Code == 200, r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/tenants/" + tid + "/workspace", editor);
            Check("a removed tenant is gone → 404", r.Code == 404, r.Code.ToString());
            r = await Call(HttpMethod.Delete, "/api/v1/tenants/default", boss);
            Check("the last tenant cannot be removed → 409", r.Code == 409, r.Code.ToString());

            // Connectors
            r = await Call(HttpMethod.Get, "/api/v1/connectors", viewer);
            Check("a Viewer can't see connectors → 403", r.Code == 403, r.Code.ToString());
            var con = new JsonObject { ["name"] = "Test console", ["type"] = "unifi-local", ["url"] = url + "/_selftest/unifi", ["apiKey"] = UnifiKey };
            r = await Call(HttpMethod.Put, "/api/v1/connectors", editor, con.DeepClone());
            Check("an Editor can't add a connector → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/connectors", admin, new JsonObject { ["name"] = "Bad", ["type"] = "unifi-local", ["url"] = "ftp://example.com", ["apiKey"] = UnifiKey });
            Check("a bad address is refused", r.Code == 400, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/connectors", admin, con.DeepClone());
            var id = r.Body?["id"]?.ToString() ?? "";
            Check("an Admin adds a connector", r.Code == 200 && id.StartsWith("con_") && r.Body?["keyHint"]?.ToString() == "…6789", r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/connectors", editor);
            Check("the key is never sent back", r.Code == 200 && (r.Body?["connectors"] as JsonArray)?.Count == 1 && !r.Text.Contains(UnifiKey), r.Text);
            Check("the key is encrypted on disk", !File.ReadAllText(Path.Combine(dataPath, "connectors.json")).Contains(UnifiKey));
            r = await Call(HttpMethod.Post, "/api/v1/connectors/" + id + "/test", editor);
            Check("an Editor can't test → 403", r.Code == 403, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/connectors/" + id + "/test", admin);
            Check("test reaches the console", r.Code == 200 && r.Body?["siteCount"]?.GetValue<int>() == 1 && r.Body?["deviceCount"]?.GetValue<int>() == 2, r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/connectors/" + id + "/pull", editor);
            var sw = r.Body?["sites"]?[0]?["devices"]?[0];
            Check("pull gives the switch with its ports", r.Code == 200 && sw?["kind"]?.ToString() == "switch" && sw?["firmware"]?.ToString() == "7.1.0" &&
                sw?["serial"]?.ToString() == "AABBCC000001" && (sw?["ports"] as JsonArray)?.Count == 4 && sw?["ports"]?[0]?["up"]?.GetValue<bool>() == true && sw?["uplink"]?.ToString() == "AP-1", r.Text);
            Check("every port is listed, linked or not", (sw?["ports"] as JsonArray)?.Select(x => x?["n"]?.GetValue<int>()).SequenceEqual(new int?[] { 1, 2, 3, 25 }) == true, r.Text);
            Check("a port carries its VLAN number and name", sw?["ports"]?[0]?["vlan"]?.GetValue<int>() == 20 && sw?["ports"]?[0]?["vlanName"]?.ToString() == "Voice" && sw?["ports"]?[1]?["vlan"]?.GetValue<int>() == 1 && sw?["ports"]?[1]?["tagged"]?.ToString() == "All", r.Text);
            Check("a disabled port is marked disabled", sw?["ports"]?[2]?["disabled"]?.GetValue<bool>() == true && sw?["ports"]?[3]?["disabled"]?.GetValue<bool>() == true && sw?["ports"]?[0]?["disabled"]?.GetValue<bool>() == false, r.Text);
            Check("the site lists its networks with subnet, gateway and DHCP", (r.Body?["sites"]?[0]?["networks"] as JsonArray)?.Any(n => n?["vid"]?.GetValue<int>() == 1 && n["subnet"]?.ToString() == "192.168.1.0/24" && n["gateway"]?.ToString() == "192.168.1.1" && n["dhcp"]?.ToString() == "192.168.1.100 - 192.168.1.200") == true
                && (r.Body?["sites"]?[0]?["networks"] as JsonArray)?.Any(n => n?["vid"]?.GetValue<int>() == 20 && n["subnet"]?.ToString() == "10.0.20.0/24") == true
                && !(r.Body?["sites"]?[0]?["networks"] as JsonArray)!.Any(n => n?["name"]?.ToString() == "Internet"), r.Text);
            Check("a port says what is plugged into it", sw?["ports"]?[0]?["connected"]?[0]?.ToString() == "PC-1 (10.0.0.50)" && sw?["ports"]?[0]?["profile"]?.ToString() == "Voice", r.Text);
            Check("a port names the UniFi device it is cabled to, and the port on that device", sw?["ports"]?[1]?["peer"]?["name"]?.ToString() == "AP-1" && sw?["ports"]?[1]?["peer"]?["port"]?.GetValue<int>() == 1 && sw?["uplinkPort"]?.GetValue<int>() == 1, r.Text);
            Check("a pull carries its diagnostics", (r.Body?["diagnostics"] as JsonArray)?.Count > 0, r.Text);
            var inf = r.Body?["sites"]?[0]?["info"];
            Check("the pull gathers the site's WANs, Wi-Fi with its VLAN and Wi-Fi networks", inf?["wans"]?[0]?["name"]?.ToString() == "Internet 1" && inf?["wifi"]?[0]?["vlan"]?.GetValue<int>() == 10
                && inf?["wlans"]?[0]?["vlan"]?.GetValue<int>() == 20, r.Text);
            Check("only the UniFi cameras are kept", (r.Body?["sites"]?[0]?["protect"]?["devices"] as JsonArray)?.Count == 1, r.Text);
            Check("a Wi-Fi passphrase is never read", !r.Text.Contains("secret-do-not-copy"), "the passphrase appeared in the pull");
            Check("Protect devices come with the pull", r.Body?["sites"]?[0]?["protect"]?["devices"]?[0]?["name"]?.ToString() == "Front door" && r.Body?["sites"]?[0]?["protect"]?["version"]?.ToString() == "7.0.0", r.Text);
            Check("the pull lists the active clients", r.Body?["sites"]?[0]?["clients"]?[0]?["name"]?.ToString() == "PC-1" && r.Body?["sites"]?[0]?["clients"]?[0]?["switch"]?.ToString() == "SW-TEST", r.Text);
            Check("pull tells access points apart", r.Body?["sites"]?[0]?["devices"]?[1]?["kind"]?.ToString() == "ap", r.Text);
            r = await Call(HttpMethod.Post, "/api/v1/connectors/" + id + "/pull-start", editor);
            var jid = r.Body?["job"]?.ToString() ?? "";
            Check("a pull can be started in the background", r.Code == 200 && jid.Length > 0, r.Text);
            for (var i = 0; i < 40; i++)
            {
                r = await Call(HttpMethod.Get, "/api/v1/connector-jobs/" + jid, editor);
                if (r.Body?["state"]?.ToString() != "running") break;
                await Task.Delay(250);
            }
            Check("the background pull finishes with the same result", r.Body?["state"]?.ToString() == "done" && r.Body?["result"]?["sites"]?[0]?["devices"]?[0]?["kind"]?.ToString() == "switch", r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/connector-jobs/nope", editor);
            Check("an unknown pull → 404", r.Code == 404, r.Code.ToString());
            r = await Call(HttpMethod.Put, "/api/v1/connectors", admin, new JsonObject { ["id"] = id, ["name"] = "Test console", ["type"] = "unifi-local", ["url"] = url + "/_selftest/unifi", ["apiKey"] = "wrong-key-wrong-key" });
            r = await Call(HttpMethod.Post, "/api/v1/connectors/" + id + "/pull", editor);
            Check("a wrong key is reported", r.Code == 502 && (r.Body?["error"]?.ToString() ?? "").Contains("refused"), r.Text);
            r = await Call(HttpMethod.Get, "/api/v1/connectors", editor);
            Check("the last result is kept", r.Body?["connectors"]?[0]?["lastOk"]?.GetValue<bool>() == false, r.Text);
            r = await Call(HttpMethod.Delete, "/api/v1/connectors/" + id, admin);
            Check("an Admin removes a connector", r.Code == 200, r.Code.ToString());

            r = await Call(HttpMethod.Get, "/api/v1/nothing-here", admin);
            Check("an unknown API address → 404", r.Code == 404, r.Code.ToString());
            r = await Call(HttpMethod.Post, "/api/v1/auth/sso", null, new JsonObject { ["provider"] = "nope", ["id_token"] = "not.a.token" });
            Check("a bad single sign-on request is refused", r.Code == 400, r.Code + " " + r.Text);
            r = await Call(HttpMethod.Get, "/config.js");
            Check("config.js comes from appsettings", r.Code == 200 && r.Text.StartsWith("window.APP_CONFIG"), r.Text.Length > 80 ? r.Text[..80] : r.Text);
            if (app.Environment.WebRootFileProvider.GetFileInfo("index.html").Exists)
            {
                r = await Call(HttpMethod.Get, "/");
                Check("the web app is served", r.Code == 200 && r.Text.Contains("/js/main.js"), r.Code.ToString());
                r = await Call(HttpMethod.Get, "/js/connectors.js");
                Check("the app's scripts are served", r.Code == 200, r.Code.ToString());
                r = await Call(HttpMethod.Get, "/version.js");
                Check("the build number is in the web app", r.Code == 200 && r.Text.Contains("APP_BUILD"), r.Text.Length > 60 ? r.Text[..60] : r.Text);
            }
            else Console.WriteLine("SKIP the web app is served (no web app in this copy of the program)");

            // Database copies: only the newest few are kept (this is what stops them piling up).
            var bdir = Path.Combine(dataPath, "backups-keep-test");
            var bdb = new Db(Path.Combine(dataPath, "keeptest.db")) { Keep = 2 };
            for (var i = 0; i < 4; i++) bdb.Backup(bdir);
            var kept = Directory.GetFiles(bdir, "commsatlas-*.db");
            Check("only the newest 2 database copies are kept", kept.Length == 2, kept.Length.ToString());
            bdb.Keep = 0; bdb.Backup(bdir, 1);
            Check("at least one copy is always kept", Directory.GetFiles(bdir, "commsatlas-*.db").Length == 1);
        }
        catch (Exception e) { Console.WriteLine("FAIL the self test stopped: " + e.Message); fails++; }
        finally
        {
            await app.StopAsync();
            try { Directory.Delete(dataPath, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        Console.WriteLine(fails == 0 ? "All checks passed." : fails + " check(s) failed.");
        return fails == 0 ? 0 : 1;
    }
}
