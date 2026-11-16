// Sign-in, sign-up, two-step codes, single sign-on and the people/settings admin API.
using System.Text.Json.Nodes;

static class AuthApi
{
    static IResult Err(string msg, int code = 400) => Results.Json(new { error = msg }, statusCode: code);
    static async Task<JsonObject?> Body(HttpContext ctx)
    {
        try { return await JsonNode.ParseAsync(ctx.Request.Body) as JsonObject; } catch (System.Text.Json.JsonException) { return null; }
    }
    static string Str(JsonObject? o, string k) => o?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    /** The tenant ids in a list from the browser (callers drop any that do not exist). */
    static string[] TenantIds(JsonNode list) => list is JsonArray a ? a.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).Distinct().ToArray() : [];
    static string Ip(HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "";
    static string Agent(HttpContext c) => c.Request.Headers.UserAgent.ToString();

    public static void Map(WebApplication app, Accounts acc, TokenService tokens, OidcValidator oidc, WorkspaceStore store, Db db, string appName, string build)
    {
        Caller? Who(HttpContext ctx)
        {
            var h = ctx.Request.Headers.Authorization.ToString();
            return h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? acc.Resolve(h[7..].Trim()) : null;
        }
        IResult? Need(HttpContext ctx, int rank, out Caller? who)
        {
            who = Who(ctx);
            if (who is null) return Err("Sign in first.", 401);
            return Accounts.Rank(who.Role) < rank ? Err("Your level can not do that.", 403) : null;
        }
        object SessionFor(UserRow u, HttpContext ctx, string[]? recovery = null)
        {
            var (token, exp) = acc.Issue(u, Ip(ctx), Agent(ctx));
            acc.Audit(u.Email, "sign-in", "Signed in" + (u.Source == "sso" ? " with single sign-on" : ""));
            return new { token, expires = exp, user = u.Public(), recovery };
        }
        /** After the password (or after a step): what comes next, or the session. */
        object Next(UserRow u, HttpContext ctx)
        {
            if (u.MustChange) return new { step = "password", ticket = tokens.Sign("step", new JsonObject { ["uid"] = u.Id, ["need"] = "password" }, TimeSpan.FromMinutes(10)) };
            if (u.TotpEnabled) return new { step = "code", ticket = tokens.Sign("step", new JsonObject { ["uid"] = u.Id, ["need"] = "code" }, TimeSpan.FromMinutes(5)) };
            if (acc.NeedsTwoStep(u))
            {
                var secret = Accounts.NewSecret();
                return new { step = "enrol", secret, uri = Accounts.OtpUri(appName, u.Email, secret), ticket = tokens.Sign("step", new JsonObject { ["uid"] = u.Id, ["need"] = "enrol", ["secret"] = secret }, TimeSpan.FromMinutes(10)) };
            }
            return SessionFor(u, ctx);
        }

        /* ---------- public ---------- */
        app.MapGet("/api/v1/auth/state", () =>
        {
            var p = acc.Policy();
            var providers = acc.Providers().OfType<JsonObject>().Where(OidcValidator.Usable).Select(x => new
            {
                id = Str(x, "id"), name = Str(x, "name"), preset = Str(x, "preset"), issuer = Str(x, "issuer"), clientId = Str(x, "clientId"),
                scopes = Str(x, "scopes") is { Length: > 0 } s ? s : "openid profile email", flow = Str(x, "flow") == "id_token" ? "id_token" : "code",
            });
            return Results.Json(new { app = appName, build, setup = !acc.AnyUsers(), signup = p.Signup, twoFactor = p.TwoFactor, providers });
        });

        app.MapPost("/api/v1/auth/setup", async (HttpContext ctx) =>
        {
            if (acc.AnyUsers()) return Err("Setup is finished. Sign in instead.", 409);
            if (!acc.IpAllowed(Ip(ctx))) return Err("Too many tries. Wait a few minutes.", 429);
            var b = await Body(ctx);
            var email = Str(b, "email").Trim().ToLowerInvariant(); var name = Str(b, "name").Trim(); var pw = Str(b, "password");
            if (!Accounts.ValidEmail(email)) return Err("Enter a valid email address.");
            if (name.Length == 0) return Err("Enter your name.");
            if (Accounts.PasswordProblem(pw, email) is { } pm) return Err(pm);
            var u = acc.Create(email, name, "super_admin", pw);
            acc.Audit(u.Email, "setup", "First Super Admin created");
            return Results.Json(SessionFor(u, ctx));
        });

        app.MapPost("/api/v1/auth/login", async (HttpContext ctx) =>
        {
            if (!acc.IpAllowed(Ip(ctx))) return Err("Too many tries. Wait a few minutes.", 429);
            var b = await Body(ctx);
            var (res, u, wait) = acc.CheckLogin(Str(b, "email"), Str(b, "password"));
            switch (res)
            {
                case Accounts.Check.Locked: return Err($"Too many wrong tries. Try again in {Math.Max(1, (wait + 59) / 60)} minute(s).", 429);
                case Accounts.Check.Pending: return Err("Your account is waiting for an Admin to approve it.", 403);
                case Accounts.Check.Disabled: return Err("This account is switched off. Ask an Admin.", 403);
                case Accounts.Check.Ok: return Results.Json(Next(u!, ctx));
                default: return Err("That email and password do not match an account.", 401);
            }
        });

        app.MapPost("/api/v1/auth/step", async (HttpContext ctx) =>
        {
            if (!acc.IpAllowed(Ip(ctx))) return Err("Too many tries. Wait a few minutes.", 429);
            var b = await Body(ctx);
            var t = tokens.Unsign(Str(b, "ticket"), "step");
            if (t is null) return Err("That sign-in step has expired. Start again.", 401);
            var u = acc.ById(t["uid"]!.GetValue<string>());
            if (u is null || u.Status != "active") return Err("This account is not available.", 403);
            if (u.LockedUntil > UserRow.Now()) return Err("Too many wrong tries. Try again in a few minutes.", 429);
            switch (t["need"]?.GetValue<string>())
            {
                case "password":
                    {
                        var pw = Str(b, "newPassword");
                        if (Accounts.PasswordProblem(pw, u.Email) is { } pm) return Err(pm);
                        if (Accounts.VerifyPassword(u.PassHash, pw)) return Err("Choose a password that is different from the one you were given.");
                        acc.SetPassword(u.Id, pw, false); u.MustChange = false;
                        acc.Audit(u.Email, "password", "Chose a new password");
                        return Results.Json(Next(u, ctx));
                    }
                case "code":
                    if (!acc.VerifySecondStep(u, Str(b, "code"))) { acc.CountFailure(u); return Err("That code is not right. Codes change every 30 seconds.", 401); }
                    return Results.Json(SessionFor(u, ctx));
                case "enrol":
                    {
                        var secret = t["secret"]!.GetValue<string>();
                        var step = Accounts.MatchCode(secret, Str(b, "code"));
                        if (step < 0) { acc.CountFailure(u); return Err("That code is not right. Check the key was added exactly.", 401); }
                        var recovery = acc.EnableTotp(u.Id, secret, step);
                        acc.Audit(u.Email, "2fa-on", "Turned on two-step sign-in");
                        return Results.Json(SessionFor(u, ctx, recovery));
                    }
            }
            return Err("Unknown step.");
        });

        app.MapPost("/api/v1/auth/signup", async (HttpContext ctx) =>
        {
            var p = acc.Policy();
            if (!acc.AnyUsers()) return Err("Finish first-time setup first.", 409);
            if (p.Signup == "off") return Err("Sign-up is switched off. Ask an Admin for an account.", 403);
            if (!acc.IpAllowed(Ip(ctx))) return Err("Too many tries. Wait a few minutes.", 429);
            var b = await Body(ctx);
            var email = Str(b, "email").Trim().ToLowerInvariant(); var name = Str(b, "name").Trim(); var pw = Str(b, "password");
            if (!Accounts.ValidEmail(email)) return Err("Enter a valid email address.");
            if (name.Length == 0) return Err("Enter your name.");
            if (Accounts.PasswordProblem(pw, email) is { } pm) return Err(pm);
            if (acc.ByEmail(email) is not null) return Err("There is already an account for that email address. Sign in instead.", 409);
            var status = p.Signup == "open" ? "active" : "pending";
            var u = acc.Create(email, name, "viewer", pw, status, "signup"); // nobody has proved they own this address
            acc.Audit(u.Email, "sign-up", status == "pending" ? "Waiting for approval" : "Account opened");
            return Results.Json(new { status, message = status == "pending" ? "Thanks. An Admin needs to approve your account before you can sign in." : "Your account is ready. Sign in." });
        });

        app.MapPost("/api/v1/auth/sso", async (HttpContext ctx) =>
        {
            if (!acc.IpAllowed(Ip(ctx))) return Err("Too many tries. Wait a few minutes.", 429);
            var b = await Body(ctx);
            var id = Str(b, "provider"); var idt = Str(b, "id_token");
            var prov = acc.Providers().OfType<JsonObject>().FirstOrDefault(x => Str(x, "id") == id);
            if (prov is null || idt.Length == 0) return Err("Choose a sign-in provider.");
            if (!acc.AnyUsers()) return Err("Finish first-time setup (create the first Super Admin) before using single sign-on.", 409);
            SsoResult who;
            try { who = await oidc.Check(idt, prov, Str(b, "nonce")); } catch (OidcException e) { return Err(e.Message, 401); }
            var fallback = Str(prov, "defaultRole") is "technician" or "editor" ? Str(prov, "defaultRole") : "viewer";
            var u = acc.ByEmail(who.Email);
            if (u is null)
            {
                if (prov["autoCreate"]?.GetValue<bool>() == false && !who.FromGroup) return Err("There is no account for " + who.Email + ". Ask an Admin to add you.", 403);
                var role = who.Role ?? fallback;
                u = acc.Create(who.Email, who.Name, role, null, "active", "sso", false, who.FromGroup ? "group" : "default");
                acc.Audit(u.Email, "sso-account", "Account made on first sign-in as " + role + (who.FromGroup ? " from " + who.Why : ""));
            }
            else
            {
                if (u.Status == "pending") return Err("Your account is waiting for an Admin to approve it.", 403);
                if (u.Status != "active") return Err("This account is switched off. Ask an Admin.", 403);
                // A self-signed-up account may have been made by someone who does not own the address: the provider has now proved who does,
                // so the password and any two-step setup chosen at sign-up are dropped and every earlier session ends.
                if (u.Source == "signup") { acc.AdoptBySso(u.Id); u.Source = "sso"; u.PassHash = null; }
                // The provider's groups decide the level at every sign-in, but a local Super Admin is never lowered by them.
                var next = who.Role ?? (u.RoleFrom == "group" ? fallback : u.Role);
                var keep = u.PassHash is not null && u.Role == "super_admin" && Accounts.Rank(next) < Accounts.Rank(u.Role);
                if (next != u.Role && !keep) { acc.Audit(u.Email, "role", $"Now {next} ({(who.FromGroup ? who.Why : "no matching group")})"); acc.Update(u.Id, role: next); u.Role = next; }
                if (who.FromGroup) acc.Update(u.Id, roleFrom: "group");
                if (u.Name.Length == 0) acc.Update(u.Id, name: who.Name);
            }
            return Results.Json(SessionFor(u, ctx));
        });

        /* ---------- signed in ---------- */
        app.MapGet("/api/v1/auth/me", (HttpContext ctx) =>
        {
            if (Need(ctx, 1, out var who) is { } d) return d;
            var u = acc.ById(who!.Id);
            return u is null ? Err("Sign in first.", 401) : Results.Json(new { user = u.Public(), policy = acc.Policy().TwoFactor });
        });
        app.MapPost("/api/v1/auth/logout", (HttpContext ctx) =>
        {
            var h = ctx.Request.Headers.Authorization.ToString();
            if (h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) acc.Revoke(h[7..].Trim());
            return Results.Json(new { ok = true });
        });
        app.MapPost("/api/v1/auth/password", async (HttpContext ctx) =>
        {
            if (Need(ctx, 1, out var who) is { } d) return d;
            var b = await Body(ctx); var u = acc.ById(who!.Id)!;
            if (u.PassHash is not null && !Accounts.VerifyPassword(u.PassHash, Str(b, "current"))) return Err("Your current password is not right.", 403);
            var pw = Str(b, "newPassword");
            if (Accounts.PasswordProblem(pw, u.Email) is { } pm) return Err(pm);
            acc.SetPassword(u.Id, pw, false);
            // Every other session ends; this one carries on.
            var keep = ctx.Request.Headers.Authorization.ToString(); acc.RevokeAllExcept(u.Id, keep.Length > 7 ? keep[7..].Trim() : "");
            acc.Audit(u.Email, "password", "Changed their password");
            return Results.Json(new { ok = true });
        });
        app.MapPost("/api/v1/auth/2fa/begin", (HttpContext ctx) =>
        {
            if (Need(ctx, 1, out var who) is { } d) return d;
            var secret = Accounts.NewSecret();
            return Results.Json(new { secret, uri = Accounts.OtpUri(appName, who!.Name, secret) });
        });
        app.MapPost("/api/v1/auth/2fa/enable", async (HttpContext ctx) =>
        {
            if (Need(ctx, 1, out var who) is { } d) return d;
            var b = await Body(ctx); var secret = Str(b, "secret");
            var step = secret.Length >= 16 ? Accounts.MatchCode(secret, Str(b, "code")) : -1;
            if (step < 0) return Err("That code is not right. Check the key was added exactly.", 400);
            var recovery = acc.EnableTotp(who!.Id, secret, step);
            acc.Audit(who.Name, "2fa-on", "Turned on two-step sign-in");
            return Results.Json(new { recovery });
        });
        app.MapPost("/api/v1/auth/2fa/disable", async (HttpContext ctx) =>
        {
            if (Need(ctx, 1, out var who) is { } d) return d;
            var b = await Body(ctx); var u = acc.ById(who!.Id)!;
            if (acc.NeedsTwoStep(u)) return Err("Your organisation requires two-step sign-in, so it can not be turned off.", 403);
            if (u.PassHash is not null && !Accounts.VerifyPassword(u.PassHash, Str(b, "password"))) return Err("Your password is not right.", 403);
            acc.DisableTotp(u.Id); acc.Audit(u.Email, "2fa-off", "Turned off two-step sign-in");
            return Results.Json(new { ok = true });
        });

        /* ---------- people (Admins) ---------- */
        bool MayManage(Caller who, UserRow target) => Accounts.Rank(who.Role) == 5 || Accounts.Rank(target.Role) <= 4;
        app.MapGet("/api/v1/users", (HttpContext ctx) =>
        {
            if (Need(ctx, 4, out _) is { } d) return d;
            return Results.Json(new { users = acc.All().Select(u => u.Public()) });
        });
        app.MapPost("/api/v1/users", async (HttpContext ctx) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var b = await Body(ctx);
            var email = Str(b, "email").Trim().ToLowerInvariant(); var name = Str(b, "name").Trim(); var role = Str(b, "role"); var pw = Str(b, "password");
            if (!Accounts.ValidEmail(email)) return Err("Enter a valid email address.");
            if (!Accounts.Levels.Contains(role)) return Err("Choose a level.");
            if (Accounts.Rank(role) > Accounts.Rank(who!.Role)) return Err("You can not give a level above your own.", 403);
            if (acc.ByEmail(email) is not null) return Err("There is already an account for that email address.", 409);
            var generated = pw.Length == 0;
            if (generated) pw = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(12)).Replace('+', 'x').Replace('/', 'y').TrimEnd('=') + "7";
            if (Accounts.PasswordProblem(pw, email) is { } pm) return Err(pm);
            var u = acc.Create(email, name.Length > 0 ? name : email.Split('@')[0], role, pw, "active", "local", true, "", b?["tenants"] is JsonArray ? TenantIds(b!["tenants"]!).Where(store.Exists).ToArray() : null);
            acc.Audit(who.Name, "user-add", $"Added {email} as {role}");
            return Results.Json(new { user = u.Public(), temporaryPassword = pw });
        });
        app.MapPatch("/api/v1/users/{id}", async (HttpContext ctx, string id) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var u = acc.ById(id); if (u is null) return Err("No such person.", 404);
            if (!MayManage(who!, u)) return Err("Only a Super Admin can change a Super Admin.", 403);
            var b = await Body(ctx); var role = Str(b, "role"); var status = Str(b, "status"); var name = Str(b, "name");
            if (role.Length > 0)
            {
                if (!Accounts.Levels.Contains(role)) return Err("Choose a level.");
                if (Accounts.Rank(role) > Accounts.Rank(who!.Role)) return Err("You can not give a level above your own.", 403);
                if (u.Id == who.Id && role != u.Role) return Err("You can not change your own level.", 403);
                if (u.Role == "super_admin" && role != "super_admin" && acc.ActiveSuperAdmins() <= 1) return Err("There must be at least one Super Admin.", 409);
            }
            if (status.Length > 0)
            {
                if (status is not ("active" or "disabled")) return Err("Status must be active or disabled.");
                if (u.Id == who!.Id && status != "active") return Err("You can not switch off your own account.", 403);
                if (u.Role == "super_admin" && status != "active" && acc.ActiveSuperAdmins() <= 1) return Err("There must be at least one Super Admin.", 409);
            }
            string? tenantsSet = b?["tenants"] is JsonArray ta ? System.Text.Json.JsonSerializer.Serialize(TenantIds(ta).Where(store.Exists).ToArray()) : Str(b, "tenants") == "all" ? "all" : null;
            acc.Update(id, name: name.Length > 0 ? name : null, role: role.Length > 0 ? role : null, status: status.Length > 0 ? status : null, roleFrom: role.Length > 0 && role != u.Role ? "manual" : null, tenants: tenantsSet);
            if (tenantsSet is not null) { acc.RevokeAll(id); acc.Audit(who!.Name, "user-tenants", $"{u.Email}: {(tenantsSet == "all" ? "all tenants" : tenantsSet)}"); }
            if (role.Length > 0 && role != u.Role) acc.RevokeAll(id);
            acc.Audit(who!.Name, "user-edit", $"{u.Email}: " + string.Join(", ", new[] { role.Length > 0 ? "level " + role : "", status.Length > 0 ? "status " + status : "", name.Length > 0 ? "name" : "" }.Where(x => x.Length > 0)));
            return Results.Json(new { user = acc.ById(id)!.Public() });
        });
        app.MapPost("/api/v1/users/{id}/approve", async (HttpContext ctx, string id) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var u = acc.ById(id); if (u is null) return Err("No such person.", 404);
            if (u.Status != "pending") return Err("Only people waiting for approval can be approved.", 409);
            if (!MayManage(who!, u)) return Err("Only a Super Admin can change a Super Admin.", 403);
            var role = Str(await Body(ctx), "role"); if (role.Length == 0) role = "viewer";
            if (!Accounts.Levels.Contains(role) || Accounts.Rank(role) > Accounts.Rank(who!.Role)) return Err("Choose a level you are allowed to give.", 403);
            acc.Update(id, role: role, status: "active", roleFrom: "manual");
            acc.Audit(who.Name, "user-approve", $"Approved {u.Email} as {role}");
            return Results.Json(new { user = acc.ById(id)!.Public() });
        });
        app.MapPost("/api/v1/users/{id}/reset-2fa", (HttpContext ctx, string id) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var u = acc.ById(id); if (u is null) return Err("No such person.", 404);
            if (!MayManage(who!, u)) return Err("Only a Super Admin can change a Super Admin.", 403);
            acc.DisableTotp(id); acc.RevokeAll(id); acc.Audit(who!.Name, "2fa-reset", u.Email);
            return Results.Json(new { ok = true });
        });
        app.MapPost("/api/v1/users/{id}/password", async (HttpContext ctx, string id) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var u = acc.ById(id); if (u is null) return Err("No such person.", 404);
            if (!MayManage(who!, u)) return Err("Only a Super Admin can change a Super Admin.", 403);
            var pw = Str(await Body(ctx), "password");
            if (Accounts.PasswordProblem(pw, u.Email) is { } pm) return Err(pm);
            acc.SetPassword(id, pw, true); acc.RevokeAll(id); acc.Audit(who!.Name, "password-reset", u.Email);
            return Results.Json(new { ok = true });
        });
        app.MapDelete("/api/v1/users/{id}", (HttpContext ctx, string id) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            var u = acc.ById(id); if (u is null) return Err("No such person.", 404);
            if (!MayManage(who!, u)) return Err("Only a Super Admin can remove a Super Admin.", 403);
            if (u.Id == who!.Id) return Err("You can not remove your own account.", 403);
            if (u.Role == "super_admin" && acc.ActiveSuperAdmins() <= 1) return Err("There must be at least one Super Admin.", 409);
            acc.Delete(id); acc.Audit(who.Name, "user-remove", u.Email);
            return Results.Json(new { deleted = id });
        });

        /* ---------- settings (Super Admins) ---------- */
        app.MapGet("/api/v1/settings", (HttpContext ctx) =>
        {
            if (Need(ctx, 5, out _) is { } d) return d;
            var p = acc.Policy();
            return Results.Json(new { policy = new { signup = p.Signup, twoFactor = p.TwoFactor, sessionHours = p.SessionHours }, providers = acc.Providers() });
        });
        app.MapPut("/api/v1/settings/policy", async (HttpContext ctx) =>
        {
            if (Need(ctx, 5, out var who) is { } d) return d;
            var b = await Body(ctx);
            var signup = Str(b, "signup"); var tf = Str(b, "twoFactor"); var hours = b?["sessionHours"]?.GetValue<int>() ?? 12;
            if (signup is not ("off" or "approval" or "open") || tf is not ("none" or "admins" or "everyone")) return Err("Unknown setting.");
            acc.SetPolicy(new Accounts.PolicyData(signup, tf, Math.Clamp(hours, 1, 168)));
            acc.Audit(who!.Name, "policy", $"Sign-up {signup}, two-step {tf}, sessions {hours} h");
            return Results.Json(new { ok = true });
        });
        app.MapPut("/api/v1/settings/sso", async (HttpContext ctx) =>
        {
            if (Need(ctx, 5, out var who) is { } d) return d;
            var b = await Body(ctx);
            if (b?["providers"] is not JsonArray list) return Err("Send { providers: [...] }.");
            var clean = new JsonArray();
            foreach (var x in list.OfType<JsonObject>())
            {
                var issuer = Str(x, "issuer").Trim(); var client = Str(x, "clientId").Trim();
                if (!issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return Err("The issuer for " + Str(x, "name") + " must be an https:// address.");
                if (client.Length == 0) return Err("Enter the client ID for " + Str(x, "name") + ".");
                var id = Str(x, "id"); if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-z0-9_-]{1,32}$")) id = "p" + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
                var rules = new JsonArray();
                if (x["groupRoles"] is JsonArray gr) foreach (var g in gr.OfType<JsonObject>()) if (Str(g, "group").Length > 0 && Accounts.Levels.Contains(Str(g, "role"))) rules.Add(new JsonObject { ["group"] = Str(g, "group").Trim(), ["role"] = Str(g, "role") });
                clean.Add(new JsonObject
                {
                    ["id"] = id, ["preset"] = Str(x, "preset"), ["name"] = Str(x, "name").Length > 0 ? Str(x, "name") : "single sign-on", ["enabled"] = x["enabled"]?.GetValue<bool>() != false,
                    ["issuer"] = issuer, ["clientId"] = client, ["scopes"] = Str(x, "scopes").Length > 0 ? Str(x, "scopes") : "openid profile email",
                    ["flow"] = Str(x, "flow") == "id_token" ? "id_token" : "code", ["domains"] = Str(x, "domains"), ["groupClaim"] = Str(x, "groupClaim").Length > 0 ? Str(x, "groupClaim") : "groups",
                    ["groupRoles"] = rules, ["superAdmins"] = Str(x, "superAdmins"), ["defaultRole"] = Str(x, "defaultRole") is "technician" or "editor" ? Str(x, "defaultRole") : "viewer",
                    ["requireGroup"] = x["requireGroup"]?.GetValue<bool>() == true, ["autoCreate"] = x["autoCreate"]?.GetValue<bool>() != false,
                });
            }
            acc.SetProviders(clean); acc.Audit(who!.Name, "sso", clean.Count + " provider(s) saved");
            return Results.Json(new { providers = clean });
        });
        app.MapGet("/api/v1/audit", (HttpContext ctx) =>
        {
            if (Need(ctx, 4, out _) is { } d) return d;
            return Results.Json(new { events = acc.AuditLog(200) });
        });

        /* ---------- saved versions and backups (Admins) ---------- */
        app.MapGet("/api/v1/tenants/{tenant}/history", (HttpContext ctx, string tenant) =>
        {
            if (Need(ctx, 4, out _) is { } d) return d;
            if (!store.Exists(tenant)) return Err("Unknown tenant.", 404);
            return Results.Json(new { versions = store.History(tenant).Select(h => new { id = h.Id, rev = h.Rev, savedAt = h.SavedAt, savedBy = h.SavedBy }) });
        });
        app.MapPost("/api/v1/tenants/{tenant}/history/{hid:long}/restore", async (HttpContext ctx, string tenant, long hid) =>
        {
            if (Need(ctx, 4, out var who) is { } d) return d;
            if (!store.Exists(tenant)) return Err("Unknown tenant.", 404);
            var ws = store.HistoryWorkspace(tenant, hid);
            if (ws is null) return Err("That saved version is gone.", 404);
            var r = await store.Write(tenant, ws, -1, who!.Name + " (restored)", keepPrevious: true);
            acc.Audit(who.Name, "restore", $"Restored saved version {hid} of {tenant}");
            return Results.Json(new { rev = r.Rev });
        });
        app.MapPost("/api/v1/admin/backup", (HttpContext ctx) =>
        {
            if (Need(ctx, 5, out var who) is { } d) return d;
            var file = db.Backup(Path.Combine(Path.GetDirectoryName(db.FilePath)!, "backups"));
            acc.Audit(who!.Name, "backup", Path.GetFileName(file));
            return Results.Json(new { file = Path.GetFileName(file), bytes = new FileInfo(file).Length });
        });
    }
}
