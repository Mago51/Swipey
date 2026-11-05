using System.Runtime.InteropServices;
using System.Text.Json;

const uint SpiGetTouchpadParameters = 0x00AE;
const uint SpiSetTouchpadParameters = 0x00AF;
const uint SpifUpdateIniFile = 0x0001;
const uint SpifSendChange = 0x0002;
const uint WmSettingChange = 0x001A;
const uint SmtoAbortIfHung = 0x0002;
const int TouchpadParametersVersion1 = 1;
const int PanEnabledBit = 7;
const int ZoomEnabledBit = 8;
const string PrecisionTouchpadArea = "Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad";

var options = ParseArgs(args);
if (options.Help)
{
    Console.WriteLine("Usage: dotnet Swipey.TouchpadSettingsRefresh.dll refresh [--pan-enabled 0|1] [--zoom-enabled 0|1]");
    return;
}

var result = RefreshTouchpadSettings(options);
Console.WriteLine(JsonSerializer.Serialize(result));
Environment.Exit(result.Success ? 0 : 1);

static RefreshResult RefreshTouchpadSettings(RefreshOptions options)
{
    var spiGetSucceeded = false;
    var spiSetSucceeded = false;
    var spiLastError = 0;
    TouchpadParametersV1? before = null;
    TouchpadParametersV1? after = null;

    var parameters = new TouchpadParametersV1
    {
        VersionNumber = TouchpadParametersVersion1,
    };
    var size = Marshal.SizeOf<TouchpadParametersV1>();

    // Aktuelle Touchpad-Parameter lesen, nur die gewünschten Flags ändern und wieder zurückschreiben.
    if (NativeMethods.SystemParametersInfo(SpiGetTouchpadParameters, (uint)size, ref parameters, 0))
    {
        spiGetSucceeded = true;
        before = parameters;
        if (options.PanEnabled.HasValue) parameters.SetFlag(PanEnabledBit, options.PanEnabled.Value);
        if (options.ZoomEnabled.HasValue) parameters.SetFlag(ZoomEnabledBit, options.ZoomEnabled.Value);

        if (NativeMethods.SystemParametersInfo(SpiSetTouchpadParameters, (uint)size, ref parameters, SpifUpdateIniFile | SpifSendChange))
        {
            spiSetSucceeded = true;
            after = parameters;
        }
        else
        {
            spiLastError = Marshal.GetLastWin32Error();
        }
    }
    else
    {
        spiLastError = Marshal.GetLastWin32Error();
    }

    // Zusätzlich schicken wir WM_SETTINGCHANGE an alle Fenster, damit Windows und andere Programme
    // die geänderten Einstellungen mitbekommen.
    var broadcastSucceeded = NativeMethods.SendMessageTimeout(
        new IntPtr(0xffff),
        WmSettingChange,
        UIntPtr.Zero,
        PrecisionTouchpadArea,
        SmtoAbortIfHung,
        2000,
        out var broadcastResult) != IntPtr.Zero;
    var broadcastLastError = broadcastSucceeded ? 0 : Marshal.GetLastWin32Error();

    return new RefreshResult(
        Success: broadcastSucceeded && (spiGetSucceeded ? spiSetSucceeded : true),
        Mechanism: spiGetSucceeded
            ? "SystemParametersInfo(SPI_SETTOUCHPADPARAMETERS)+WM_SETTINGCHANGE"
            : "WM_SETTINGCHANGE",
        SpiGetSucceeded: spiGetSucceeded,
        SpiSetSucceeded: spiSetSucceeded,
        SpiLastError: spiLastError,
        BroadcastSucceeded: broadcastSucceeded,
        BroadcastLastError: broadcastLastError,
        BroadcastResult: broadcastResult.ToUInt64(),
        PanBefore: before?.GetFlag(PanEnabledBit),
        ZoomBefore: before?.GetFlag(ZoomEnabledBit),
        PanAfter: after?.GetFlag(PanEnabledBit),
        ZoomAfter: after?.GetFlag(ZoomEnabledBit));
}

static RefreshOptions ParseArgs(string[] args)
{
    var options = new RefreshOptions();
    if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
    {
        options.Help = true;
        return options;
    }
    if (!string.Equals(args[0], "refresh", StringComparison.OrdinalIgnoreCase))
    {
        options.Help = true;
        return options;
    }

    for (var i = 1; i < args.Length; i += 1)
    {
        if (args[i] == "--pan-enabled" && i + 1 < args.Length)
        {
            options.PanEnabled = ParseBool(args[++i]);
            continue;
        }
        if (args[i] == "--zoom-enabled" && i + 1 < args.Length)
        {
            options.ZoomEnabled = ParseBool(args[++i]);
            continue;
        }
    }
    return options;
}

static bool ParseBool(string value)
{
    return value is "1" or "true" or "True" or "TRUE";
}

[StructLayout(LayoutKind.Sequential)]
struct TouchpadParametersV1
{
    public uint VersionNumber;
    public uint MaxSupportedContacts;
    public uint LegacyTouchpadFeatures;
    public uint StatusFlags;
    public uint SettingFlags;
    public uint SensitivityLevel;
    public uint CursorSpeed;
    public uint FeedbackIntensity;
    public uint ClickForceSensitivity;
    public uint RightClickZoneWidth;
    public uint RightClickZoneHeight;

    public readonly bool GetFlag(int bit) => (SettingFlags & (1u << bit)) != 0;

    public void SetFlag(int bit, bool enabled)
    {
        if (enabled) SettingFlags |= 1u << bit;
        else SettingFlags &= ~(1u << bit);
    }
}

sealed class RefreshOptions
{
    public bool Help { get; set; }
    public bool? PanEnabled { get; set; }
    public bool? ZoomEnabled { get; set; }
}

record RefreshResult(
    bool Success,
    string Mechanism,
    bool SpiGetSucceeded,
    bool SpiSetSucceeded,
    int SpiLastError,
    bool BroadcastSucceeded,
    int BroadcastLastError,
    ulong BroadcastResult,
    bool? PanBefore,
    bool? ZoomBefore,
    bool? PanAfter,
    bool? ZoomAfter);

static partial class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref TouchpadParametersV1 pvParam, uint fWinIni);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
