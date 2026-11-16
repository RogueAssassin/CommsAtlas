// Single sign-on: checks an OpenID Connect identity token (RS256 or ES256) against any configured provider
// (Microsoft Entra, Google, Okta, Auth0, Keycloak, authentik, OneLogin, Ping, JumpCloud, Cognito, or any other OIDC issuer)
// and works out the person's level from their groups.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

class OidcException(string m) : Exception(m);

record SsoResult(string Email, string Name, string? Role, bool FromGroup, string Why);

sealed class OidcValidator(IHttpClientFactory http)
{
    sealed record Cached(JsonObject Conf, JsonArray Keys, DateTimeOffset Fetched);
    readonly Dictionary<string, Cached> cache = new();
    readonly SemaphoreSlim gate = new(1, 1);

    static string S(JsonObject o, string k, string def = "") => o[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : def;
    public static bool Usable(JsonObject p) => p["enabled"]?.GetValue<bool>() != false && S(p, "issuer").StartsWith("https://", StringComparison.OrdinalIgnoreCase) && S(p, "clientId").Length > 0;

    async Task<Cached> Load(string issuer, bool force)
    {
        await gate.WaitAsync();
        try
        {
            if (!force && cache.TryGetValue(issuer, out var c) && DateTimeOffset.UtcNow - c.Fetched < TimeSpan.FromHours(6)) return c;
            var h = http.CreateClient(); h.Timeout = TimeSpan.FromSeconds(15);
            var conf = JsonNode.Parse(await h.GetStringAsync(issuer.TrimEnd('/') + "/.well-known/openid-configuration")) as JsonObject ?? throw new OidcException("The issuer's settings could not be read.");
            var jwks = JsonNode.Parse(await h.GetStringAsync(conf["jwks_uri"]!.GetValue<string>())) as JsonObject;
            var keys = jwks?["keys"] as JsonArray ?? throw new OidcException("The issuer lists no signing keys.");
            return cache[issuer] = new Cached(conf, keys, DateTimeOffset.UtcNow);
        }
        finally { gate.Release(); }
    }

    public async Task<SsoResult> Check(string jwt, JsonObject sso, string? nonce = null)
    {
        if (!Usable(sso)) throw new OidcException("That sign-in provider is not set up.");
        var parts = jwt.Split('.');
        if (parts.Length != 3) throw new OidcException("That is not an identity token.");
        JsonObject head, c;
        try { head = (JsonNode.Parse(Cfg.B64u(parts[0])) as JsonObject)!; c = (JsonNode.Parse(Cfg.B64u(parts[1])) as JsonObject)!; }
        catch (Exception) { throw new OidcException("The identity token could not be read."); }
        Cached cached;
        try { cached = await Load(S(sso, "issuer"), false); } catch (OidcException) { throw; } catch (Exception e) { throw new OidcException("Could not reach the sign-in provider: " + e.Message); }
        var kid = head["kid"]?.GetValue<string>();
        var alg = head["alg"]?.GetValue<string>() ?? "";
        var key = cached.Keys.OfType<JsonObject>().FirstOrDefault(k => k["kid"]?.GetValue<string>() == kid);
        if (key is null) { cached = await Load(S(sso, "issuer"), true); key = cached.Keys.OfType<JsonObject>().FirstOrDefault(k => k["kid"]?.GetValue<string>() == kid); }
        if (key is null) throw new OidcException("The token was signed with a key the provider doesn't list.");
        var data = Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]);
        var sig = Cfg.B64u(parts[2]);
        bool ok;
        if (alg == "RS256")
        {
            using var rsa = RSA.Create(new RSAParameters { Modulus = Cfg.B64u(key["n"]!.GetValue<string>()), Exponent = Cfg.B64u(key["e"]!.GetValue<string>()) });
            ok = rsa.VerifyData(data, sig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        else if (alg == "ES256")
        {
            using var ec = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = Cfg.B64u(key["x"]!.GetValue<string>()), Y = Cfg.B64u(key["y"]!.GetValue<string>()) } });
            ok = ec.VerifyData(data, sig, HashAlgorithmName.SHA256);
        }
        else throw new OidcException("Tokens signed with " + alg + " are not accepted.");
        if (!ok) throw new OidcException("The token's signature is not valid.");

        var tid = c["tid"]?.ToString() ?? "";
        var iss = cached.Conf["issuer"]!.GetValue<string>().Replace("{tenantid}", tid);
        if (c["iss"]?.ToString() != iss) throw new OidcException("The token came from an unexpected issuer.");
        // Microsoft's shared addresses (common, organizations, consumers) accept people from any organisation, and an organisation sets its own users' email claim.
        // Use the address with your own directory (tenant) ID in it, so only that directory can sign in.
        if (cached.Conf["issuer"]!.GetValue<string>().Contains("{tenantid}") && !S(sso, "issuer").Contains(tid, StringComparison.OrdinalIgnoreCase))
            throw new OidcException("This Microsoft sign-in must use your own directory (tenant) ID in the issuer address, not common or organizations.");
        List<string?> aud = c["aud"] is JsonArray a ? a.Select(x => x?.ToString()).ToList() : new List<string?> { c["aud"]?.ToString() };
        if (!aud.Contains(S(sso, "clientId"))) throw new OidcException("The token was meant for a different app.");
        if (string.IsNullOrEmpty(nonce) || c["nonce"]?.ToString() != nonce) throw new OidcException("The sign-in reply did not match this sign-in. Try again.");
        var exp = c["exp"]?.GetValue<long>() ?? 0;
        if (exp < DateTimeOffset.UtcNow.AddMinutes(-2).ToUnixTimeSeconds()) throw new OidcException("The sign-in has expired. Sign in again.");
        if (c["email_verified"] is JsonValue ev && ev.TryGetValue<bool>(out var verified) && !verified) throw new OidcException("The provider says this email address is not verified.");

        var email = (c["email"] ?? c["preferred_username"] ?? c["upn"])?.ToString().Trim().ToLowerInvariant() ?? "";
        if (!Accounts.ValidEmail(email)) throw new OidcException("The provider did not share an email address. Add the \"email\" scope.");
        var doms = Regex.Split(S(sso, "domains"), @"[\s,;]+").Select(x => x.Trim().TrimStart('@').ToLowerInvariant()).Where(x => x.Length > 0).ToList();
        if (doms.Count > 0 && !doms.Contains(email.Split('@')[1])) throw new OidcException(email + " is not from an allowed email domain.");

        // Groups and app roles from the token → the highest level they map to.
        var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var claim in new[] { S(sso, "groupClaim", "groups"), "groups", "roles" }.Distinct())
        {
            if (c[claim] is JsonArray arr) foreach (var g in arr) { if (g is not null) have.Add(g.ToString()); }
            else if (c[claim] is JsonValue one) have.Add(one.ToString());
        }
        string? best = null; var why = "";
        List<string> supers = sso["superAdmins"] switch
        {
            JsonArray sa => sa.Select(x => x?.ToString().ToLowerInvariant() ?? "").ToList(),
            JsonValue sv => Regex.Split(sv.ToString(), @"[\s,;]+").Select(x => x.ToLowerInvariant()).ToList(),
            _ => new List<string>(),
        };
        if (supers.Contains(email)) { best = "super_admin"; why = "the Super Admin list"; }
        if (sso["groupRoles"] is JsonArray rules)
            foreach (var r in rules.OfType<JsonObject>())
            {
                var g = r["group"]?.ToString(); var role = r["role"]?.ToString() ?? "";
                if (g is not null && have.Contains(g) && Accounts.Rank(role) > Accounts.Rank(best ?? "")) { best = role; why = "group " + g; }
            }
        var fromGroup = best is not null;
        if (best is null)
        {
            var hasRules = sso["groupRoles"] is JsonArray ra && ra.Count > 0;
            if (hasRules && sso["requireGroup"] is JsonValue rg && rg.TryGetValue<bool>(out var req) && req) throw new OidcException(email + " is not in a group that is allowed in.");
        }
        var name = c["name"]?.ToString() ?? "";
        return new SsoResult(email, name.Length > 0 ? name : email.Split('@')[0], best, fromGroup, why);
    }
}
