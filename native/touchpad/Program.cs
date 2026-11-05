using System.Diagnostics;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException)
        {
            // Ohne Konsolenfenster gibt es unter Umständen kein Console-Handle.
        }
        var mode = args.FirstOrDefault() ?? "enumerate";
        if (mode.Equals("enumerate", StringComparison.OrdinalIgnoreCase))
        {
            Emit(new { type = "deviceList", devices = RawInput.EnumerateDevices(), capabilities = CapabilityModel.FromDevices(RawInput.EnumerateDevices()) });
            return;
        }

        if (mode.Equals("descriptor", StringComparison.OrdinalIgnoreCase))
        {
            var descriptors = new List<object>();
            foreach (var device in RawInput.EnumerateDevices().Where(device => device.classification == "touchpad"))
            {
                try
                {
                    descriptors.Add(new { device, descriptor = HidDescriptorReader.DescribeDevice(device) });
                }
                catch (Exception error)
                {
                    descriptors.Add(new { device, error = new { code = "DESCRIPTOR_READ_FAILED", message = error.Message, stack = error.StackTrace } });
                }
            }
            Emit(new { type = "descriptorList", devices = descriptors });
            return;
        }

        if (mode.Equals("elan-collections", StringComparison.OrdinalIgnoreCase))
        {
            Emit(ElanCollectionDiagnostics.Describe());
            return;
        }

        if (mode.Equals("describe-one", StringComparison.OrdinalIgnoreCase))
        {
            var device = RawInput.EnumerateDevices().FirstOrDefault(device => device.classification == "touchpad");
            Emit(new { type = "describeOneStart", device });
            if (device is not null) Emit(new { type = "describeOneResult", descriptor = HidDescriptorReader.DescribeDevice(device) });
            return;
        }

        if (mode.Equals("monitor", StringComparison.OrdinalIgnoreCase))
        {
            var durationMs = ReadDuration(args);
            var rawPreviewLimit = ReadRawPreviewLimit(args);
            ApplicationConfiguration.Initialize();
            using var window = new RawInputWindow(durationMs, rawPreviewLimit);
            Application.Run(new ApplicationContext());
            return;
        }

        if (mode.Equals("path-diagnostic", StringComparison.OrdinalIgnoreCase))
        {
            var label = ReadLabel(args);
            var durationMs = ReadDuration(args);
            ApplicationConfiguration.Initialize();
            using var window = new PathDiagnosticWindow(label, durationMs > 0 ? durationMs : 5000);
            Application.Run(new ApplicationContext());
            return;
        }

        Emit(new { type = "error", code = "INVALID_MODE", message = "Expected enumerate, descriptor, describe-one, elan-collections, path-diagnostic, or monitor." });
        Environment.ExitCode = 2;
    }

    private static int ReadDuration(string[] args)
    {
        var index = Array.IndexOf(args, "--duration-ms");
        if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out var value) && value > 0) return value;
        return 0;
    }

    private static int ReadRawPreviewLimit(string[] args)
    {
        var index = Array.IndexOf(args, "--raw-preview-limit");
        if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out var value) && value >= 0) return value;
        return 80;
    }

    private static string ReadLabel(string[] args)
    {
        var index = Array.IndexOf(args, "--label");
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : "";
    }

    public static void Emit(object payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(payload, JsonOptions));
        Console.Out.Flush();
    }

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}

internal sealed class RawInputWindow : NativeWindow, IDisposable
{
    private const int WM_INPUT = 0x00FF;
    private const int WM_INPUT_DEVICE_CHANGE = 0x00FE;
    private readonly System.Windows.Forms.Timer? stopTimer;
    private readonly Dictionary<string, DeviceInfoDto> devices;
    private readonly TouchpadContactTracker contactTracker = new();
    private int rawPreviewBudget = 80;

    public RawInputWindow(int durationMs, int rawPreviewLimit)
    {
        rawPreviewBudget = rawPreviewLimit;
        devices = RawInput.EnumerateDevices().ToDictionary(device => device.deviceId);
        CreateHandle(new CreateParams { Caption = "Swipey Touchpad Probe" });
        RawInput.Register(Handle);
        Program.Emit(new { type = "diagnosticStarted", provider = "raw-input-hid", devices = devices.Values, capabilities = CapabilityModel.FromDevices(devices.Values), timestampFrequency = Stopwatch.Frequency });

        if (durationMs > 0)
        {
            stopTimer = new System.Windows.Forms.Timer { Interval = durationMs };
            stopTimer.Tick += (_, _) =>
            {
                Program.Emit(new { type = "diagnosticStopped", reason = "durationElapsed" });
                Application.ExitThread();
            };
            stopTimer.Start();
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            foreach (var evt in RawInput.ReadInput(m.LParam, devices, contactTracker, rawPreviewBudget > 0))
            {
                Program.Emit(evt);
                if (evt is RawHidPreviewEvent or MouseRawPreviewEvent) rawPreviewBudget -= 1;
            }
        }
        else if (m.Msg == WM_INPUT_DEVICE_CHANGE)
        {
            var nextDevices = RawInput.EnumerateDevices();
            devices.Clear();
            foreach (var device in nextDevices) devices[device.deviceId] = device;
            Program.Emit(new { type = "deviceChanged", devices = nextDevices, capabilities = CapabilityModel.FromDevices(nextDevices) });
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        stopTimer?.Stop();
        stopTimer?.Dispose();
        RawInput.Unregister(Handle);
        DestroyHandle();
    }
}

internal sealed class PathDiagnosticWindow : NativeWindow, IDisposable
{
    private static readonly HashSet<string> ValidLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "touchpad-path-move",
        "touchpad-path-scroll",
        "touchpad-path-tap",
        "touchpad-path-physical-click"
    };

    private const int WM_INPUT = 0x00FF;
    private const int WM_INPUT_DEVICE_CHANGE = 0x00FE;
    private System.Windows.Forms.Timer? stopTimer;
    private readonly Dictionary<string, DeviceInfoDto> devices = [];
    private readonly TouchpadContactTracker contactTracker = new();
    private PathDiagnosticSummary? summary;
    private LowLevelMouseHook? hook;
    private bool disposed;

    public PathDiagnosticWindow(string label, int durationMs)
    {
        if (!ValidLabels.Contains(label))
        {
            Program.Emit(new { type = "error", code = "INVALID_PATH_DIAGNOSTIC_LABEL", label, expected = ValidLabels });
            Environment.ExitCode = 2;
            Application.ExitThread();
            return;
        }

        foreach (var device in RawInput.EnumerateDevices()) devices[device.deviceId] = device;
        summary = new PathDiagnosticSummary(label, Stopwatch.GetTimestamp());
        CreateHandle(new CreateParams { Caption = "Swipey Touchpad Path Diagnostic" });
        RawInput.Register(Handle);
        hook = new LowLevelMouseHook(evt =>
        {
            foreach (var output in summary.RecordHook(evt)) Program.Emit(output);
        });
        hook.Install();
        Program.Emit(new
        {
            type = "pathDiagnosticStarted",
            label,
            durationMs,
            timestampFrequency = Stopwatch.Frequency,
            devices = devices.Values,
            note = "Observation-only Raw Input monitor."
        });

        stopTimer = new System.Windows.Forms.Timer { Interval = durationMs };
        stopTimer.Tick += (_, _) =>
        {
            Program.Emit(summary.BuildFinalSummary("durationElapsed"));
            Application.ExitThread();
        };
        stopTimer.Start();
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            if (summary is null) return;
            foreach (var evt in RawInput.ReadPathDiagnosticInput(m.LParam, devices, contactTracker))
            {
                foreach (var output in summary.RecordRawOrPtp(evt)) Program.Emit(output);
            }
        }
        else if (m.Msg == WM_INPUT_DEVICE_CHANGE)
        {
            var nextDevices = RawInput.EnumerateDevices();
            devices.Clear();
            foreach (var device in nextDevices) devices[device.deviceId] = device;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        stopTimer?.Stop();
        stopTimer?.Dispose();
        hook?.Dispose();
        RawInput.Unregister(Handle);
        DestroyHandle();
    }
}

internal sealed class PathDiagnosticSummary
{
    private const int MaxSamples = 24;
    private readonly string label;
    private readonly long startedAt;
    private readonly List<object> timeline = [];
    private readonly Dictionary<string, bool> lastButtonByDevice = [];
    private int emittedSamples;

    public int ptpFrames;
    public int ptpContactBegins;
    public int ptpContactMoves;
    public int ptpContactEnds;
    public int ptpButtonDown;
    public int ptpButtonUp;
    public int elanMouseRaw;
    public int zeroHandleRaw;
    public int logitechRaw;
    public int rawMove;
    public int rawWheel;
    public int rawHWheel;
    public int rawButtonDown;
    public int rawButtonUp;
    public int hookMove;
    public int hookWheel;
    public int hookHWheel;
    public int hookButtonDown;
    public int hookButtonUp;

    public PathDiagnosticSummary(string label, long startedAt)
    {
        this.label = label;
        this.startedAt = startedAt;
    }

    public IEnumerable<object> RecordRawOrPtp(object evt)
    {
        switch (evt)
        {
            case PathPtpFrameEvent ptp:
                ptpFrames += 1;
                if (!lastButtonByDevice.TryGetValue(ptp.deviceId, out var wasPressed)) wasPressed = false;
                if (!wasPressed && ptp.buttonPressed) ptpButtonDown += 1;
                if (wasPressed && !ptp.buttonPressed) ptpButtonUp += 1;
                lastButtonByDevice[ptp.deviceId] = ptp.buttonPressed;
                AddTimeline("ptpFrame", ptp.timestamp, new { ptp.contactCount, ptp.buttonPressed, contacts = ptp.contacts.Count });
                foreach (var output in MaybeEmitSample(ptp)) yield return output;
                break;
            case PathContactLifecycleEvent contact:
                if (contact.type == "contactBegin") ptpContactBegins += 1;
                if (contact.type == "contactMove") ptpContactMoves += 1;
                if (contact.type == "contactEnd") ptpContactEnds += 1;
                AddTimeline(contact.type, contact.timestamp, new { contact.contactId, contact.contactCount });
                break;
            case PathRawMouseEvent raw:
                if (raw.deviceClass == "elan-touchpad-mouse") elanMouseRaw += 1;
                if (raw.deviceClass == "unknown-zero-handle") zeroHandleRaw += 1;
                if (raw.deviceClass == "logitech-mouse") logitechRaw += 1;
                if (raw.dx != 0 || raw.dy != 0) rawMove += 1;
                if (raw.wheel != 0) rawWheel += 1;
                if (raw.hWheel != 0) rawHWheel += 1;
                if (raw.buttonDown) rawButtonDown += 1;
                if (raw.buttonUp) rawButtonUp += 1;
                AddTimeline("rawMouse", raw.timestamp, new { raw.deviceClass, raw.dx, raw.dy, raw.wheel, raw.hWheel, raw.buttons });
                foreach (var output in MaybeEmitSample(raw)) yield return output;
                break;
        }
    }

    public IEnumerable<object> RecordHook(MouseHookEvent evt)
    {
        if (evt.eventKind == "move") hookMove += 1;
        if (evt.eventKind == "wheel") hookWheel += 1;
        if (evt.eventKind == "hwheel") hookHWheel += 1;
        if (evt.eventKind == "buttonDown") hookButtonDown += 1;
        if (evt.eventKind == "buttonUp") hookButtonUp += 1;
        AddTimeline("mouseHook", evt.timestamp, new { evt.message, evt.mouseData, evt.injected });
        foreach (var output in MaybeEmitSample(evt)) yield return output;
    }

    public object BuildFinalSummary(string reason)
    {
        var inference = InferPath();
        return new
        {
            type = "pathDiagnosticSummary",
            reason,
            label,
            ptpFrames,
            ptpContactBegins,
            ptpContactMoves,
            ptpContactEnds,
            ptpButtonDown,
            ptpButtonUp,
            elanMouseRaw,
            zeroHandleRaw,
            logitechRaw,
            rawMove,
            rawWheel,
            rawHWheel,
            rawButtonDown,
            rawButtonUp,
            hookMove,
            hookWheel,
            hookHWheel,
            hookButtonDown,
            hookButtonUp,
            inferredPath = inference.path,
            confidence = inference.confidence,
            notes = inference.notes,
            timeline
        };
    }

    private IEnumerable<object> MaybeEmitSample(object evt)
    {
        if (emittedSamples >= MaxSamples) yield break;
        emittedSamples += 1;
        yield return evt;
    }

    private void AddTimeline(string type, long timestamp, object detail)
    {
        if (timeline.Count >= MaxSamples) return;
        timeline.Add(new
        {
            atUs = Math.Round((timestamp - startedAt) * 1000000.0 / Stopwatch.Frequency, 1),
            type,
            detail
        });
    }

    private (string path, string confidence, string[] notes) InferPath()
    {
        var notes = new List<string>();
        if (logitechRaw > 0) notes.Add("Logitech activity was observed during the capture and counted separately.");
        if (zeroHandleRaw > 0) notes.Add("hDevice=0 Raw Input was observed and intentionally kept as unknown-zero-handle.");
        if (ptpButtonDown == 0 && label.Contains("tap", StringComparison.OrdinalIgnoreCase)) notes.Add("Tap capture did not assert the PTP physical Button 1 field.");
        if (ptpButtonDown > 0 && label.Contains("physical-click", StringComparison.OrdinalIgnoreCase)) notes.Add("Physical-click capture asserted the PTP physical Button 1 field.");

        if (label.EndsWith("move", StringComparison.OrdinalIgnoreCase))
        {
            if (ptpFrames > 0 && hookMove > 0 && zeroHandleRaw > 0 && elanMouseRaw == 0) return ("Evidence suggests cursor movement follows active PTP contacts and appears in Raw Input as synthesized hDevice=0 mouse movement, not identified ELAN Col01 packets.", "medium", notes.ToArray());
            if (ptpFrames > 0 && hookMove > 0 && elanMouseRaw > 0) return ("Evidence suggests cursor movement involves both PTP contact frames and identified ELAN mouse-compatible Raw Input.", "medium", notes.ToArray());
        }
        if (label.EndsWith("scroll", StringComparison.OrdinalIgnoreCase))
        {
            if (ptpFrames > 0 && hookWheel > 0 && rawWheel == 0) return ("Evidence suggests 2-finger scroll is synthesized from PTP contact motion before hook-level wheel output.", "medium", notes.ToArray());
            if (rawWheel > 0) return ("Evidence shows Raw Input wheel packets occurred during 2-finger scroll; inspect deviceClass counts for source.", "high", notes.ToArray());
        }
        if (label.EndsWith("tap", StringComparison.OrdinalIgnoreCase))
        {
            if (hookButtonDown > 0 && ptpButtonDown == 0) return ("Evidence suggests tap-to-click is generated by Windows interpretation of PTP contact timing rather than the PTP physical button bit.", "medium", notes.ToArray());
            if (ptpButtonDown > 0) return ("Evidence shows tap capture asserted PTP Button 1; compare carefully with physical-click capture.", "medium", notes.ToArray());
        }
        if (label.EndsWith("physical-click", StringComparison.OrdinalIgnoreCase))
        {
            if (ptpButtonDown > 0 && hookButtonDown > 0) return ("Evidence shows physical click asserts the PTP Button 1 field and produces hook-level button output.", "high", notes.ToArray());
            if (hookButtonDown > 0) return ("Hook-level button output occurred, but PTP Button 1 was not observed in this capture.", "medium", notes.ToArray());
        }

        return ("Insufficient physical input captured to infer a path.", "low", notes.ToArray());
    }
}

internal sealed record MouseHookEvent(
    string type,
    long timestamp,
    string eventKind,
    string message,
    int x,
    int y,
    uint mouseData,
    uint flags,
    bool injected,
    bool lowerIntegrityInjected);

internal sealed class LowLevelMouseHook : IDisposable
{
    private const int WH_MOUSE_LL = 14;
    private const int HC_ACTION = 0;
    private const uint LLMHF_INJECTED = 0x00000001;
    private const uint LLMHF_LOWER_IL_INJECTED = 0x00000002;
    private readonly Action<MouseHookEvent> onEvent;
    private readonly LowLevelMouseProc proc;
    private IntPtr hook = IntPtr.Zero;

    public LowLevelMouseHook(Action<MouseHookEvent> onEvent)
    {
        this.onEvent = onEvent;
        proc = HookCallback;
    }

    public void Install()
    {
        hook = SetWindowsHookEx(WH_MOUSE_LL, proc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero) Program.Emit(new { type = "error", code = "MOUSE_HOOK_INSTALL_FAILED", win32Error = Marshal.GetLastWin32Error() });
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            onEvent(new MouseHookEvent(
                "mouseHook",
                Stopwatch.GetTimestamp(),
                MouseHookMessage.EventKind(wParam.ToInt32()),
                MouseHookMessage.MessageName(wParam.ToInt32()),
                data.pt.x,
                data.pt.y,
                data.mouseData,
                data.flags,
                (data.flags & LLMHF_INJECTED) != 0,
                (data.flags & LLMHF_LOWER_IL_INJECTED) != 0
            ));
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (hook == IntPtr.Zero) return;
        UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
    }

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
}

internal static class MouseHookMessage
{
    public static string EventKind(int message) => message switch
    {
        0x0200 => "move",
        0x020A => "wheel",
        0x020E => "hwheel",
        0x0201 or 0x0204 or 0x0207 or 0x020B => "buttonDown",
        0x0202 or 0x0205 or 0x0208 or 0x020C => "buttonUp",
        _ => "other"
    };

    public static string MessageName(int message) => message switch
    {
        0x0200 => "WM_MOUSEMOVE",
        0x0201 => "WM_LBUTTONDOWN",
        0x0202 => "WM_LBUTTONUP",
        0x0204 => "WM_RBUTTONDOWN",
        0x0205 => "WM_RBUTTONUP",
        0x0207 => "WM_MBUTTONDOWN",
        0x0208 => "WM_MBUTTONUP",
        0x020A => "WM_MOUSEWHEEL",
        0x020E => "WM_MOUSEHWHEEL",
        0x020B => "WM_XBUTTONDOWN",
        0x020C => "WM_XBUTTONUP",
        _ => $"0x{message:X}"
    };
}

[StructLayout(LayoutKind.Sequential)]
internal struct POINT
{
    public int x;
    public int y;
}

[StructLayout(LayoutKind.Sequential)]
internal struct MSLLHOOKSTRUCT
{
    public POINT pt;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
}

internal static class CapabilityModel
{
    public static object FromDevices(IEnumerable<DeviceInfoDto> devices)
    {
        var list = devices.ToList();
        var hasTouchpad = list.Any(device => device.classification == "touchpad");
        return new
        {
            detected = hasTouchpad,
            provider = "raw-input-hid",
            deviceSeparated = list.Count > 1,
            contactsAvailable = false,
            contactIdsAvailable = false,
            normalizedCoordinates = false,
            multiTouchAvailable = false,
            note = hasTouchpad
                ? "Touchpad-class HID can be separated by Raw Input. Contact decoding requires HID report descriptor parsing or Precision Touchpad pointer APIs."
                : "No HID Digitizer Touch Pad collection was found by Raw Input enumeration."
        };
    }
}

internal static class RawInput
{
    private const uint RIDI_DEVICENAME = 0x20000007;
    private const uint RIDI_DEVICEINFO = 0x2000000b;
    private const uint RID_INPUT = 0x10000003;
    private const uint RIM_TYPEMOUSE = 0;
    private const uint RIM_TYPEKEYBOARD = 1;
    private const uint RIM_TYPEHID = 2;
    private const int RIDEV_REMOVE = 0x00000001;
    private const int RIDEV_INPUTSINK = 0x00000100;
    private const int RIDEV_DEVNOTIFY = 0x00002000;

    public static List<DeviceInfoDto> EnumerateDevices()
    {
        uint count = 0;
        var listSize = (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>();
        GetRawInputDeviceList(IntPtr.Zero, ref count, listSize);
        if (count == 0) return [];

        var buffer = Marshal.AllocHGlobal((int)(listSize * count));
        try
        {
            if (GetRawInputDeviceList(buffer, ref count, listSize) == uint.MaxValue) return [];
            var devices = new List<DeviceInfoDto>();
            for (var i = 0; i < count; i++)
            {
                var itemPtr = IntPtr.Add(buffer, i * (int)listSize);
                var item = Marshal.PtrToStructure<RAWINPUTDEVICELIST>(itemPtr);
                devices.Add(BuildDeviceInfo(item));
            }
            return devices;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    // Usage Page 0x01/0x02 ist die Maus, 0x0D/0x05 ein Touchpad und 0x0D/0x04 ein Touchscreen.
    // Mit INPUTSINK bekommen wir die Events auch, wenn unser Fenster nicht im Vordergrund ist.
    public static void Register(IntPtr hwnd)
    {
        var devices = new[]
        {
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x02, dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, hwndTarget = hwnd },
            new RAWINPUTDEVICE { usUsagePage = 0x0D, usUsage = 0x05, dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, hwndTarget = hwnd },
            new RAWINPUTDEVICE { usUsagePage = 0x0D, usUsage = 0x04, dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, hwndTarget = hwnd },
        };
        if (!RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()))
        {
            var error = Marshal.GetLastWin32Error();
            Program.Emit(new { type = "error", code = "RAW_INPUT_REGISTRATION_FAILED", message = $"RegisterRawInputDevices failed: {error}" });
        }
    }

    public static void Unregister(IntPtr hwnd)
    {
        var devices = new[]
        {
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x02, dwFlags = RIDEV_REMOVE, hwndTarget = IntPtr.Zero },
            new RAWINPUTDEVICE { usUsagePage = 0x0D, usUsage = 0x05, dwFlags = RIDEV_REMOVE, hwndTarget = IntPtr.Zero },
            new RAWINPUTDEVICE { usUsagePage = 0x0D, usUsage = 0x04, dwFlags = RIDEV_REMOVE, hwndTarget = IntPtr.Zero },
        };
        RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>());
    }

    public static IEnumerable<object> ReadInput(IntPtr hRawInput, Dictionary<string, DeviceInfoDto> devices, TouchpadContactTracker contactTracker, bool includeRawPreview)
    {
        uint size = 0;
        GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
        if (size == 0) yield break;

        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(hRawInput, RID_INPUT, buffer, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) != size) yield break;
            var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
            var deviceId = header.hDevice.ToString("X");
            devices.TryGetValue(deviceId, out var device);
            var timestamp = Stopwatch.GetTimestamp();

            if (header.dwType == RIM_TYPEMOUSE)
            {
                var mouse = Marshal.PtrToStructure<RAWMOUSE>(IntPtr.Add(buffer, Marshal.SizeOf<RAWINPUTHEADER>()));
                if (includeRawPreview)
                {
                    yield return new MouseRawPreviewEvent(
                        "mouseRaw",
                        "raw-input",
                        deviceId,
                        device,
                        timestamp,
                        mouse.lLastX,
                        mouse.lLastY,
                        mouse.usButtonFlags,
                        "Bounded mouse-class raw input preview only; not a touchpad contact."
                    );
                }
            }
            else if (header.dwType == RIM_TYPEHID)
            {
                var hidHeaderOffset = Marshal.SizeOf<RAWINPUTHEADER>();
                var sizeHid = Marshal.ReadInt32(buffer, hidHeaderOffset);
                var count = Marshal.ReadInt32(buffer, hidHeaderOffset + 4);
                var totalBytes = Math.Max(0, sizeHid * count);
                if (sizeHid <= 0 || count <= 0) yield break;

                for (var reportIndex = 0; reportIndex < count; reportIndex += 1)
                {
                    var reportOffset = hidHeaderOffset + 8 + (reportIndex * sizeHid);
                    var raw = new byte[sizeHid];
                    Marshal.Copy(IntPtr.Add(buffer, reportOffset), raw, 0, sizeHid);
                    if (device?.classification == "touchpad")
                    {
                        foreach (var decoded in PrecisionTouchpadDecoder.Decode(device, raw, timestamp, contactTracker)) yield return decoded;
                    }
                    if (includeRawPreview)
                    {
                        yield return new RawHidPreviewEvent(
                            device?.classification == "touchpad" ? "touchpadRawHidFrame" : "hidRawFrame",
                            "raw-input-hid",
                            deviceId,
                            device,
                            timestamp,
                            sizeHid,
                            count,
                            reportIndex,
                            totalBytes,
                            Convert.ToHexString(raw),
                            null,
                            null,
                            null,
                            null,
                            device?.classification == "touchpad" ? "Bounded raw touchpad HID report preview. Future consumers should use normalized contact events." : "Bounded raw HID report received."
                        );
                    }
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static IEnumerable<object> ReadPathDiagnosticInput(IntPtr hRawInput, Dictionary<string, DeviceInfoDto> devices, TouchpadContactTracker contactTracker)
    {
        uint size = 0;
        GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
        if (size == 0) yield break;

        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(hRawInput, RID_INPUT, buffer, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) != size) yield break;
            var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
            var deviceId = header.hDevice.ToString("X");
            devices.TryGetValue(deviceId, out var device);
            var timestamp = Stopwatch.GetTimestamp();

            if (header.dwType == RIM_TYPEMOUSE)
            {
                var mouse = Marshal.PtrToStructure<RAWMOUSE>(IntPtr.Add(buffer, Marshal.SizeOf<RAWINPUTHEADER>()));
                yield return PathRawMouseEvent.From(timestamp, deviceId, device, mouse.lLastX, mouse.lLastY, mouse.usButtonFlags, mouse.usButtonData);
            }
            else if (header.dwType == RIM_TYPEHID)
            {
                var hidHeaderOffset = Marshal.SizeOf<RAWINPUTHEADER>();
                var sizeHid = Marshal.ReadInt32(buffer, hidHeaderOffset);
                var count = Marshal.ReadInt32(buffer, hidHeaderOffset + 4);
                if (sizeHid <= 0 || count <= 0) yield break;

                for (var reportIndex = 0; reportIndex < count; reportIndex += 1)
                {
                    var reportOffset = hidHeaderOffset + 8 + (reportIndex * sizeHid);
                    var raw = new byte[sizeHid];
                    Marshal.Copy(IntPtr.Add(buffer, reportOffset), raw, 0, sizeHid);
                    if (device?.classification != "touchpad") continue;
                    var frame = PrecisionTouchpadDecoder.DecodeFrame(device, raw, timestamp);
                    if (frame is null) continue;
                    yield return PathPtpFrameEvent.From(frame);
                    foreach (var lifecycleEvent in contactTracker.Update(frame))
                    {
                        if (PathContactLifecycleEvent.TryFrom(lifecycleEvent, out var contactEvent) && contactEvent is not null) yield return contactEvent;
                    }
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static DeviceInfoDto BuildDeviceInfo(RAWINPUTDEVICELIST item)
    {
        var name = GetDeviceName(item.hDevice);
        var info = GetDeviceInfo(item.hDevice);
        var deviceId = item.hDevice.ToString("X");
        var usagePage = info.dwType == RIM_TYPEHID ? info.hid.usUsagePage : (ushort?)null;
        var usage = info.dwType == RIM_TYPEHID ? info.hid.usUsage : (ushort?)null;
        var classification = Classify(item.dwType, usagePage, usage, name);
        var vidPid = ParseVidPid(name);
        return new DeviceInfoDto(
            deviceId,
            item.hDevice.ToInt64(),
            name,
            TypeName(item.dwType),
            info.dwType == RIM_TYPEHID ? info.hid.dwVendorId : vidPid.vendorId,
            info.dwType == RIM_TYPEHID ? info.hid.dwProductId : vidPid.productId,
            usagePage,
            usage,
            classification,
            classification == "touchpad" ? "HID Digitizer Touch Pad (Usage Page 0x0D, Usage 0x05)" : ClassificationReason(item.dwType, usagePage, usage)
        );
    }

    private static string GetDeviceName(IntPtr handle)
    {
        uint size = 0;
        GetRawInputDeviceInfo(handle, RIDI_DEVICENAME, IntPtr.Zero, ref size);
        if (size == 0) return "";
        var buffer = Marshal.AllocHGlobal((int)size * 2);
        try
        {
            return GetRawInputDeviceInfo(handle, RIDI_DEVICENAME, buffer, ref size) == uint.MaxValue ? "" : Marshal.PtrToStringUni(buffer) ?? "";
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static RID_DEVICE_INFO GetDeviceInfo(IntPtr handle)
    {
        var size = (uint)Marshal.SizeOf<RID_DEVICE_INFO>();
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            Marshal.WriteInt32(buffer, (int)size);
            if (GetRawInputDeviceInfo(handle, RIDI_DEVICEINFO, buffer, ref size) == uint.MaxValue) return new RID_DEVICE_INFO();
            return Marshal.PtrToStructure<RID_DEVICE_INFO>(buffer);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string Classify(uint rawType, ushort? usagePage, ushort? usage, string name)
    {
        if (rawType == RIM_TYPEMOUSE) return LooksLikeTouchpadPath(name) ? "mouse-compatible-touchpad-path" : "mouse";
        if (rawType == RIM_TYPEKEYBOARD) return "keyboard";
        if (rawType == RIM_TYPEHID && usagePage == 0x0D && usage == 0x05) return "touchpad";
        if (rawType == RIM_TYPEHID && usagePage == 0x0D && usage == 0x04) return "touchscreen";
        if (rawType == RIM_TYPEHID && usagePage == 0x0D) return "digitizer";
        return rawType == RIM_TYPEHID ? "hid" : "unknown";
    }

    private static string ClassificationReason(uint rawType, ushort? usagePage, ushort? usage)
    {
        if (rawType == RIM_TYPEMOUSE) return "Raw Input mouse collection.";
        if (rawType == RIM_TYPEKEYBOARD) return "Raw Input keyboard collection.";
        if (usagePage == 0x0D && usage == 0x04) return "HID Digitizer Touch Screen (Usage Page 0x0D, Usage 0x04).";
        if (usagePage == 0x0D) return $"HID Digitizer collection (Usage Page 0x0D, Usage 0x{usage:X2}).";
        return "Raw Input HID collection.";
    }

    private static bool LooksLikeTouchpadPath(string name) =>
        name.Contains("touchpad", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("ELAN012F", StringComparison.OrdinalIgnoreCase);

    public static string ClassifyMouseDevice(string deviceId, DeviceInfoDto? device)
    {
        if (deviceId == "0") return "unknown-zero-handle";
        if (device?.classification == "mouse-compatible-touchpad-path" || device?.deviceName.Contains("ELAN012F", StringComparison.OrdinalIgnoreCase) == true) return "elan-touchpad-mouse";
        if (device?.deviceName.Contains("VID_046D", StringComparison.OrdinalIgnoreCase) == true || device?.deviceName.Contains("logitech", StringComparison.OrdinalIgnoreCase) == true) return "logitech-mouse";
        return "unknown-mouse";
    }

    private static string TypeName(uint type) => type switch
    {
        RIM_TYPEMOUSE => "RIM_TYPEMOUSE",
        RIM_TYPEKEYBOARD => "RIM_TYPEKEYBOARD",
        RIM_TYPEHID => "RIM_TYPEHID",
        _ => $"UNKNOWN_{type}"
    };

    private static (uint? vendorId, uint? productId) ParseVidPid(string name)
    {
        var vid = Regex.Match(name, "VID_([0-9A-Fa-f]{4})");
        var pid = Regex.Match(name, "PID_([0-9A-Fa-f]{4})");
        return (
            vid.Success ? Convert.ToUInt32(vid.Groups[1].Value, 16) : null,
            pid.Success ? Convert.ToUInt32(pid.Groups[1].Value, 16) : null
        );
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputDeviceList(IntPtr pRawInputDeviceList, ref uint puiNumDevices, uint cbSize);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint GetRawInputDeviceInfo(IntPtr hDevice, uint uiCommand, IntPtr pData, ref uint pcbSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices([In] RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);
}

internal sealed record RawHidPreviewEvent(
    string type,
    string provider,
    string deviceId,
    DeviceInfoDto? device,
    long timestamp,
    int sizeHid,
    int reportCount,
    int reportIndex,
    int totalBytes,
    string rawPreviewHex,
    int? contactId,
    int? contactCount,
    double? x,
    double? y,
    string note);

internal sealed record MouseRawPreviewEvent(
    string type,
    string provider,
    string deviceId,
    DeviceInfoDto? device,
    long timestamp,
    int dx,
    int dy,
    ushort buttonFlags,
    string note);

internal sealed record PathPtpFrameEvent(
    string type,
    long timestamp,
    string deviceId,
    int contactCount,
    List<DecodedContact> contacts,
    bool buttonPressed)
{
    public static PathPtpFrameEvent From(DecodedTouchpadFrame frame) => new("ptpFrame", frame.timestamp, frame.deviceId, frame.contactCount, frame.contacts, frame.buttonPressed);
}

internal sealed record PathContactLifecycleEvent(
    string type,
    long timestamp,
    string deviceId,
    int contactId,
    int contactCount)
{
    public static bool TryFrom(object evt, out PathContactLifecycleEvent? result)
    {
        result = null;
        var eventType = evt.GetType();
        var type = eventType.GetProperty("type")?.GetValue(evt)?.ToString();
        if (type is not ("contactBegin" or "contactMove" or "contactEnd")) return false;
        var timestamp = eventType.GetProperty("timestamp")?.GetValue(evt);
        var deviceId = eventType.GetProperty("deviceId")?.GetValue(evt)?.ToString();
        var contactId = eventType.GetProperty("contactId")?.GetValue(evt);
        var contactCount = eventType.GetProperty("contactCount")?.GetValue(evt);
        if (timestamp is null || deviceId is null || contactId is null || contactCount is null) return false;
        result = new PathContactLifecycleEvent(type, Convert.ToInt64(timestamp), deviceId, Convert.ToInt32(contactId), Convert.ToInt32(contactCount));
        return true;
    }
}

internal sealed record PathRawMouseEvent(
    string type,
    long timestamp,
    string deviceId,
    string deviceClass,
    int dx,
    int dy,
    int wheel,
    int hWheel,
    ushort buttonFlags,
    string buttons,
    bool buttonDown,
    bool buttonUp)
{
    private const ushort RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001;
    private const ushort RI_MOUSE_LEFT_BUTTON_UP = 0x0002;
    private const ushort RI_MOUSE_RIGHT_BUTTON_DOWN = 0x0004;
    private const ushort RI_MOUSE_RIGHT_BUTTON_UP = 0x0008;
    private const ushort RI_MOUSE_MIDDLE_BUTTON_DOWN = 0x0010;
    private const ushort RI_MOUSE_MIDDLE_BUTTON_UP = 0x0020;
    private const ushort RI_MOUSE_BUTTON_4_DOWN = 0x0040;
    private const ushort RI_MOUSE_BUTTON_4_UP = 0x0080;
    private const ushort RI_MOUSE_BUTTON_5_DOWN = 0x0100;
    private const ushort RI_MOUSE_BUTTON_5_UP = 0x0200;
    private const ushort RI_MOUSE_WHEEL = 0x0400;
    private const ushort RI_MOUSE_HWHEEL = 0x0800;

    public static PathRawMouseEvent From(long timestamp, string deviceId, DeviceInfoDto? device, int dx, int dy, ushort flags, ushort buttonData)
    {
        var wheel = (flags & RI_MOUSE_WHEEL) != 0 ? unchecked((short)buttonData) : 0;
        var hWheel = (flags & RI_MOUSE_HWHEEL) != 0 ? unchecked((short)buttonData) : 0;
        var buttonDown = (flags & (RI_MOUSE_LEFT_BUTTON_DOWN | RI_MOUSE_RIGHT_BUTTON_DOWN | RI_MOUSE_MIDDLE_BUTTON_DOWN | RI_MOUSE_BUTTON_4_DOWN | RI_MOUSE_BUTTON_5_DOWN)) != 0;
        var buttonUp = (flags & (RI_MOUSE_LEFT_BUTTON_UP | RI_MOUSE_RIGHT_BUTTON_UP | RI_MOUSE_MIDDLE_BUTTON_UP | RI_MOUSE_BUTTON_4_UP | RI_MOUSE_BUTTON_5_UP)) != 0;
        return new PathRawMouseEvent("rawMouse", timestamp, deviceId, RawInput.ClassifyMouseDevice(deviceId, device), dx, dy, wheel, hWheel, flags, ButtonNames(flags), buttonDown, buttonUp);
    }

    private static string ButtonNames(ushort flags)
    {
        var names = new List<string>();
        if ((flags & RI_MOUSE_LEFT_BUTTON_DOWN) != 0) names.Add("leftDown");
        if ((flags & RI_MOUSE_LEFT_BUTTON_UP) != 0) names.Add("leftUp");
        if ((flags & RI_MOUSE_RIGHT_BUTTON_DOWN) != 0) names.Add("rightDown");
        if ((flags & RI_MOUSE_RIGHT_BUTTON_UP) != 0) names.Add("rightUp");
        if ((flags & RI_MOUSE_MIDDLE_BUTTON_DOWN) != 0) names.Add("middleDown");
        if ((flags & RI_MOUSE_MIDDLE_BUTTON_UP) != 0) names.Add("middleUp");
        if ((flags & RI_MOUSE_BUTTON_4_DOWN) != 0) names.Add("x1Down");
        if ((flags & RI_MOUSE_BUTTON_4_UP) != 0) names.Add("x1Up");
        if ((flags & RI_MOUSE_BUTTON_5_DOWN) != 0) names.Add("x2Down");
        if ((flags & RI_MOUSE_BUTTON_5_UP) != 0) names.Add("x2Up");
        if ((flags & RI_MOUSE_WHEEL) != 0) names.Add("wheel");
        if ((flags & RI_MOUSE_HWHEEL) != 0) names.Add("hWheel");
        return names.Count == 0 ? "none" : string.Join(",", names);
    }
}

internal static class PrecisionTouchpadDecoder
{
    private static readonly Dictionary<string, HidDeviceDescriptor> descriptors = new();

    public static IEnumerable<object> Decode(DeviceInfoDto device, byte[] report, long timestamp, TouchpadContactTracker tracker)
    {
        var descriptor = GetDescriptor(device);
        if (!descriptor.canDecodeContacts)
        {
            yield return new { type = "decoderUnavailable", code = "HID_DESCRIPTOR_UNUSABLE", deviceId = device.deviceId, timestamp, reason = descriptor.error ?? "Descriptor does not expose required contact usages." };
            yield break;
        }

        DecodedTouchpadFrame? frame = null;
        object? decodeError = null;
        try
        {
            frame = descriptor.Decode(report, device.deviceId, timestamp);
        }
        catch (Exception error)
        {
            decodeError = new { type = "decoderError", code = "HID_DECODE_FAILED", deviceId = device.deviceId, timestamp, message = error.Message };
        }
        if (decodeError is not null) yield return decodeError;
        if (frame is null) yield break;

        yield return new
        {
            type = "touchpadFrame",
            provider = "raw-input-hid",
            deviceId = frame.deviceId,
            timestamp = frame.timestamp,
            reportId = frame.reportId,
            contactCount = frame.contactCount,
            scanTime = frame.scanTime,
            buttonPressed = frame.buttonPressed,
            contacts = frame.contacts
        };

        foreach (var lifecycleEvent in tracker.Update(frame)) yield return lifecycleEvent;
    }

    public static DecodedTouchpadFrame? DecodeFrame(DeviceInfoDto device, byte[] report, long timestamp)
    {
        var descriptor = GetDescriptor(device);
        if (!descriptor.canDecodeContacts) return null;
        return descriptor.Decode(report, device.deviceId, timestamp);
    }

    private static HidDeviceDescriptor GetDescriptor(DeviceInfoDto device)
    {
        if (descriptors.TryGetValue(device.deviceId, out var descriptor)) return descriptor;
        descriptor = HidDescriptorReader.Open(device);
        descriptors[device.deviceId] = descriptor;
        Program.Emit(new { type = "hidDescriptor", deviceId = device.deviceId, descriptor = descriptor.ToDiagnosticObject() });
        return descriptor;
    }
}

internal sealed class TouchpadContactTracker
{
    private readonly Dictionary<string, Dictionary<int, DecodedContact>> activeByDevice = new();

    public IEnumerable<object> Update(DecodedTouchpadFrame frame)
    {
        if (!activeByDevice.TryGetValue(frame.deviceId, out var active))
        {
            active = new Dictionary<int, DecodedContact>();
            activeByDevice[frame.deviceId] = active;
        }

        var current = frame.contacts.ToDictionary(contact => contact.id);
        foreach (var contact in frame.contacts)
        {
            var eventType = active.ContainsKey(contact.id) ? "contactMove" : "contactBegin";
            active[contact.id] = contact;
            yield return new
            {
                type = eventType,
                provider = "raw-input-hid",
                deviceId = frame.deviceId,
                timestamp = frame.timestamp,
                contactId = contact.id,
                contactCount = frame.contactCount,
                x = contact.x,
                y = contact.y,
                rawX = contact.rawX,
                rawY = contact.rawY,
                confidence = contact.confidence,
                pressure = contact.pressure
            };
        }

        foreach (var ended in active.Keys.Where(id => !current.ContainsKey(id)).ToList())
        {
            var previous = active[ended];
            active.Remove(ended);
            yield return new
            {
                type = "contactEnd",
                provider = "raw-input-hid",
                deviceId = frame.deviceId,
                timestamp = frame.timestamp,
                contactId = ended,
                contactCount = frame.contactCount,
                x = previous.x,
                y = previous.y,
                rawX = previous.rawX,
                rawY = previous.rawY
            };
        }
    }
}

internal sealed record DecodedTouchpadFrame(string deviceId, long timestamp, byte reportId, int contactCount, uint? scanTime, bool buttonPressed, List<DecodedContact> contacts);
internal sealed record DecodedContact(int id, double x, double y, uint rawX, uint rawY, bool tip, bool confidence, uint? pressure);

internal sealed class HidDeviceDescriptor
{
    private readonly IntPtr preparsedData;
    private readonly SafeFileHandle handle;
    private readonly List<HidValueCap> inputValues;
    private readonly List<HidButtonCap> inputButtons;
    private readonly Dictionary<ushort, ContactLayout> contactLayouts;
    private readonly HidValueCap? contactCountCap;
    private readonly HidValueCap? scanTimeCap;
    private readonly HidButtonCap? physicalButtonCap;

    public string? error { get; }
    public bool canDecodeContacts { get; }
    public ushort inputReportByteLength { get; }

    public HidDeviceDescriptor(SafeFileHandle handle, IntPtr preparsedData, HIDP_CAPS caps, List<HidValueCap> values, List<HidButtonCap> buttons, string? error = null)
    {
        this.handle = handle;
        this.preparsedData = preparsedData;
        inputValues = values;
        inputButtons = buttons;
        this.error = error;
        inputReportByteLength = caps.InputReportByteLength;
        contactLayouts = values
            .Where(cap => cap.linkUsagePage == 0x0D && cap.linkUsage == 0x22)
            .GroupBy(cap => cap.linkCollection)
            .Select(group => ContactLayout.From(group.Key, group.ToList(), buttons.Where(button => button.linkCollection == group.Key).ToList()))
            .Where(layout => layout is not null)
            .Cast<ContactLayout>()
            .ToDictionary(layout => layout.linkCollection);
        contactCountCap = values.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x54);
        scanTimeCap = values.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x56);
        physicalButtonCap = buttons.FirstOrDefault(cap => cap.usagePage == 0x09 && cap.usage == 0x01 && cap.linkCollection == 0);
        canDecodeContacts = error is null && contactLayouts.Count > 0 && contactLayouts.Values.Any(layout => layout.CanDecode);
    }

    public DecodedTouchpadFrame? Decode(byte[] report, string deviceId, long timestamp)
    {
        if (report.Length == 0) return null;
        var reportId = report[0];
        var contacts = new List<DecodedContact>();
        foreach (var layout in contactLayouts.Values.Where(layout => layout.CanDecode && layout.ReportMatches(reportId)))
        {
            var tip = GetButton(report, layout.tipButton);
            var contactId = GetValue(report, layout.contactId);
            var rawX = GetValue(report, layout.x);
            var rawY = GetValue(report, layout.y);
            if (!tip || contactId is null || rawX is null || rawY is null) continue;
            contacts.Add(new DecodedContact(
                (int)contactId.Value,
                Normalize(rawX.Value, layout.x!),
                Normalize(rawY.Value, layout.y!),
                rawX.Value,
                rawY.Value,
                tip,
                layout.confidenceButton is null || GetButton(report, layout.confidenceButton),
                layout.pressure is null ? null : GetValue(report, layout.pressure)
            ));
        }

        var contactCount = contactCountCap is null ? contacts.Count : (int)(GetValue(report, contactCountCap) ?? (uint)contacts.Count);
        var scanTime = scanTimeCap is null ? null : GetValue(report, scanTimeCap);
        var buttonPressed = GetButton(report, physicalButtonCap);
        return new DecodedTouchpadFrame(deviceId, timestamp, reportId, contactCount, scanTime, buttonPressed, contacts);
    }

    public object ToDiagnosticObject() => new
    {
        canDecodeContacts,
        error,
        inputReportByteLength,
        contactLayouts = contactLayouts.Values.Select(layout => layout.ToDiagnosticObject()),
        reportLevel = new
        {
            contactCount = contactCountCap?.ToDiagnosticObject(),
            scanTime = scanTimeCap?.ToDiagnosticObject(),
            physicalButton = physicalButtonCap?.ToDiagnosticObject()
        },
        valueCaps = inputValues.Select(cap => cap.ToDiagnosticObject()),
        buttonCaps = inputButtons.Select(cap => cap.ToDiagnosticObject())
    };

    private uint? GetValue(byte[] report, HidValueCap? cap)
    {
        if (cap is null) return null;
        var status = HidNative.HidP_GetUsageValue(0, cap.usagePage, cap.linkCollection, cap.usage, out var value, preparsedData, report, (uint)report.Length);
        return status == HidNative.HIDP_STATUS_SUCCESS ? value : null;
    }

    private bool GetButton(byte[] report, HidButtonCap? cap)
    {
        if (cap is null) return false;
        var usageLength = 16u;
        var usages = new ushort[usageLength];
        var status = HidNative.HidP_GetUsages(0, cap.usagePage, cap.linkCollection, usages, ref usageLength, preparsedData, report, (uint)report.Length);
        return status == HidNative.HIDP_STATUS_SUCCESS && usages.Take((int)usageLength).Contains(cap.usage);
    }

    private static double Normalize(uint value, HidValueCap cap)
    {
        var min = cap.logicalMin;
        var max = cap.logicalMax;
        if (max <= min) return 0;
        return Math.Clamp((value - min) / (double)(max - min), 0, 1);
    }
}

internal sealed record ContactLayout(
    ushort linkCollection,
    HidValueCap? contactId,
    HidValueCap? x,
    HidValueCap? y,
    HidValueCap? pressure,
    HidButtonCap? tipButton,
    HidButtonCap? confidenceButton)
{
    public bool CanDecode => contactId is not null && x is not null && y is not null && tipButton is not null;
    public bool ReportMatches(byte reportId) => new[] { contactId, x, y, pressure }.Where(cap => cap is not null).All(cap => cap!.reportId == reportId);

    public static ContactLayout? From(ushort linkCollection, List<HidValueCap> values, List<HidButtonCap> buttons)
    {
        return new ContactLayout(
            linkCollection,
            values.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x51),
            values.FirstOrDefault(cap => cap.usagePage == 0x01 && cap.usage == 0x30),
            values.FirstOrDefault(cap => cap.usagePage == 0x01 && cap.usage == 0x31),
            values.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x30),
            buttons.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x42),
            buttons.FirstOrDefault(cap => cap.usagePage == 0x0D && cap.usage == 0x47)
        );
    }

    public object ToDiagnosticObject() => new
    {
        linkCollection,
        canDecode = CanDecode,
        contactId = contactId?.ToDiagnosticObject(),
        x = x?.ToDiagnosticObject(),
        y = y?.ToDiagnosticObject(),
        pressure = pressure?.ToDiagnosticObject(),
        tip = tipButton?.ToDiagnosticObject(),
        confidence = confidenceButton?.ToDiagnosticObject()
    };
}

internal static class HidDescriptorReader
{
    public static object DescribeDevice(DeviceInfoDto device) => Open(device).ToDiagnosticObject();

    public static HidDeviceDescriptor Open(DeviceInfoDto device)
    {
        Program.Emit(new { type = "descriptorDebug", step = "createFile", deviceId = device.deviceId });
        var handle = HidNative.CreateFile(device.deviceName, 0, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE, IntPtr.Zero, HidNative.OPEN_EXISTING, 0, IntPtr.Zero);
        if (handle.IsInvalid) return Empty(handle, $"CreateFile failed: {Marshal.GetLastWin32Error()}");
        Program.Emit(new { type = "descriptorDebug", step = "getPreparsedData", deviceId = device.deviceId });
        if (!HidNative.HidD_GetPreparsedData(handle, out var preparsedData)) return Empty(handle, $"HidD_GetPreparsedData failed: {Marshal.GetLastWin32Error()}");
        Program.Emit(new { type = "descriptorDebug", step = "getCaps", deviceId = device.deviceId });
        var status = HidNative.HidP_GetCaps(preparsedData, out var caps);
        if (status != HidNative.HIDP_STATUS_SUCCESS) return new HidDeviceDescriptor(handle, preparsedData, new HIDP_CAPS(), [], [], $"HidP_GetCaps failed: 0x{status:X8}");
        Program.Emit(new { type = "descriptorDebug", step = "getValueButtonCaps", deviceId = device.deviceId, caps.NumberInputValueCaps, caps.NumberInputButtonCaps, caps.InputReportByteLength });
        return new HidDeviceDescriptor(handle, preparsedData, caps, ReadValueCaps(preparsedData, caps), ReadButtonCaps(preparsedData, caps));
    }

    private static HidDeviceDescriptor Empty(SafeFileHandle handle, string error) => new(handle, IntPtr.Zero, new HIDP_CAPS(), [], [], error);

    private static List<HidValueCap> ReadValueCaps(IntPtr preparsedData, HIDP_CAPS caps)
    {
        var length = caps.NumberInputValueCaps;
        if (length == 0) return [];
        var stride = Marshal.SizeOf<HIDP_VALUE_CAPS>();
        var allocationStride = Math.Max(stride, 128);
        var buffer = Marshal.AllocHGlobal(allocationStride * length);
        try
        {
            var status = HidNative.HidP_GetValueCaps(0, buffer, ref length, preparsedData);
            if (status != HidNative.HIDP_STATUS_SUCCESS) return [];
            var result = new List<HidValueCap>();
            for (var index = 0; index < length; index += 1) result.Add(HidValueCap.From(Marshal.PtrToStructure<HIDP_VALUE_CAPS>(IntPtr.Add(buffer, stride * index))));
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static List<HidButtonCap> ReadButtonCaps(IntPtr preparsedData, HIDP_CAPS caps)
    {
        var length = caps.NumberInputButtonCaps;
        if (length == 0) return [];
        var stride = Marshal.SizeOf<HIDP_BUTTON_CAPS>();
        var allocationStride = Math.Max(stride, 128);
        var buffer = Marshal.AllocHGlobal(allocationStride * length);
        try
        {
            var status = HidNative.HidP_GetButtonCaps(0, buffer, ref length, preparsedData);
            if (status != HidNative.HIDP_STATUS_SUCCESS) return [];
            var result = new List<HidButtonCap>();
            for (var index = 0; index < length; index += 1) result.Add(HidButtonCap.From(Marshal.PtrToStructure<HIDP_BUTTON_CAPS>(IntPtr.Add(buffer, stride * index))));
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}

internal static class ElanCollectionDiagnostics
{
    private const ushort DigitizerPage = 0x0D;
    private const ushort PrecisionTouchpadUsage = 0x05;
    private const ushort ConfigurationUsage = 0x0E;
    private const ushort InputModeUsage = 0x52;
    private const ushort SurfaceSwitchUsage = 0x57;
    private const ushort ButtonSwitchUsage = 0x58;

    public static object Describe()
    {
        var devices = RawInput.EnumerateDevices()
            .Where(device => device.deviceName.Contains("ELAN012F", StringComparison.OrdinalIgnoreCase))
            .ToList();

        return new
        {
            type = "elanCollectionDiagnostics",
            warning = "Read-only diagnostic. No HID feature reports are written.",
            collectionCount = devices.Count,
            configurationCollectionFound = devices.Any(device => device.usagePage == DigitizerPage && device.usage == ConfigurationUsage),
            precisionTouchpadCollectionFound = devices.Any(device => device.usagePage == DigitizerPage && device.usage == PrecisionTouchpadUsage),
            mouseCompatibleCollectionFound = devices.Any(device => device.rawType == "RIM_TYPEMOUSE"),
            collections = devices.Select(DescribeCollection)
        };
    }

    private static object DescribeCollection(DeviceInfoDto device)
    {
        var access = new
        {
            descriptorOpen = TestOpen(device.deviceName, 0, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE),
            readOpen = TestOpen(device.deviceName, HidNative.GENERIC_READ, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE),
            writeOpen = TestOpen(device.deviceName, HidNative.GENERIC_WRITE, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE),
            readWriteOpen = TestOpen(device.deviceName, HidNative.GENERIC_READ | HidNative.GENERIC_WRITE, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE),
            exclusiveProbe = TestOpen(device.deviceName, 0, 0)
        };

        if (device.rawType != "RIM_TYPEHID")
        {
            return new
            {
                device,
                role = Role(device),
                access,
                descriptor = (object?)null,
                note = "Raw Input mouse collection has no HID top-level descriptor through this path."
            };
        }

        var descriptor = ReadHidCollection(device);
        return new
        {
            device,
            role = Role(device),
            access,
            descriptor
        };
    }

    private static object ReadHidCollection(DeviceInfoDto device)
    {
        using var handle = HidNative.CreateFile(device.deviceName, 0, HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE, IntPtr.Zero, HidNative.OPEN_EXISTING, 0, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            return new { openReadDescriptorSucceeded = false, error = $"CreateFile(descriptor access) failed: {Marshal.GetLastWin32Error()}" };
        }

        if (!HidNative.HidD_GetPreparsedData(handle, out var preparsedData))
        {
            return new { openReadDescriptorSucceeded = true, preparsedSucceeded = false, error = $"HidD_GetPreparsedData failed: {Marshal.GetLastWin32Error()}" };
        }

        try
        {
            var status = HidNative.HidP_GetCaps(preparsedData, out var caps);
            if (status != HidNative.HIDP_STATUS_SUCCESS)
            {
                return new { openReadDescriptorSucceeded = true, preparsedSucceeded = true, error = $"HidP_GetCaps failed: 0x{status:X8}" };
            }

            var inputValues = ReadValueCaps(preparsedData, caps.NumberInputValueCaps, 0);
            var inputButtons = ReadButtonCaps(preparsedData, caps.NumberInputButtonCaps, 0);
            var outputValues = ReadValueCaps(preparsedData, caps.NumberOutputValueCaps, 1);
            var outputButtons = ReadButtonCaps(preparsedData, caps.NumberOutputButtonCaps, 1);
            var featureValues = ReadValueCaps(preparsedData, caps.NumberFeatureValueCaps, 2);
            var featureButtons = ReadButtonCaps(preparsedData, caps.NumberFeatureButtonCaps, 2);
            var relevantFeatureValues = featureValues
                .Where(cap => cap.usagePage == DigitizerPage && (cap.usage == InputModeUsage || cap.usage == SurfaceSwitchUsage || cap.usage == ButtonSwitchUsage))
                .ToList();

            return new
            {
                openReadDescriptorSucceeded = true,
                preparsedSucceeded = true,
                caps = new
                {
                    caps.UsagePage,
                    caps.Usage,
                    caps.InputReportByteLength,
                    caps.OutputReportByteLength,
                    caps.FeatureReportByteLength,
                    caps.NumberInputValueCaps,
                    caps.NumberInputButtonCaps,
                    caps.NumberOutputValueCaps,
                    caps.NumberOutputButtonCaps,
                    caps.NumberFeatureValueCaps,
                    caps.NumberFeatureButtonCaps
                },
                inputValues = inputValues.Select(cap => cap.ToDiagnosticObject()),
                inputButtons = inputButtons.Select(cap => cap.ToDiagnosticObject()),
                outputValues = outputValues.Select(cap => cap.ToDiagnosticObject()),
                outputButtons = outputButtons.Select(cap => cap.ToDiagnosticObject()),
                featureValues = featureValues.Select(cap => cap.ToDiagnosticObject()),
                featureButtons = featureButtons.Select(cap => cap.ToDiagnosticObject()),
                relevantFeatureValues = relevantFeatureValues.Select(cap => new
                {
                    name = FeatureName(cap.usage),
                    cap = cap.ToDiagnosticObject(),
                    read = TryReadFeature(handle, preparsedData, caps.FeatureReportByteLength, cap)
                }),
                setFeature = new
                {
                    available = true,
                    tested = false,
                    note = "HidD_SetFeature exists but is intentionally not called by this diagnostic."
                }
            };
        }
        finally
        {
            HidNative.HidD_FreePreparsedData(preparsedData);
        }
    }

    private static object TryReadFeature(SafeFileHandle handle, IntPtr preparsedData, ushort featureReportByteLength, HidValueCap cap)
    {
        if (featureReportByteLength == 0)
        {
            return new { succeeded = false, reason = "FeatureReportByteLength is zero." };
        }

        var report = new byte[featureReportByteLength];
        report[0] = cap.reportId;
        if (!HidNative.HidD_GetFeature(handle, report, report.Length))
        {
            return new { succeeded = false, error = Marshal.GetLastWin32Error(), reportId = cap.reportId };
        }

        var status = HidNative.HidP_GetUsageValue(2, cap.usagePage, cap.linkCollection, cap.usage, out var value, preparsedData, report, (uint)report.Length);
        return new
        {
            succeeded = true,
            reportId = cap.reportId,
            rawHex = Convert.ToHexString(report),
            parsed = status == HidNative.HIDP_STATUS_SUCCESS,
            value = status == HidNative.HIDP_STATUS_SUCCESS ? value : (uint?)null,
            parseStatus = $"0x{status:X8}"
        };
    }

    private static List<HidValueCap> ReadValueCaps(IntPtr preparsedData, ushort capCount, int reportType)
    {
        var length = capCount;
        if (length == 0) return [];
        var stride = Marshal.SizeOf<HIDP_VALUE_CAPS>();
        var allocationStride = Math.Max(stride, 128);
        var buffer = Marshal.AllocHGlobal(allocationStride * length);
        try
        {
            var status = HidNative.HidP_GetValueCaps(reportType, buffer, ref length, preparsedData);
            if (status != HidNative.HIDP_STATUS_SUCCESS) return [];
            var result = new List<HidValueCap>();
            for (var index = 0; index < length; index += 1) result.Add(HidValueCap.From(Marshal.PtrToStructure<HIDP_VALUE_CAPS>(IntPtr.Add(buffer, stride * index))));
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static List<HidButtonCap> ReadButtonCaps(IntPtr preparsedData, ushort capCount, int reportType)
    {
        var length = capCount;
        if (length == 0) return [];
        var stride = Marshal.SizeOf<HIDP_BUTTON_CAPS>();
        var allocationStride = Math.Max(stride, 128);
        var buffer = Marshal.AllocHGlobal(allocationStride * length);
        try
        {
            var status = HidNative.HidP_GetButtonCaps(reportType, buffer, ref length, preparsedData);
            if (status != HidNative.HIDP_STATUS_SUCCESS) return [];
            var result = new List<HidButtonCap>();
            for (var index = 0; index < length; index += 1) result.Add(HidButtonCap.From(Marshal.PtrToStructure<HIDP_BUTTON_CAPS>(IntPtr.Add(buffer, stride * index))));
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static object TestOpen(string deviceName, uint desiredAccess, uint shareMode)
    {
        using var handle = HidNative.CreateFile(deviceName, desiredAccess, shareMode, IntPtr.Zero, HidNative.OPEN_EXISTING, 0, IntPtr.Zero);
        var error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
        return new
        {
            desiredAccess = AccessName(desiredAccess),
            shareMode = ShareName(shareMode),
            succeeded = !handle.IsInvalid,
            error
        };
    }

    private static string Role(DeviceInfoDto device)
    {
        if (device.rawType == "RIM_TYPEMOUSE") return "Mouse-compatible collection";
        if (device.usagePage == DigitizerPage && device.usage == PrecisionTouchpadUsage) return "Windows Precision Touchpad collection";
        if (device.usagePage == DigitizerPage && device.usage == ConfigurationUsage) return "Precision Touchpad Configuration collection";
        if (device.usagePage == DigitizerPage) return $"Digitizer collection Usage 0x{device.usage:X2}";
        return device.rawType == "RIM_TYPEHID" ? $"HID collection UsagePage 0x{device.usagePage:X2} Usage 0x{device.usage:X2}" : device.classification;
    }

    private static string FeatureName(ushort usage) => usage switch
    {
        InputModeUsage => "Input Mode",
        SurfaceSwitchUsage => "Surface Switch",
        ButtonSwitchUsage => "Button Switch",
        _ => $"Usage 0x{usage:X2}"
    };

    private static string AccessName(uint access) => access switch
    {
        0 => "none",
        HidNative.GENERIC_READ => "GENERIC_READ",
        HidNative.GENERIC_WRITE => "GENERIC_WRITE",
        HidNative.GENERIC_READ | HidNative.GENERIC_WRITE => "GENERIC_READ|GENERIC_WRITE",
        _ => $"0x{access:X8}"
    };

    private static string ShareName(uint share) => share switch
    {
        0 => "none",
        HidNative.FILE_SHARE_READ => "FILE_SHARE_READ",
        HidNative.FILE_SHARE_WRITE => "FILE_SHARE_WRITE",
        HidNative.FILE_SHARE_READ | HidNative.FILE_SHARE_WRITE => "FILE_SHARE_READ|FILE_SHARE_WRITE",
        _ => $"0x{share:X8}"
    };
}

internal sealed record HidValueCap(byte reportId, ushort usagePage, ushort usage, ushort linkCollection, ushort linkUsagePage, ushort linkUsage, ushort bitSize, ushort reportCount, int logicalMin, int logicalMax)
{
    public static HidValueCap From(HIDP_VALUE_CAPS cap) => new(cap.ReportID, cap.UsagePage, cap.NotRangeUsage, cap.LinkCollection, cap.LinkUsagePage, cap.LinkUsage, cap.BitSize, cap.ReportCount, cap.LogicalMin, cap.LogicalMax);
    public object ToDiagnosticObject() => new { reportId, usagePage, usage, linkCollection, linkUsagePage, linkUsage, bitSize, reportCount, logicalMin, logicalMax };
}

internal sealed record HidButtonCap(byte reportId, ushort usagePage, ushort usage, ushort linkCollection, ushort linkUsagePage, ushort linkUsage)
{
    public static HidButtonCap From(HIDP_BUTTON_CAPS cap) => new(cap.ReportID, cap.UsagePage, cap.NotRangeUsage, cap.LinkCollection, cap.LinkUsagePage, cap.LinkUsage);
    public object ToDiagnosticObject() => new { reportId, usagePage, usage, linkCollection, linkUsagePage, linkUsage };
}

internal sealed record DeviceInfoDto(
    string deviceId,
    long handle,
    string deviceName,
    string rawType,
    uint? vendorId,
    uint? productId,
    ushort? usagePage,
    ushort? usage,
    string classification,
    string classificationReason
);

[StructLayout(LayoutKind.Sequential)]
internal struct RAWINPUTDEVICELIST
{
    public IntPtr hDevice;
    public uint dwType;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RAWINPUTDEVICE
{
    public ushort usUsagePage;
    public ushort usUsage;
    public int dwFlags;
    public IntPtr hwndTarget;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RAWINPUTHEADER
{
    public uint dwType;
    public uint dwSize;
    public IntPtr hDevice;
    public IntPtr wParam;
}

[StructLayout(LayoutKind.Explicit, Size = 32)]
internal struct RID_DEVICE_INFO
{
    [FieldOffset(0)] public uint cbSize;
    [FieldOffset(4)] public uint dwType;
    [FieldOffset(8)] public RID_DEVICE_INFO_MOUSE mouse;
    [FieldOffset(8)] public RID_DEVICE_INFO_HID hid;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RID_DEVICE_INFO_MOUSE
{
    public uint dwId;
    public uint dwNumberOfButtons;
    public uint dwSampleRate;
    public int fHasHorizontalWheel;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RID_DEVICE_INFO_HID
{
    public uint dwVendorId;
    public uint dwProductId;
    public uint dwVersionNumber;
    public ushort usUsagePage;
    public ushort usUsage;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RAWMOUSE
{
    public ushort usFlags;
    public ushort usButtonFlags;
    public ushort usButtonData;
    public ushort padding;
    public uint ulRawButtons;
    public int lLastX;
    public int lLastY;
    public uint ulExtraInformation;
}

internal static class HidNative
{
    public const uint HIDP_STATUS_SUCCESS = 0x00110000;
    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 0x00000001;
    public const uint FILE_SHARE_WRITE = 0x00000002;
    public const uint OPEN_EXISTING = 3;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern SafeFileHandle CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_GetPreparsedData(SafeFileHandle hidDeviceObject, out IntPtr preparsedData);

    [DllImport("hid.dll")]
    public static extern bool HidD_FreePreparsedData(IntPtr preparsedData);

    [DllImport("hid.dll")]
    public static extern uint HidP_GetCaps(IntPtr preparsedData, out HIDP_CAPS capabilities);

    [DllImport("hid.dll")]
    public static extern uint HidP_GetValueCaps(int reportType, IntPtr valueCaps, ref ushort valueCapsLength, IntPtr preparsedData);

    [DllImport("hid.dll")]
    public static extern uint HidP_GetButtonCaps(int reportType, IntPtr buttonCaps, ref ushort buttonCapsLength, IntPtr preparsedData);

    [DllImport("hid.dll", SetLastError = true)]
    public static extern bool HidD_GetFeature(SafeFileHandle hidDeviceObject, [Out] byte[] reportBuffer, int reportBufferLength);

    [DllImport("hid.dll")]
    public static extern uint HidP_GetUsageValue(
        int reportType,
        ushort usagePage,
        ushort linkCollection,
        ushort usage,
        out uint usageValue,
        IntPtr preparsedData,
        byte[] report,
        uint reportLength);

    [DllImport("hid.dll")]
    public static extern uint HidP_GetUsages(
        int reportType,
        ushort usagePage,
        ushort linkCollection,
        [Out] ushort[] usageList,
        ref uint usageLength,
        IntPtr preparsedData,
        byte[] report,
        uint reportLength);
}

[StructLayout(LayoutKind.Sequential)]
internal struct HIDP_CAPS
{
    public ushort Usage;
    public ushort UsagePage;
    public ushort InputReportByteLength;
    public ushort OutputReportByteLength;
    public ushort FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes;
    public ushort NumberInputButtonCaps;
    public ushort NumberInputValueCaps;
    public ushort NumberInputDataIndices;
    public ushort NumberOutputButtonCaps;
    public ushort NumberOutputValueCaps;
    public ushort NumberOutputDataIndices;
    public ushort NumberFeatureButtonCaps;
    public ushort NumberFeatureValueCaps;
    public ushort NumberFeatureDataIndices;
}

[StructLayout(LayoutKind.Sequential)]
internal struct HIDP_VALUE_CAPS
{
    public ushort UsagePage;
    public byte ReportID;
    [MarshalAs(UnmanagedType.U1)] public bool IsAlias;
    public ushort BitField;
    public ushort LinkCollection;
    public ushort LinkUsage;
    public ushort LinkUsagePage;
    [MarshalAs(UnmanagedType.U1)] public bool IsRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsStringRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsDesignatorRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsAbsolute;
    [MarshalAs(UnmanagedType.U1)] public bool HasNull;
    public byte Reserved;
    public ushort BitSize;
    public ushort ReportCount;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 5)] public ushort[] Reserved2;
    public uint UnitsExp;
    public uint Units;
    public int LogicalMin;
    public int LogicalMax;
    public int PhysicalMin;
    public int PhysicalMax;
    public ushort RangeUsageMin;
    public ushort RangeUsageMax;
    public ushort RangeStringMin;
    public ushort RangeStringMax;
    public ushort RangeDesignatorMin;
    public ushort RangeDesignatorMax;
    public ushort RangeDataIndexMin;
    public ushort RangeDataIndexMax;

    public ushort NotRangeUsage => IsRange ? RangeUsageMin : RangeUsageMin;
}

[StructLayout(LayoutKind.Sequential)]
internal struct HIDP_BUTTON_CAPS
{
    public ushort UsagePage;
    public byte ReportID;
    [MarshalAs(UnmanagedType.U1)] public bool IsAlias;
    public ushort BitField;
    public ushort LinkCollection;
    public ushort LinkUsage;
    public ushort LinkUsagePage;
    [MarshalAs(UnmanagedType.U1)] public bool IsRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsStringRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsDesignatorRange;
    [MarshalAs(UnmanagedType.U1)] public bool IsAbsolute;
    public ushort ReportCount;
    public ushort Reserved2;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 9)] public uint[] Reserved;
    public ushort RangeUsageMin;
    public ushort RangeUsageMax;
    public ushort RangeStringMin;
    public ushort RangeStringMax;
    public ushort RangeDesignatorMin;
    public ushort RangeDesignatorMax;
    public ushort RangeDataIndexMin;
    public ushort RangeDataIndexMax;

    public ushort NotRangeUsage => IsRange ? RangeUsageMin : RangeUsageMin;
}
