// Each tenant's workspace in SQLite, with the last 40 saves kept (compressed) so an older save can be brought back.
// Records saved by earlier versions (data/tenants/*.json) are imported once on first start.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

class WorkspaceStore(Db db)
{
    readonly ConcurrentDictionary<string, SemaphoreSlim> locks = new();
    static readonly Regex Id = new("^[A-Za-z0-9_-]{1,64}$");
    public const int KeepHistory = 40;
    public static bool ValidId(string id) => Id.IsMatch(id);
    public record Saved(long Rev, DateTimeOffset SavedAt, string SavedBy, JsonObject Workspace);
    public record Summary(string Id, string Name, long Rev, DateTimeOffset SavedAt, string SavedBy);
    public record WriteResult(bool Conflict, long Rev);
    public record HistoryItem(long Id, long Rev, DateTimeOffset SavedAt, string SavedBy);

    public Saved? Read(string id)
    {
        if (!ValidId(id)) return null;
        var row = db.Rows("SELECT rev,saved_at,saved_by,json FROM workspaces WHERE tenant=$t",
            r => (Rev: r.GetInt64(0), At: r.GetString(1), By: r.GetString(2), Json: r.GetString(3)), ("$t", id)).FirstOrDefault();
        if (row.Json is null) return null;
        return JsonNode.Parse(row.Json) is JsonObject ws ? new Saved(row.Rev, DateTimeOffset.Parse(row.At), row.By, ws) : null;
    }
    public long Rev(string id) => ValidId(id) ? db.Scalar<long>("SELECT rev FROM workspaces WHERE tenant=$t", ("$t", id)) : 0;
    /* ---------- tenants: each is one client with its own sites, rooms, racks and library ---------- */
    public const int MaxTenants = 200;
    public IEnumerable<Summary> List() => db.Rows(
        "SELECT t.id,t.name,COALESCE(w.rev,0),COALESCE(w.saved_at,''),COALESCE(w.saved_by,''),t.created FROM tenants t LEFT JOIN workspaces w ON w.tenant=t.id ORDER BY t.name COLLATE NOCASE, t.id",
        r => new Summary(r.GetString(0), r.GetString(1), r.GetInt64(2), r.GetString(3) is { Length: > 0 } at ? DateTimeOffset.Parse(at) : DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(5)), r.GetString(4)));
    public bool Exists(string id) => ValidId(id) && db.Scalar<long>("SELECT COUNT(*) FROM tenants WHERE id=$t", ("$t", id)) > 0;
    public long Count() => db.Scalar<long>("SELECT COUNT(*) FROM tenants");
    public string? NameOf(string id) => ValidId(id) ? db.Scalar<string>("SELECT name FROM tenants WHERE id=$t", ("$t", id)) : null;

    /** Makes sure every saved workspace is listed as a tenant, and that "default" always is (first start, or after an upgrade from version 2). */
    public void SyncTenants()
    {
        foreach (var (id, json) in db.Rows("SELECT tenant,json FROM workspaces", r => (r.GetString(0), r.GetString(1))))
        {
            if (Exists(id)) continue;
            var name = id;
            try { if (JsonNode.Parse(json) is JsonObject o && o["workspace"]?.GetValue<string>() is { Length: > 0 } n) name = n; } catch (Exception) { }
            db.Exec("INSERT OR IGNORE INTO tenants(id,name,created) VALUES($i,$n,$c)", ("$i", id), ("$n", name), ("$c", DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        }
        if (!Exists("default")) db.Exec("INSERT OR IGNORE INTO tenants(id,name,created) VALUES('default','Main tenant',$c)", ("$c", DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
    }
    public static string CleanName(string name) => System.Text.RegularExpressions.Regex.Replace(name ?? "", @"[\p{C}]", "").Trim();
    public string? Create(string name)
    {
        name = CleanName(name);
        if (name.Length is 0 or > 80 || Count() >= MaxTenants) return null;
        var slug = System.Text.RegularExpressions.Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length > 40) slug = slug[..40].Trim('-');
        var id = (slug.Length > 0 ? slug : "tenant") + "-" + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(3)).ToLowerInvariant();
        db.Exec("INSERT INTO tenants(id,name,created) VALUES($i,$n,$c)", ("$i", id), ("$n", name), ("$c", DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        return id;
    }
    public bool Rename(string id, string name)
    {
        name = CleanName(name);
        if (name.Length is 0 or > 80 || !Exists(id)) return false;
        db.Exec("UPDATE tenants SET name=$n WHERE id=$i", ("$n", name), ("$i", id));
        return true;
    }
    /** Removes a tenant, its records and its saved versions. (The daily backups still hold them.) */
    public bool Delete(string id)
    {
        if (!Exists(id)) return false;
        using var c = db.Open(); using var tx = c.BeginTransaction();
        Db.Exec(c, "DELETE FROM workspace_history WHERE tenant=$t", ("$t", id));
        Db.Exec(c, "DELETE FROM workspaces WHERE tenant=$t", ("$t", id));
        Db.Exec(c, "DELETE FROM tenants WHERE id=$t", ("$t", id));
        tx.Commit(); return true;
    }

    /** The app saves a second after each edit, so keeping every save would use all 40 history slots in a few minutes of work.
        An earlier version is kept only if the newest kept one is at least this old (or the save is a restore, which always keeps what it replaces). */
    public const int HistoryGapSeconds = 120;
    public async Task<WriteResult> Write(string id, JsonObject ws, long baseRev, string by, bool keepPrevious = false)
    {
        var gate = locks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            using var c = db.Open();
            using var tx = c.BeginTransaction();
            long rev = 0; string? oldJson = null, oldBy = null, oldAt = null;
            using (var q = c.CreateCommand())
            {
                q.Transaction = tx; q.CommandText = "SELECT rev,json,saved_by,saved_at FROM workspaces WHERE tenant=$t"; q.Parameters.AddWithValue("$t", id);
                using var r = q.ExecuteReader();
                if (r.Read()) { rev = r.GetInt64(0); oldJson = r.GetString(1); oldBy = r.GetString(2); oldAt = r.GetString(3); }
            }
            if (baseRev >= 0 && baseRev != rev) return new WriteResult(true, rev);
            var now = DateTimeOffset.UtcNow.ToString("O");
            var lastKept = db.Scalar<string>("SELECT MAX(saved_at) FROM workspace_history WHERE tenant=$t", ("$t", id));
            var gapOk = keepPrevious || lastKept is null || oldAt is null || DateTimeOffset.Parse(oldAt) - DateTimeOffset.Parse(lastKept) >= TimeSpan.FromSeconds(HistoryGapSeconds);
            if (oldJson is not null && gapOk)
            {
                Db.Exec(c, "INSERT INTO workspace_history(tenant,rev,saved_at,saved_by,data) VALUES($t,$r,$a,$b,$d)", ("$t", id), ("$r", rev), ("$a", oldAt), ("$b", oldBy), ("$d", Db.Gzip(oldJson)));
                Db.Exec(c, "DELETE FROM workspace_history WHERE tenant=$t AND id NOT IN (SELECT id FROM workspace_history WHERE tenant=$t ORDER BY id DESC LIMIT $n)", ("$t", id), ("$n", KeepHistory));
            }
            Db.Exec(c, "INSERT INTO workspaces(tenant,rev,saved_at,saved_by,json) VALUES($t,$r,$a,$b,$j) ON CONFLICT(tenant) DO UPDATE SET rev=$r, saved_at=$a, saved_by=$b, json=$j",
                ("$t", id), ("$r", rev + 1), ("$a", now), ("$b", by), ("$j", ws.ToJsonString()));
            tx.Commit();
            return new WriteResult(false, rev + 1);
        }
        finally { gate.Release(); }
    }

    public List<HistoryItem> History(string id) => db.Rows("SELECT id,rev,saved_at,saved_by FROM workspace_history WHERE tenant=$t ORDER BY id DESC",
        r => new HistoryItem(r.GetInt64(0), r.GetInt64(1), DateTimeOffset.Parse(r.GetString(2)), r.GetString(3)), ("$t", id));
    public JsonObject? HistoryWorkspace(string id, long historyId)
    {
        var data = db.Rows("SELECT data FROM workspace_history WHERE tenant=$t AND id=$i", r => (byte[])r[0], ("$t", id), ("$i", historyId)).FirstOrDefault();
        return data is null ? null : JsonNode.Parse(Db.Gunzip(data)) as JsonObject; // the saved text is the workspace itself
    }

    /** Brings in data/tenants/*.json from versions that kept records in files. Runs only for tenants not yet in the database. */
    public int ImportLegacy(string root)
    {
        var dir = Path.Combine(root, "tenants");
        if (!Directory.Exists(dir)) return 0;
        var n = 0;
        foreach (var f in Directory.GetFiles(dir, "*.json"))
        {
            var id = Path.GetFileNameWithoutExtension(f);
            if (!ValidId(id) || db.Scalar<long>("SELECT COUNT(*) FROM workspaces WHERE tenant=$t", ("$t", id)) > 0) continue;
            try
            {
                if (JsonNode.Parse(File.ReadAllText(f)) is not JsonObject o || o["workspace"] is not JsonObject ws) continue;
                db.Exec("INSERT INTO workspaces(tenant,rev,saved_at,saved_by,json) VALUES($t,$r,$a,$b,$j)", ("$t", id), ("$r", o["rev"]?.GetValue<long>() ?? 1),
                    ("$a", (o["savedAt"]?.GetValue<DateTimeOffset>() ?? DateTimeOffset.UtcNow).ToString("O")), ("$b", o["savedBy"]?.GetValue<string>() ?? "import"), ("$j", ws.ToJsonString()));
                n++;
            }
            catch (Exception) { /* a damaged file is left where it is */ }
        }
        return n;
    }
}
