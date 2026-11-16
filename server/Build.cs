using System.Reflection;

// The build number is made at random each time the package is built; build.ps1 puts it in the program (assembly metadata) and in the
// web app's version.js. A copy of the program run from source reports "dev", unless a build.txt sits in its folder.
static class Build
{
    public static string Number(string root)
    {
        var meta = typeof(Build).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "BuildNumber")?.Value;
        if (!string.IsNullOrWhiteSpace(meta) && meta != "dev") return meta;
        try { var f = Path.Combine(root, "build.txt"); if (File.Exists(f)) return File.ReadAllText(f).Trim(); } catch (IOException) { }
        return "dev";
    }
}
