using System.Text.Json;
using ChordLibrary.Core.Supabase;

namespace ChordLibrary.Shared;

public static class AppDefaults
{
    public static SupabaseOptions Load()
    {
        using var stream = typeof(AppDefaults).Assembly.GetManifestResourceStream("ChordLibrary.Shared.Assets.supabase-public.json")!;
        var options = JsonSerializer.Deserialize<SupabaseOptions>(stream) ?? throw new InvalidOperationException("The default Supabase connection is missing.");
        options.Validate();
        return options;
    }
}
