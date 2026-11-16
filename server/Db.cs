// SQLite data layer: one file (data/commsatlas.db) holds workspaces, their history, accounts, sessions, settings and the audit log.
using System.IO.Compression;
using System.Text;
using Microsoft.Data.Sqlite;

sealed class Db
{
    readonly string cs;
    public string FilePath { get; }

    public Db(string file)
    {
        FilePath = file;
        cs = new SqliteConnectionStringBuilder { DataSource = file, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true }.ToString();
        using var c = Open();
        Exec(c, "PRAGMA journal_mode=WAL;");
        Exec(c, """
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspaces (tenant TEXT PRIMARY KEY, rev INTEGER NOT NULL, saved_at TEXT NOT NULL, saved_by TEXT NOT NULL, json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_history (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, rev INTEGER NOT NULL, saved_at TEXT NOT NULL, saved_by TEXT NOT NULL, data BLOB NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_history_tenant ON workspace_history(tenant, id);
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'viewer',
                status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'local', pass_hash TEXT, must_change INTEGER NOT NULL DEFAULT 0,
                totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_step INTEGER NOT NULL DEFAULT 0, recovery TEXT,
                failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER NOT NULL DEFAULT 0, role_from TEXT);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, ip TEXT, agent TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
            """);
        // Which tenants a person may open: empty means all of them, otherwise a JSON list of tenant ids. (Added in version 3.)
        if (Scalar<long>("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='tenants'") == 0) Exec(c, "ALTER TABLE users ADD COLUMN tenants TEXT");
    }

    public SqliteConnection Open()
    {
        var c = new SqliteConnection(cs);
        c.Open();
        Exec(c, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
        return c;
    }

    static void Bind(SqliteCommand cmd, (string, object?)[] ps)
    {
        foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
    }
    public static int Exec(SqliteConnection c, string sql, params (string, object?)[] ps)
    {
        using var cmd = c.CreateCommand(); cmd.CommandText = sql; Bind(cmd, ps); return cmd.ExecuteNonQuery();
    }
    public int Exec(string sql, params (string, object?)[] ps) { using var c = Open(); return Exec(c, sql, ps); }
    public T? Scalar<T>(string sql, params (string, object?)[] ps)
    {
        using var c = Open(); using var cmd = c.CreateCommand(); cmd.CommandText = sql; Bind(cmd, ps);
        var v = cmd.ExecuteScalar();
        if (v is null || v is DBNull) return default;
        return (T)Convert.ChangeType(v, Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T));
    }
    public List<T> Rows<T>(string sql, Func<SqliteDataReader, T> map, params (string, object?)[] ps)
    {
        using var c = Open(); using var cmd = c.CreateCommand(); cmd.CommandText = sql; Bind(cmd, ps);
        using var r = cmd.ExecuteReader(); var list = new List<T>();
        while (r.Read()) list.Add(map(r));
        return list;
    }

    public string? Setting(string key) => Scalar<string>("SELECT value FROM settings WHERE key=$k", ("$k", key));
    public void SetSetting(string key, string value) =>
        Exec("INSERT INTO settings(key,value) VALUES($k,$v) ON CONFLICT(key) DO UPDATE SET value=$v", ("$k", key), ("$v", value));

    public static byte[] Gzip(string s)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest, true)) gz.Write(Encoding.UTF8.GetBytes(s));
        return ms.ToArray();
    }
    public static string Gunzip(byte[] b)
    {
        using var gz = new GZipStream(new MemoryStream(b), CompressionMode.Decompress);
        using var o = new MemoryStream(); gz.CopyTo(o); return Encoding.UTF8.GetString(o.ToArray());
    }

    /** How many database copies are kept in data/backups (appsettings: CommsAtlas:BackupsToKeep). */
    public int Keep { get; set; } = 14;

    /** A consistent copy of the whole database (works while the server is running). Keeps the newest `Keep` copies, never fewer than one. */
    public string Backup(string dir, int keep = 0)
    {
        if (keep <= 0) keep = Keep;
        keep = Math.Max(1, keep);
        Directory.CreateDirectory(dir);
        var target = Path.Combine(dir, "commsatlas-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + ".db");
        using (var c = Open()) Exec(c, "VACUUM INTO $f", ("$f", target));
        foreach (var old in Directory.GetFiles(dir, "commsatlas-*.db").OrderByDescending(x => x).Skip(keep)) { try { File.Delete(old); } catch (IOException) { } }
        return target;
    }
}
