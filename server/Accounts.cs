// Accounts: users, passwords (PBKDF2), two-step codes (TOTP, works with Google/Microsoft Authenticator), sessions, lockout and the audit log.
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

/** Tenants: null means every tenant; otherwise only those ids. Admins and Super Admins always see every tenant. */
record Caller(string Name, string Role, string Id = "", string[]? Tenants = null);

sealed class UserRow
{
    public string Id = "", Email = "", Name = "", Role = "viewer", Status = "active", Source = "local", RoleFrom = "";
    public string? PassHash, TotpSecretEnc, RecoveryJson, TenantsJson;
    public bool MustChange, TotpEnabled;
    public long TotpStep, Failed, LockedUntil, Created, LastLogin;
    public string[]? TenantList => Accounts.ParseTenants(TenantsJson);
    public object Public() => new { id = Id, email = Email, name = Name, role = Role, status = Status, source = Source, totp = TotpEnabled, mustChange = MustChange, created = Created, lastLogin = LastLogin, locked = LockedUntil > Now(), tenants = (object?)TenantList ?? "all" };
    public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
}

sealed class Accounts(Db db, TokenService tokens)
{
    public static readonly string[] Levels = ["viewer", "technician", "editor", "admin", "super_admin"];
    public static int Rank(string role) => Array.IndexOf(Levels, role) + 1;
    public const int PwMin = 10, PwMax = 128, Iter = 310_000;
    public const int LockAfter = 5, LockSeconds = 300;
    readonly byte[] totpKey = tokens.Derive("totp-secrets-v1");
    readonly ConcurrentDictionary<string, Queue<long>> ipHits = new();

    /* ---------- reading users ---------- */
    const string Cols = "id,email,name,role,status,source,pass_hash,must_change,totp_secret,totp_enabled,totp_step,recovery,failed,locked_until,created,last_login,role_from,tenants";
    static UserRow Read(SqliteDataReader r) => new()
    {
        Id = r.GetString(0), Email = r.GetString(1), Name = r.GetString(2), Role = r.GetString(3), Status = r.GetString(4), Source = r.GetString(5),
        PassHash = r.IsDBNull(6) ? null : r.GetString(6), MustChange = r.GetInt64(7) != 0, TotpSecretEnc = r.IsDBNull(8) ? null : r.GetString(8), TotpEnabled = r.GetInt64(9) != 0,
        TotpStep = r.GetInt64(10), RecoveryJson = r.IsDBNull(11) ? null : r.GetString(11), Failed = r.GetInt64(12), LockedUntil = r.GetInt64(13), Created = r.GetInt64(14), LastLogin = r.GetInt64(15),
        RoleFrom = r.IsDBNull(16) ? "" : r.GetString(16), TenantsJson = r.IsDBNull(17) ? null : r.GetString(17),
    };
    /** null (or "all") means every tenant; otherwise the list of tenant ids. */
    public static string[]? ParseTenants(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "all") return null;
        try { return JsonNode.Parse(json) is JsonArray a ? a.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToArray() : null; } catch (JsonException) { return null; }
    }
    /** Admins and Super Admins open every tenant; others only the ones they were given. */
    public static bool CanTenant(Caller c, string tenant) => Rank(c.Role) >= 4 || c.Tenants is null || c.Tenants.Contains(tenant);
    public bool AnyUsers() => db.Scalar<long>("SELECT COUNT(*) FROM users") > 0;
    public UserRow? ById(string id) => db.Rows($"SELECT {Cols} FROM users WHERE id=$i", Read, ("$i", id)).FirstOrDefault();
    public UserRow? ByEmail(string email) => db.Rows($"SELECT {Cols} FROM users WHERE email=$e", Read, ("$e", email.Trim())).FirstOrDefault();
    public List<UserRow> All() => db.Rows($"SELECT {Cols} FROM users ORDER BY email", Read);
    public long ActiveSuperAdmins() => db.Scalar<long>("SELECT COUNT(*) FROM users WHERE role='super_admin' AND status='active'");

    public static bool ValidEmail(string e) => e.Length is > 3 and <= 254 && System.Text.RegularExpressions.Regex.IsMatch(e, @"^[^\s@]+@[^\s@]+\.[^\s@]+$");
    public static string? PasswordProblem(string pw, string email = "")
    {
        if (pw.Length < PwMin) return $"Use at least {PwMin} characters.";
        if (pw.Length > PwMax) return $"Use at most {PwMax} characters.";
        if (email.Length > 0 && pw.Equals(email, StringComparison.OrdinalIgnoreCase)) return "The password can not be your email address.";
        if (pw.Distinct().Count() < 4) return "Choose a less repetitive password.";
        return null;
    }

    public UserRow Create(string email, string name, string role, string? password, string status = "active", string source = "local", bool mustChange = false, string roleFrom = "", string[]? tenants = null)
    {
        var u = new UserRow { Id = "usr_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant(), Email = email.Trim().ToLowerInvariant(), Name = name.Trim(), Role = role, Status = status, Source = source, MustChange = mustChange, Created = UserRow.Now(), RoleFrom = roleFrom };
        u.PassHash = string.IsNullOrEmpty(password) ? null : HashPassword(password);
        u.TenantsJson = tenants is null ? null : JsonSerializer.Serialize(tenants);
        db.Exec("INSERT INTO users(id,email,name,role,status,source,pass_hash,must_change,created,role_from,tenants) VALUES($i,$e,$n,$r,$s,$o,$p,$m,$c,$f,$t)",
            ("$i", u.Id), ("$e", u.Email), ("$n", u.Name), ("$r", u.Role), ("$s", u.Status), ("$o", u.Source), ("$p", u.PassHash), ("$m", u.MustChange ? 1 : 0), ("$c", u.Created), ("$f", u.RoleFrom), ("$t", u.TenantsJson));
        return u;
    }
    /** tenants: null leaves it alone, "all" gives every tenant, otherwise a JSON list of tenant ids. */
    public void Update(string id, string? name = null, string? role = null, string? status = null, string? roleFrom = null, string? tenants = null)
    {
        if (tenants is not null) db.Exec("UPDATE users SET tenants=$v WHERE id=$i", ("$v", tenants == "all" ? null : tenants), ("$i", id));
        if (name is not null) db.Exec("UPDATE users SET name=$v WHERE id=$i", ("$v", name.Trim()), ("$i", id));
        if (role is not null) db.Exec("UPDATE users SET role=$v WHERE id=$i", ("$v", role), ("$i", id));
        if (status is not null) { db.Exec("UPDATE users SET status=$v WHERE id=$i", ("$v", status), ("$i", id)); if (status != "active") RevokeAll(id); }
        if (roleFrom is not null) db.Exec("UPDATE users SET role_from=$v WHERE id=$i", ("$v", roleFrom), ("$i", id));
    }
    public void Delete(string id) => db.Exec("DELETE FROM users WHERE id=$i", ("$i", id));

    /* ---------- passwords ---------- */
    public static string HashPassword(string pw)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pw), salt, Iter, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2${Iter}${Convert.ToBase64String(salt)}${Convert.ToBase64String(h)}";
    }
    static readonly string Dummy = HashPassword("not-a-real-password-for-timing");
    public static bool VerifyPassword(string? stored, string pw)
    {
        var s = stored ?? Dummy; // the same work happens whether or not the account exists
        var p = s.Split('$');
        if (p.Length != 4 || p[0] != "pbkdf2" || !int.TryParse(p[1], out var it)) return false;
        var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pw), Convert.FromBase64String(p[2]), it, HashAlgorithmName.SHA256, 32);
        var ok = CryptographicOperations.FixedTimeEquals(h, Convert.FromBase64String(p[3]));
        return ok && stored is not null;
    }
    public void SetPassword(string id, string pw, bool mustChange)
    {
        db.Exec("UPDATE users SET pass_hash=$p, must_change=$m, failed=0, locked_until=0 WHERE id=$i", ("$p", HashPassword(pw)), ("$m", mustChange ? 1 : 0), ("$i", id));
    }

    /** Throttles by address: 60 attempts in 10 minutes. */
    long lastSweep;
    public bool IpAllowed(string ip)
    {
        var now = UserRow.Now();
        // Once a minute, forget addresses that have not tried anything for ten minutes (otherwise the table only ever grows).
        if (now - Interlocked.Read(ref lastSweep) > 60 && Interlocked.Exchange(ref lastSweep, now) != now)
            foreach (var kv in ipHits) { lock (kv.Value) { if (kv.Value.Count == 0 || kv.Value.Peek() < now - 600 && kv.Value.All(t => t < now - 600)) ipHits.TryRemove(kv.Key, out _); } }
        var q = ipHits.GetOrAdd(ip, _ => new Queue<long>());
        lock (q)
        {
            while (q.Count > 0 && q.Peek() < now - 600) q.Dequeue();
            if (q.Count >= 60) return false;
            q.Enqueue(now); return true;
        }
    }

    public enum Check { Ok, Bad, Locked, Disabled, Pending, NoPassword }
    /** Checks an email and password, counting wrong tries and locking the account after a few. */
    public (Check Result, UserRow? User, long WaitSeconds) CheckLogin(string email, string pw)
    {
        var u = ByEmail(email);
        var now = UserRow.Now();
        if (u is not null && u.LockedUntil > now) { VerifyPassword(null, pw); return (Check.Locked, u, u.LockedUntil - now); }
        var ok = VerifyPassword(u?.PassHash, pw);
        if (u is null) return (Check.Bad, null, 0);
        if (!ok)
        {
            var failed = u.Failed + 1;
            if (failed >= LockAfter) { db.Exec("UPDATE users SET failed=0, locked_until=$l WHERE id=$i", ("$l", now + LockSeconds), ("$i", u.Id)); Audit(u.Email, "locked", "Locked for 5 minutes after wrong passwords"); }
            else db.Exec("UPDATE users SET failed=$f WHERE id=$i", ("$f", failed), ("$i", u.Id));
            return (Check.Bad, u, 0);
        }
        if (u.Status == "pending") return (Check.Pending, u, 0);
        if (u.Status != "active") return (Check.Disabled, u, 0);
        return (Check.Ok, u, 0);
    }
    public void CountFailure(UserRow u)
    {
        var failed = u.Failed + 1;
        if (failed >= LockAfter) db.Exec("UPDATE users SET failed=0, locked_until=$l WHERE id=$i", ("$l", UserRow.Now() + LockSeconds), ("$i", u.Id));
        else db.Exec("UPDATE users SET failed=$f WHERE id=$i", ("$f", failed), ("$i", u.Id));
        u.Failed = failed;
    }

    /* ---------- sessions ---------- */
    static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public (string Token, long Expires) Issue(UserRow u, string ip, string agent)
    {
        var token = "cas_" + Cfg.ToB64u(RandomNumberGenerator.GetBytes(32));
        var hours = Math.Clamp(Policy().SessionHours, 1, 168);
        var exp = UserRow.Now() + hours * 3600L;
        db.Exec("INSERT INTO sessions(id,user_id,created,expires,ip,agent) VALUES($i,$u,$c,$e,$p,$a)", ("$i", Hash(token)), ("$u", u.Id), ("$c", UserRow.Now()), ("$e", exp), ("$p", ip), ("$a", agent.Length > 200 ? agent[..200] : agent));
        db.Exec("UPDATE users SET last_login=$t, failed=0, locked_until=0 WHERE id=$i", ("$t", UserRow.Now()), ("$i", u.Id));
        db.Exec("DELETE FROM sessions WHERE expires < $t", ("$t", UserRow.Now()));
        return (token, exp);
    }
    public Caller? Resolve(string token)
    {
        if (!token.StartsWith("cas_")) return null;
        var row = db.Rows($"SELECT u.id,u.email,u.name,u.role,u.status,u.tenants FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$i AND s.expires>$t",
            r => (Id: r.GetString(0), Email: r.GetString(1), Name: r.GetString(2), Role: r.GetString(3), Status: r.GetString(4), Tenants: r.IsDBNull(5) ? null : r.GetString(5)), ("$i", Hash(token)), ("$t", UserRow.Now())).FirstOrDefault();
        if (row.Id is null || row.Status != "active") return null;
        return new Caller(row.Email, row.Role, row.Id, ParseTenants(row.Tenants));
    }
    public void Revoke(string token) => db.Exec("DELETE FROM sessions WHERE id=$i", ("$i", Hash(token)));
    public void RevokeAll(string userId) => db.Exec("DELETE FROM sessions WHERE user_id=$i", ("$i", userId));
    public void RevokeAllExcept(string userId, string token) => db.Exec("DELETE FROM sessions WHERE user_id=$i AND id<>$k", ("$i", userId), ("$k", Hash(token)));
    /** The identity provider vouched for this address: drop what a sign-up form set, so only the provider can open the account. */
    public void AdoptBySso(string id)
    {
        db.Exec("UPDATE users SET source='sso', pass_hash=NULL, must_change=0, totp_secret=NULL, totp_enabled=0, totp_step=0, recovery=NULL, failed=0, locked_until=0 WHERE id=$i", ("$i", id));
        RevokeAll(id);
    }

    /* ---------- two-step codes (RFC 6238, SHA-1, 6 digits, 30 s: what Google and Microsoft Authenticator use) ---------- */
    const string B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    public static string NewSecret() => Base32(RandomNumberGenerator.GetBytes(20));
    public static string Base32(byte[] data)
    {
        var sb = new StringBuilder(); int bits = 0, val = 0;
        foreach (var b in data) { val = (val << 8) | b; bits += 8; while (bits >= 5) { sb.Append(B32[(val >> (bits - 5)) & 31]); bits -= 5; } val &= (1 << bits) - 1; }
        if (bits > 0) sb.Append(B32[(val << (5 - bits)) & 31]);
        return sb.ToString();
    }
    public static byte[] UnBase32(string s)
    {
        var o = new List<byte>(); int bits = 0, val = 0;
        foreach (var ch in s.ToUpperInvariant().Where(c => B32.Contains(c))) { val = (val << 5) | B32.IndexOf(ch); bits += 5; if (bits >= 8) { o.Add((byte)((val >> (bits - 8)) & 255)); bits -= 8; val &= (1 << bits) - 1; } }
        return o.ToArray();
    }
    public static string Code(byte[] secret, long step)
    {
        var msg = BitConverter.GetBytes(step); if (BitConverter.IsLittleEndian) Array.Reverse(msg);
        var h = HMACSHA1.HashData(secret, msg);
        var o = h[^1] & 15;
        var n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
        return (n % 1_000_000).ToString("D6");
    }
    /** The step number the code matches (this 30 s window or one either side), or -1. */
    public static long MatchCode(string secretB32, string code, long minStepExclusive = -1)
    {
        var c = new string(code.Where(char.IsDigit).ToArray());
        if (c.Length != 6) return -1;
        var s = UnBase32(secretB32); var t = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
        foreach (var d in new[] { 0L, -1L, 1L })
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(s, t + d)), Encoding.ASCII.GetBytes(c)) && t + d > minStepExclusive) return t + d;
        return -1;
    }
    public string Seal(string secret)
    {
        var nonce = RandomNumberGenerator.GetBytes(12); var data = Encoding.UTF8.GetBytes(secret);
        var ct = new byte[data.Length]; var tag = new byte[16];
        using (var g = new AesGcm(totpKey, 16)) g.Encrypt(nonce, data, ct, tag);
        return Convert.ToBase64String(nonce.Concat(tag).Concat(ct).ToArray());
    }
    public string Unseal(string sealedText)
    {
        var b = Convert.FromBase64String(sealedText);
        var pt = new byte[b.Length - 28];
        using (var g = new AesGcm(totpKey, 16)) g.Decrypt(b[..12], b[28..], b[12..28], pt);
        return Encoding.UTF8.GetString(pt);
    }
    public static string OtpUri(string app, string email, string secret) =>
        $"otpauth://totp/{Uri.EscapeDataString(app)}:{Uri.EscapeDataString(email)}?secret={secret}&issuer={Uri.EscapeDataString(app)}&algorithm=SHA1&digits=6&period=30";

    /** Checks a code (or a recovery code) for a person who has two-step on; a code only works once. */
    public bool VerifySecondStep(UserRow u, string code)
    {
        if (!u.TotpEnabled || u.TotpSecretEnc is null) return false;
        var step = MatchCode(Unseal(u.TotpSecretEnc), code, u.TotpStep);
        if (step >= 0) { db.Exec("UPDATE users SET totp_step=$s WHERE id=$i", ("$s", step), ("$i", u.Id)); u.TotpStep = step; return true; }
        // A recovery code: eight single-use codes are given when two-step is turned on.
        var norm = code.Trim().Replace("-", "").Replace(" ", "").ToLowerInvariant();
        if (norm.Length == 10 && u.RecoveryJson is not null && JsonNode.Parse(u.RecoveryJson) is JsonArray arr)
        {
            var h = Hash("rc:" + norm);
            var hit = arr.FirstOrDefault(x => x?.ToString() == h);
            if (hit is not null) { arr.Remove(hit); db.Exec("UPDATE users SET recovery=$r WHERE id=$i", ("$r", arr.ToJsonString()), ("$i", u.Id)); Audit(u.Email, "recovery-code", "A recovery code was used"); return true; }
        }
        return false;
    }
    public string[] EnableTotp(string userId, string secret, long step)
    {
        var codes = Enumerable.Range(0, 8).Select(_ => Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant()).ToArray();
        var hashes = new JsonArray(codes.Select(c => (JsonNode?)JsonValue.Create(Hash("rc:" + c))).ToArray());
        db.Exec("UPDATE users SET totp_secret=$s, totp_enabled=1, totp_step=$t, recovery=$r WHERE id=$i", ("$s", Seal(secret)), ("$t", step), ("$r", hashes.ToJsonString()), ("$i", userId));
        return codes.Select(c => c[..5] + "-" + c[5..]).ToArray();
    }
    public void DisableTotp(string userId) => db.Exec("UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_step=0, recovery=NULL WHERE id=$i", ("$i", userId));

    /* ---------- policy and sign-in providers (stored in settings) ---------- */
    public record PolicyData(string Signup, string TwoFactor, int SessionHours);
    public PolicyData Policy()
    {
        try
        {
            if (db.Setting("policy") is { } j && JsonNode.Parse(j) is JsonObject o)
            {
                var signup = o["signup"]?.ToString() ?? "approval"; var tf = o["twoFactor"]?.ToString() ?? "none";
                return new PolicyData(signup is "off" or "approval" or "open" ? signup : "approval", tf is "none" or "admins" or "everyone" ? tf : "none", o["sessionHours"]?.GetValue<int>() ?? 12);
            }
        }
        catch (Exception) { /* fall through to the defaults */ }
        return new PolicyData("approval", "none", 12);
    }
    public void SetPolicy(PolicyData p) => db.SetSetting("policy", JsonSerializer.Serialize(new { signup = p.Signup, twoFactor = p.TwoFactor, sessionHours = p.SessionHours }));
    public bool NeedsTwoStep(UserRow u) => Policy().TwoFactor == "everyone" || (Policy().TwoFactor == "admins" && Rank(u.Role) >= 4);

    public JsonArray Providers()
    {
        try { if (db.Setting("sso") is { } j && JsonNode.Parse(j) is JsonObject o && o["providers"] is JsonArray a) return a; } catch (Exception) { }
        return new JsonArray();
    }
    public void SetProviders(JsonArray a) => db.SetSetting("sso", new JsonObject { ["providers"] = a }.ToJsonString());

    public void Audit(string actor, string action, string detail = "") =>
        db.Exec("INSERT INTO audit(ts,actor,action,detail) VALUES($t,$a,$x,$d)", ("$t", UserRow.Now()), ("$a", actor), ("$x", action), ("$d", detail.Length > 500 ? detail[..500] : detail));
    public List<object> AuditLog(int n) => db.Rows("SELECT ts,actor,action,detail FROM audit ORDER BY id DESC LIMIT $n", r => (object)new { ts = r.GetInt64(0), actor = r.GetString(1), action = r.GetString(2), detail = r.GetString(3) }, ("$n", n));
}
