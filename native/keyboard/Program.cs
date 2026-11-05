using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException)
        {
            // Electron startet den Helper versteckt, ganz am Anfang kann stdout noch fehlen.
        }

        var mode = args.FirstOrDefault() ?? "monitor";
        if (!mode.Equals("monitor", StringComparison.OrdinalIgnoreCase))
        {
            Emit(new { type = "error", code = "INVALID_MODE", message = "Expected monitor." });
            Environment.ExitCode = 2;
            return;
        }

        var codes = ReadCodes(args);
        if (codes.Count == 0)
        {
            Emit(new { type = "error", code = "NO_CODES", message = "No keyboard codes were requested." });
            Environment.ExitCode = 2;
            return;
        }

        ApplicationConfiguration.Initialize();
        using var hook = new KeyboardHook(codes);
        Application.Run(new ApplicationContext());
    }

    private static HashSet<string> ReadCodes(string[] args)
    {
        var index = Array.IndexOf(args, "--codes");
        if (index < 0 || index + 1 >= args.Length) return [];
        return args[index + 1]
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(code => NumpadScanCodes.ContainsValue(code))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public static void Emit(object payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(payload, JsonOptions));
        Console.Out.Flush();
    }

    public static readonly Dictionary<uint, string> NumpadScanCodes = new()
    {
        [0x52] = "Numpad0",
        [0x4F] = "Numpad1",
        [0x50] = "Numpad2",
        [0x51] = "Numpad3",
        [0x4B] = "Numpad4",
        [0x4C] = "Numpad5",
        [0x4D] = "Numpad6",
        [0x47] = "Numpad7",
        [0x48] = "Numpad8",
        [0x49] = "Numpad9",
    };
}

internal sealed class KeyboardHook : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;
    private const int VK_MENU = 0x12;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private readonly HashSet<string> requestedCodes;
    private readonly HashSet<string> pressedCodes = new(StringComparer.OrdinalIgnoreCase);
    private readonly LowLevelKeyboardProc callback;
    private readonly IntPtr hook;

    public KeyboardHook(HashSet<string> requestedCodes)
    {
        this.requestedCodes = requestedCodes;
        callback = HookCallback;
        using var process = Process.GetCurrentProcess();
        using var module = process.MainModule;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(module?.ModuleName), 0);
        if (hook == IntPtr.Zero)
        {
            Program.Emit(new { type = "error", code = "KEYBOARD_HOOK_FAILED", message = $"SetWindowsHookEx failed: {Marshal.GetLastWin32Error()}" });
            Application.ExitThread();
            return;
        }

        Program.Emit(new { type = "keyboardStarted", provider = "windows-low-level-keyboard-hook", codes = requestedCodes });
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var message = wParam.ToInt32();
            var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            if (Program.NumpadScanCodes.TryGetValue(data.scanCode, out var code) && requestedCodes.Contains(code))
            {
                if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
                {
                    // Nur Numpad-Tasten ohne Modifier. pressedCodes verhindert, dass das Auto-Repeat
                    // beim Gedrückthalten mehrfach auslöst.
                    if (!AnyModifierDown() && pressedCodes.Add(code)) EmitKey("keyDown", code, data);
                }
                else if (message == WM_KEYUP || message == WM_SYSKEYUP)
                {
                    pressedCodes.Remove(code);
                    EmitKey("keyUp", code, data);
                }
            }
        }

        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private static bool AnyModifierDown()
    {
        return IsDown(VK_CONTROL) || IsDown(VK_SHIFT) || IsDown(VK_MENU) || IsDown(VK_LWIN) || IsDown(VK_RWIN);
    }

    private static bool IsDown(int virtualKey) => (GetAsyncKeyState(virtualKey) & 0x8000) != 0;

    private static void EmitKey(string type, string code, KBDLLHOOKSTRUCT data)
    {
        Program.Emit(new
        {
            type,
            provider = "windows-low-level-keyboard-hook",
            code,
            accelerator = $"num{code[^1]}",
            timestamp = Stopwatch.GetTimestamp(),
            timestampFrequency = Stopwatch.Frequency,
            vkCode = data.vkCode,
            scanCode = data.scanCode,
            flags = data.flags
        });
    }

    public void Dispose()
    {
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        Program.Emit(new { type = "keyboardStopped" });
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);
}

[StructLayout(LayoutKind.Sequential)]
internal struct KBDLLHOOKSTRUCT
{
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public UIntPtr dwExtraInfo;
}
