// Emoji Picker's Windows-only companion. No window titles, text, clipboard
// contents or key values cross its pipe. Hooks are installed only while open.
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class WindowsBridge
{
    const uint CommandMessage = 0x8001, WM_TIMER = 0x113;
    const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
    static readonly UIntPtr PasteTag = new UIntPtr(0x45504B52);
    static readonly Stopwatch uptime = Stopwatch.StartNew();
    static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
    static readonly ConcurrentQueue<string> output = new ConcurrentQueue<string>();
    static readonly AutoResetEvent outputReady = new AutoResetEvent(false);
    static readonly HookProc keyboardCallback = KeyboardHook, mouseCallback = MouseHook;
    static IntPtr keyboardHook, mouseHook, picker, target, targetFocus;
    static uint threadId, parentPid, targetPid, targetThread, targetFocusThread;
    static long session;
    static bool visible, typingArmed, closing, targetFocusRestored;
    static int shortcutKey = 0x45, shortcutModifiers = 5;
    static UIntPtr timer;
    static PendingPaste pending;
    sealed class PendingPaste { internal string Id; internal long Session; internal long Deadline; internal bool FocusRestored; internal bool Sent; internal long ReadyAt; internal long CompleteAt; }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 1 || !uint.TryParse(args[0], out parentPid)) return 2;
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { return 3; }
        threadId = GetCurrentThreadId();
        MSG message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create the message queue before accepting pipe commands.
        var writer = new Thread(WriteOutput) { IsBackground = true }; writer.Start();
        var reader = new Thread(ReadCommands) { IsBackground = true }; reader.Start();
        Process parent;
        try { parent = Process.GetProcessById((int)parentPid); parent.EnableRaisingEvents = true; }
        catch { return 4; }
        parent.Exited += delegate { PostThreadMessage(threadId, 0x12, UIntPtr.Zero, IntPtr.Zero); };
        if (parent.HasExited) return 0;
        Emit("{\"event\":\"ready\"}");
        try {
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
                if (message.message == CommandMessage) {
                    string command;
                    while (commands.TryDequeue(out command)) Dispatch(command);
                } else if (message.message == WM_TIMER) AdvancePaste();
                else { TranslateMessage(ref message); DispatchMessage(ref message); }
            }
        } finally {
            EndSession();
            parent.Dispose();
            closing = true; outputReady.Set(); writer.Join(300);
        }
        return 0;
    }

    static void ReadCommands()
    {
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                if (line.Length > 256) continue;
                commands.Enqueue(line); PostThreadMessage(threadId, CommandMessage, UIntPtr.Zero, IntPtr.Zero);
            }
        } catch { }
        PostThreadMessage(threadId, 0x12, UIntPtr.Zero, IntPtr.Zero);
    }
    static void WriteOutput()
    {
        try {
            do {
                outputReady.WaitOne(); string line;
                while (output.TryDequeue(out line)) Console.Out.WriteLine(line);
                Console.Out.Flush();
            } while (!closing);
        } catch { PostThreadMessage(threadId, 0x12, UIntPtr.Zero, IntPtr.Zero); }
    }
    static void Emit(string value) { output.Enqueue(value); outputReady.Set(); }
    static void Reply(string id, bool ok, string reason)
    { Emit("{\"id\":" + id + ",\"ok\":" + (ok ? "true" : "false") + ",\"reason\":\"" + reason + "\"}"); }
    static void Signal(string kind)
    { Emit("{\"event\":\"" + kind + "\",\"session\":" + session + "}"); }

    static void Dispatch(string line)
    {
        var fields = line.Split('\t');
        int requestId;
        if (fields.Length < 2 || !int.TryParse(fields[0], out requestId) || requestId < 1) return;
        string id = fields[0];
        try {
            switch (fields[1]) {
                case "begin":
                    EndSession();
                    if (fields.Length != 4) { Reply(id, false, "invalid"); break; }
                    session = long.Parse(fields[2]); picker = new IntPtr(long.Parse(fields[3]));
                    uint owner; GetWindowThreadProcessId(picker, out owner);
                    if (owner != parentPid || !IsWindow(picker)) { Reply(id, false, "invalid-window"); break; }
                    var foreground = GetForegroundWindow();
                    if (AllowedTarget(foreground)) CaptureTarget(foreground);
                    keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardCallback, GetModuleHandle(null), 0);
                    mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseCallback, GetModuleHandle(null), 0);
                    if (keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero) { EndSession(); Reply(id, false, "hooks-unavailable"); break; }
                    visible = true;
                    Reply(id, true, target == IntPtr.Zero ? "no-target" : "captured");
                    break;
                case "end":
                    if (fields.Length == 3 && long.Parse(fields[2]) == session) EndSession();
                    Reply(id, true, "ended"); break;
                case "shortcut":
                    if (fields.Length != 4) { Reply(id, false, "invalid"); break; }
                    shortcutKey = int.Parse(fields[2]); shortcutModifiers = int.Parse(fields[3]);
                    Reply(id, true, "configured"); break;
                case "paste":
                    if (fields.Length != 3 || long.Parse(fields[2]) != session || !visible || pending != null) { Reply(id, false, "cancelled"); break; }
                    if (!TargetAlive()) { Reply(id, false, "no-target"); break; }
                    if (!CanInject(targetPid)) { Reply(id, false, "integrity-blocked"); break; }
                    if (IsHungAppWindow(target)) { Reply(id, false, "target-busy"); break; }
                    // Never redirect a queued insertion after the user has switched elsewhere.
                    var current = GetForegroundWindow();
                    if (!PickerOwns(current) && current != target) { Reply(id, false, "focus-changed"); break; }
                    pending = new PendingPaste { Id = id, Session = session, Deadline = uptime.ElapsedMilliseconds + 500 };
                    typingArmed = false;
                    if (IsIconic(target)) ShowWindowAsync(target, 9);
                    SetForegroundWindow(target); // Respect Windows foreground/UIPI restrictions; no bypass tricks.
                    timer = SetTimer(IntPtr.Zero, UIntPtr.Zero, 10, IntPtr.Zero);
                    if (timer == UIntPtr.Zero) FinishPaste(false, "blocked"); else AdvancePaste();
                    break;
                case "quit": EndSession(); Reply(id, true, "quit"); PostQuitMessage(0); break;
                default: Reply(id, false, "invalid"); break;
            }
        } catch { Reply(id, false, "unavailable"); }
    }

    static bool AllowedTarget(IntPtr handle)
    {
        if (handle == IntPtr.Zero || !IsWindow(handle) || !IsWindowVisible(handle) || PickerOwns(handle)) return false;
        if (handle == GetShellWindow() || handle == GetDesktopWindow()) return false;
        uint pid; GetWindowThreadProcessId(handle, out pid);
        if (pid == parentPid || pid == (uint)Process.GetCurrentProcess().Id) return false;
        var className = new StringBuilder(128); GetClassName(handle, className, className.Capacity);
        if (className.ToString() == "Shell_TrayWnd" || className.ToString() == "Shell_SecondaryTrayWnd" || className.ToString() == "WorkerW" || className.ToString() == "Progman") return false;
        try {
            using (var process = Process.GetProcessById((int)pid)) {
                string name = process.ProcessName;
                if (name.Equals("WindowsBridge", StringComparison.OrdinalIgnoreCase)) return false;
            }
        } catch { return false; }
        return true;
    }
    static void CaptureTarget(IntPtr foreground)
    {
        target = foreground;
        targetFocusRestored = false;
        targetThread = GetWindowThreadProcessId(target, out targetPid);
        targetFocus = IntPtr.Zero; targetFocusThread = 0;
        var info = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
        if (targetThread != 0 && GetGUIThreadInfo(targetThread, ref info) && FocusBelongs(info.hwndFocus)) {
            uint focusPid;
            targetFocusThread = GetWindowThreadProcessId(info.hwndFocus, out focusPid);
            if (focusPid != 0 && CanInject(focusPid)) targetFocus = info.hwndFocus;
        }
    }
    static bool FocusBelongs(IntPtr handle)
    {
        return handle != IntPtr.Zero && IsWindow(handle) && (GetAncestor(handle, 2) == target || GetAncestor(handle, 3) == target);
    }
    static void RestoreTargetFocus()
    {
        if (!FocusBelongs(targetFocus) || targetFocusThread == 0) return;
        uint current = GetCurrentThreadId();
        bool targetAttached = targetThread != 0 && targetThread != current && AttachThreadInput(current, targetThread, true);
        bool focusAttached = targetFocusThread != current && targetFocusThread != targetThread && AttachThreadInput(current, targetFocusThread, true);
        try { SetFocus(targetFocus); }
        finally {
            if (focusAttached) AttachThreadInput(current, targetFocusThread, false);
            if (targetAttached) AttachThreadInput(current, targetThread, false);
        }
    }
    static bool PickerOwns(IntPtr handle)
    {
        uint pid; GetWindowThreadProcessId(handle, out pid);
        return handle == picker || pid == parentPid || GetAncestor(handle, 3) == picker;
    }
    static bool TargetAlive()
    {
        uint pid; GetWindowThreadProcessId(target, out pid);
        return target != IntPtr.Zero && IsWindow(target) && pid == targetPid;
    }
    static bool CanInject(uint pid)
    {
        int own = Integrity((uint)Process.GetCurrentProcess().Id), other = Integrity(pid);
        return own >= 0 && other >= 0 && other <= own;
    }
    static int Integrity(uint pid)
    {
        IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero, buffer = IntPtr.Zero;
        if (process == IntPtr.Zero) return -1;
        try {
            if (!OpenProcessToken(process, 8, out token)) return -1;
            int length; GetTokenInformation(token, 25, IntPtr.Zero, 0, out length);
            if (length <= 0) return -1;
            buffer = Marshal.AllocHGlobal(length);
            if (!GetTokenInformation(token, 25, buffer, length, out length)) return -1;
            IntPtr sid = Marshal.ReadIntPtr(buffer);
            byte count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
            return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
        } finally { if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    static bool KeyDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static int Modifiers() { return (KeyDown(0x11) ? 1 : 0) | (KeyDown(0x12) ? 2 : 0) | (KeyDown(0x10) ? 4 : 0); }
    static bool IsModifier(uint key) { return key == 0x10 || key == 0x11 || key == 0x12 || key == 0x5B || key == 0x5C || (key >= 0xA0 && key <= 0xA5); }

    static void AdvancePaste()
    {
        if (pending == null) return;
        long now = uptime.ElapsedMilliseconds;
        if (!visible || pending.Session != session || !TargetAlive()) { FinishPaste(false, "cancelled"); return; }
        if (pending.Sent) {
            if (now >= pending.CompleteAt) FinishPaste(true, "sent");
            return;
        }
        if (now > pending.Deadline) { FinishPaste(false, GetForegroundWindow() == target ? "modifiers-held" : "focus-blocked"); return; }
        if (GetForegroundWindow() != target) return;
        if (!pending.FocusRestored) {
            if (!targetFocusRestored) {
                RestoreTargetFocus();
                targetFocusRestored = true;
            }
            pending.FocusRestored = true;
            pending.ReadyAt = now + 25;
            return;
        }
        if (now < pending.ReadyAt) return;
        // Wait briefly for any physically held modifiers/selection Enter key. Never
        // release or alter the user's own keys to manufacture a paste combination.
        if (Modifiers() != 0 || KeyDown(0x5B) || KeyDown(0x5C) || KeyDown(0x0D)) return;
        var input = new INPUT[] { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) };
        uint sent = SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(INPUT)));
        if (sent != input.Length) {
            if (sent > 0) SendInput(2, new INPUT[] { Key(0x56, true), Key(0x11, true) }, Marshal.SizeOf(typeof(INPUT)));
            FinishPaste(false, "input-blocked"); return;
        }
        pending.Sent = true;
        // A short, nonblocking consumption interval keeps the next clipboard write
        // behind the target's queued Ctrl+V. No timer runs outside an insertion.
        pending.CompleteAt = now + 40;
        typingArmed = true;
    }
    static INPUT Key(ushort key, bool up)
    { return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { wVk = key, dwFlags = up ? 2U : 0, dwExtraInfo = PasteTag } } }; }
    static void FinishPaste(bool ok, string reason)
    {
        var operation = pending; pending = null;
        if (timer != UIntPtr.Zero) { KillTimer(IntPtr.Zero, timer); timer = UIntPtr.Zero; }
        if (visible && operation != null && operation.Sent && GetForegroundWindow() == target) typingArmed = true;
        if (operation != null) Reply(operation.Id, ok, reason);
    }
    static void EndSession()
    {
        visible = false; typingArmed = false;
        FinishPaste(false, "cancelled");
        if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        keyboardHook = mouseHook = IntPtr.Zero;
        target = targetFocus = IntPtr.Zero; targetPid = targetThread = targetFocusThread = 0; targetFocusRestored = false;
    }
    static IntPtr KeyboardHook(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && visible && typingArmed && (message.ToInt64() == 0x100 || message.ToInt64() == 0x104)) {
            var key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(KBDLLHOOKSTRUCT));
            if (key.dwExtraInfo != PasteTag && !PickerOwns(GetForegroundWindow()) && !IsModifier(key.vkCode)) {
                if (key.vkCode != shortcutKey || Modifiers() != shortcutModifiers) {
                    typingArmed = false; Signal("external-key");
                    // Signal only a condition. Never expose, persist or suppress key values.
                    visible = false; FinishPaste(pending != null && pending.Sent, "interrupted");
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    static IntPtr MouseHook(int code, IntPtr message, IntPtr data)
    {
        long kind = message.ToInt64();
        if (code >= 0 && visible && (kind == 0x201 || kind == 0x204 || kind == 0x207 || kind == 0x20B)) {
            var mouse = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(MSLLHOOKSTRUCT));
            RECT rectangle;
            if (GetWindowRect(picker, out rectangle)) {
                bool inside = mouse.pt.x >= rectangle.left && mouse.pt.x < rectangle.right && mouse.pt.y >= rectangle.top && mouse.pt.y < rectangle.bottom;
                // Owned native dropdowns may extend beyond the BrowserWindow bounds.
                if (!inside && !PickerOwns(WindowFromPoint(mouse.pt))) {
                    Signal("outside-click"); visible = false; typingArmed = false;
                    FinishPaste(pending != null && pending.Sent, "interrupted");
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr window, uint first, uint last, uint remove);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr window, uint first, uint last);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, UIntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr callback);
    [DllImport("user32.dll")] static extern bool KillTimer(IntPtr window, UIntPtr id);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int type, IntPtr buffer, int length, out int returned);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
}
