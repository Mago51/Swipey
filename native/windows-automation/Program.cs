using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

var command = args.FirstOrDefault() ?? "";
try
{
    var result = command.ToLowerInvariant() switch
    {
        "window" => WindowCommand.Run(args.Skip(1).ToArray()),
        "volume" => VolumeCommand.Run(args.Skip(1).ToArray()),
        "self-test" => Result.Ok(new { provider = "windows-user32-coreaudio" }),
        _ => Result.Fail("INVALID_COMMAND", "Unknown automation command.")
    };
    Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    Environment.Exit(result.Success ? 0 : 1);
}
catch (Exception error)
{
    Console.WriteLine(JsonSerializer.Serialize(Result.Fail("WINDOWS_AUTOMATION_FAILED", error.Message), new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    Environment.Exit(1);
}

record Result(bool Success, string? Code = null, string? Message = null, object? Data = null)
{
    public static Result Ok(object? data = null) => new(true, Data: data);
    public static Result Fail(string code, string message, object? data = null) => new(false, code, message, data);
}

static class WindowCommand
{
    private static readonly string[] Positions = ["left-half", "right-half", "top-left", "top-right", "bottom-left", "bottom-right", "center"];

    public static Result Run(string[] args)
    {
        var operation = Read(args, "--operation");
        var target = AppTarget.FromArgs(args);
        if (string.IsNullOrWhiteSpace(operation)) return Result.Fail("INVALID_WINDOW_OPERATION", "Window operation is required.");
        if (!target.HasTarget) return Result.Fail("APP_TARGET_REQUIRED", "Choose an app target.");

        var window = FindWindow(target);
        if (window == IntPtr.Zero)
        {
            if (!IsProcessRunning(target)) return Result.Fail("APP_NOT_RUNNING", "App is not running.");
            return Result.Fail("WINDOW_NOT_FOUND", "App window was not found.");
        }

        return operation.ToLowerInvariant() switch
        {
            "exists" => Result.Ok(new { found = true }),
            "focus" => Focus(window),
            "minimize" => Minimize(window),
            "maximize" => Maximize(window),
            "move-position" => MovePosition(window, Read(args, "--position")),
            _ => Result.Fail("INVALID_WINDOW_OPERATION", "Unsupported window operation.")
        };
    }

    // Ein minimiertes Fenster muss erst wiederhergestellt werden, sonst kommt es nicht nach vorne.
    private static Result Focus(IntPtr window)
    {
        Native.ShowWindow(window, Native.SW_RESTORE);
        if (!Native.SetForegroundWindow(window)) return Result.Fail("FOCUS_FAILED", "Window could not be focused.");
        return Result.Ok();
    }

    private static Result Minimize(IntPtr window)
    {
        Native.ShowWindow(window, Native.SW_MINIMIZE);
        return Result.Ok();
    }

    // Erst wiederherstellen und dann maximieren, damit das auch bei minimierten Fenstern klappt.
    private static Result Maximize(IntPtr window)
    {
        Native.ShowWindow(window, Native.SW_RESTORE);
        Native.ShowWindow(window, Native.SW_MAXIMIZE);
        return Result.Ok();
    }

    private static Result MovePosition(IntPtr window, string? position)
    {
        if (string.IsNullOrWhiteSpace(position) || !Positions.Contains(position)) return Result.Fail("INVALID_POSITION", "Choose a supported position.");
        Native.ShowWindow(window, Native.SW_RESTORE);
        if (!Native.GetWindowRect(window, out var rect)) return Result.Fail("POSITION_FAILED", "Window bounds were unavailable.");
        var monitor = Native.MonitorFromWindow(window, Native.MONITOR_DEFAULTTONEAREST);
        var info = Native.MONITORINFO.Create();
        if (!Native.GetMonitorInfo(monitor, ref info)) return Result.Fail("POSITION_FAILED", "Monitor work area was unavailable.");

        var work = info.rcWork;
        var workWidth = work.Right - work.Left;
        var workHeight = work.Bottom - work.Top;
        var halfWidth = workWidth / 2;
        var halfHeight = workHeight / 2;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        var x = work.Left;
        var y = work.Top;

        switch (position)
        {
            case "left-half":
                width = halfWidth; height = workHeight; break;
            case "right-half":
                x = work.Left + halfWidth; width = workWidth - halfWidth; height = workHeight; break;
            case "top-left":
                width = halfWidth; height = halfHeight; break;
            case "top-right":
                x = work.Left + halfWidth; width = workWidth - halfWidth; height = halfHeight; break;
            case "bottom-left":
                y = work.Top + halfHeight; width = halfWidth; height = workHeight - halfHeight; break;
            case "bottom-right":
                x = work.Left + halfWidth; y = work.Top + halfHeight; width = workWidth - halfWidth; height = workHeight - halfHeight; break;
            case "center":
                width = Math.Min(width, workWidth);
                height = Math.Min(height, workHeight);
                x = work.Left + (workWidth - width) / 2;
                y = work.Top + (workHeight - height) / 2;
                break;
        }

        if (!Native.SetWindowPos(window, IntPtr.Zero, x, y, width, height, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE))
        {
            return Result.Fail("POSITION_FAILED", "Window could not be moved.");
        }
        return Result.Ok(new { position, x, y, width, height });
    }

    private static IntPtr FindWindow(AppTarget target)
    {
        var matches = new List<IntPtr>();
        Native.EnumWindows((hWnd, _) =>
        {
            if (!IsSuitableWindow(hWnd)) return true;
            Native.GetWindowThreadProcessId(hWnd, out var processId);
            try
            {
                using var process = Process.GetProcessById((int)processId);
                if (target.Matches(process, GetWindowTitle(hWnd))) matches.Add(hWnd);
            }
            catch
            {
                // Der Prozess wurde während der Suche beendet, den überspringen wir.
            }
            return true;
        }, IntPtr.Zero);
        return matches.FirstOrDefault();
    }

    private static bool IsProcessRunning(AppTarget target)
    {
        return Process.GetProcesses().Any(process =>
        {
            try { return target.Matches(process, ""); }
            catch { return false; }
        });
    }

    private static bool IsSuitableWindow(IntPtr hWnd)
    {
        if (!Native.IsWindowVisible(hWnd)) return false;
        if (!Native.GetWindowRect(hWnd, out var rect)) return false;
        if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return false;
        var title = GetWindowTitle(hWnd);
        return !string.IsNullOrWhiteSpace(title);
    }

    private static string GetWindowTitle(IntPtr hWnd)
    {
        var length = Native.GetWindowTextLength(hWnd);
        if (length <= 0) return "";
        var buffer = new char[length + 1];
        Native.GetWindowText(hWnd, buffer, buffer.Length);
        return new string(buffer).TrimEnd('\0');
    }

    private static string? Read(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

sealed record AppTarget(string? ProcessName, string? ExecutablePath, string? WindowTitle)
{
    public bool HasTarget => !string.IsNullOrWhiteSpace(ProcessName) || !string.IsNullOrWhiteSpace(ExecutablePath) || !string.IsNullOrWhiteSpace(WindowTitle);

    public static AppTarget FromArgs(string[] args) => new(Read(args, "--process-name"), Read(args, "--executable-path"), Read(args, "--window-title"));

    public bool Matches(Process process, string title)
    {
        if (!string.IsNullOrWhiteSpace(ProcessName))
        {
            var expected = NormalizeProcessName(ProcessName);
            var actual = NormalizeProcessName(process.ProcessName);
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) return false;
        }
        if (!string.IsNullOrWhiteSpace(ExecutablePath))
        {
            try
            {
                if (!string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""), Path.GetFullPath(ExecutablePath), StringComparison.OrdinalIgnoreCase)) return false;
            }
            catch
            {
                return false;
            }
        }
        if (!string.IsNullOrWhiteSpace(WindowTitle) && !title.Contains(WindowTitle, StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }

    private static string NormalizeProcessName(string value) => Path.GetFileNameWithoutExtension(value.Trim());

    private static string? Read(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

static class VolumeCommand
{
    public static Result Run(string[] args)
    {
        var percentText = Read(args, "--percent");
        if (!int.TryParse(percentText, out var percent) || percent < 0 || percent > 100) return Result.Fail("INVALID_VOLUME_PERCENT", "Volume must be 0 through 100.");
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var device);
        if (device is null) return Result.Fail("AUDIO_DEVICE_NOT_FOUND", "Default audio device was not found.");
        var iid = typeof(IAudioEndpointVolume).GUID;
        device.Activate(ref iid, 0, IntPtr.Zero, out var endpointObject);
        var endpoint = (IAudioEndpointVolume)endpointObject;
        var volume = percent / 100f;
        endpoint.SetMasterVolumeLevelScalar(volume, Guid.Empty);
        return Result.Ok(new { percent });
    }

    private static string? Read(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

static partial class Native
{
    public const int SW_RESTORE = 9;
    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;
    public const uint MONITOR_DEFAULTTONEAREST = 2;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, char[] text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;

        public static MONITORINFO Create() => new() { cbSize = Marshal.SizeOf<MONITORINFO>() };
    }
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator { }

internal enum EDataFlow { eRender, eCapture, eAll }
internal enum ERole { eConsole, eMultimedia, eCommunications }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
}
