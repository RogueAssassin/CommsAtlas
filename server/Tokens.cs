// Signs short-lived tickets (for the steps of signing in) with a key kept in data/secret.key.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

class TokenService
{
    readonly byte[] secret;
    public TokenService(string file)
    {
        if (File.Exists(file)) secret = Convert.FromBase64String(File.ReadAllText(file).Trim());
        else
        {
            secret = RandomNumberGenerator.GetBytes(32);
            File.WriteAllText(file, Convert.ToBase64String(secret));
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }
    /** A separate key for one purpose (such as encrypting connector keys), derived from the secret. */
    public byte[] Derive(string purpose) => HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(purpose));

    public string Sign(string purpose, JsonObject payload, TimeSpan life)
    {
        var o = (JsonObject)payload.DeepClone(); o["p"] = purpose; o["x"] = DateTimeOffset.UtcNow.Add(life).ToUnixTimeSeconds();
        var body = Cfg.ToB64u(Encoding.UTF8.GetBytes(o.ToJsonString()));
        return "t1." + body + "." + Cfg.ToB64u(HMACSHA256.HashData(secret, Encoding.ASCII.GetBytes(body)));
    }
    public JsonObject? Unsign(string token, string purpose)
    {
        var p = token.Split('.');
        if (p.Length != 3 || p[0] != "t1") return null;
        try
        {
            var want = HMACSHA256.HashData(secret, Encoding.ASCII.GetBytes(p[1]));
            if (!CryptographicOperations.FixedTimeEquals(want, Cfg.B64u(p[2]))) return null;
            var o = JsonNode.Parse(Cfg.B64u(p[1])) as JsonObject;
            if (o is null || o["p"]?.GetValue<string>() != purpose || (o["x"]?.GetValue<long>() ?? 0) < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
            return o;
        }
        catch (Exception) { return null; }
    }
}
