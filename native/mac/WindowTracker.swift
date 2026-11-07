// panefall-window-tracker
//
// Reports the frames of on-screen windows as one JSON object per line on stdout,
// so Panefall knows where weather can collect. Uses only window *bounds*,
// which macOS provides without the Screen Recording permission. The Dock's
// real frame needs the Accessibility permission and is reported only when granted.
//
// Output (all coordinates in points, global, top-left origin of the main display):
//   {"w":[[id,x,y,w,h],...],"m":[[x,y,w,h],...],"d":[x,y,w,h]|null,"ax":true|false}
//   w = normal windows, front-to-back.  m = menu bars.  d = Dock icon strip.

import AppKit
import ApplicationServices
import CoreGraphics

setvbuf(stdout, nil, _IOLBF, 0)

var excludePid: pid_t = getppid()
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--exclude-pid"), i + 1 < args.count, let p = Int32(args[i + 1]) {
    excludePid = p
}

// System surfaces that are not real windows a user drags around.
let ignoredOwners: Set<String> = [
    "Window Server", "Dock", "Control Center", "Notification Center", "SystemUIServer",
    "Spotlight", "screencaptureui", "WindowManager", "TextInputMenuAgent",
]

func num(_ v: Any?) -> Int { Int(((v as? NSNumber)?.doubleValue ?? 0).rounded()) }

func snapshot(dock: [Int]?, ax: Bool) -> String {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return "{\"w\":[],\"m\":[],\"d\":null,\"ax\":\(ax)}"
    }
    var wins: [String] = []
    var bars: [String] = []
    for info in list {
        let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        let owner = info[kCGWindowOwnerName as String] as? String ?? ""
        let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
        let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
        guard let b = info[kCGWindowBounds as String] as? [String: Any] else { continue }
        let x = num(b["X"]), y = num(b["Y"]), w = num(b["Width"]), h = num(b["Height"])

        if layer == Int(CGWindowLevelForKey(.mainMenuWindow)) {
            bars.append("[\(x),\(y),\(w),\(h)]")
            continue
        }
        // Normal, floating and modal windows only (layers 0..19). The Dock is 20, menus 24+.
        guard layer >= 0, layer < 20 else { continue }
        guard pid != excludePid, !ignoredOwners.contains(owner) else { continue }
        guard alpha > 0.05, w >= 80, h >= 40 else { continue }
        let id = (info[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
        wins.append("[\(id),\(x),\(y),\(w),\(h)]")
    }
    let d = dock.map { "[\($0[0]),\($0[1]),\($0[2]),\($0[3])]" } ?? "null"
    return "{\"w\":[\(wins.joined(separator: ","))],\"m\":[\(bars.joined(separator: ","))],\"d\":\(d),\"ax\":\(ax)}"
}

/// The Dock's icon strip (its AXList element). Needs Accessibility permission.
func dockFrame() -> [Int]? {
    guard let dock = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first else {
        return nil
    }
    let app = AXUIElementCreateApplication(dock.processIdentifier)
    var children: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &children) == .success,
          let elements = children as? [AXUIElement] else { return nil }
    for el in elements {
        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role)
        guard (role as? String) == (kAXListRole as String) else { continue }
        var posRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
              AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let posVal = posRef, let sizeVal = sizeRef else { continue }
        var p = CGPoint.zero
        var s = CGSize.zero
        AXValueGetValue(posVal as! AXValue, .cgPoint, &p)
        AXValueGetValue(sizeVal as! AXValue, .cgSize, &s)
        guard s.width > 20, s.height > 20 else { return nil }
        return [Int(p.x.rounded()), Int(p.y.rounded()), Int(s.width.rounded()), Int(s.height.rounded())]
    }
    return nil
}

/// Presses a media key (play/pause, next, previous) like the keyboard's own keys, so whatever
/// is playing responds: a YouTube tab in Brave or Chrome, Safari, Spotify, Music…
/// macOS only delivers it if Panefall has the Accessibility permission (the user opts in).
func pressMediaKey(_ key: Int) {
    for down in [true, false] {
        let flags = NSEvent.ModifierFlags(rawValue: down ? 0xA00 : 0xB00)
        let data1 = (key << 16) | ((down ? 0xA : 0xB) << 8)
        let event = NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags, timestamp: 0,
                                       windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1)
        event?.cgEvent?.post(tap: .cghidEventTap)
    }
}

// Commands from Panefall arrive on stdin ("media playpause|next|previous"). When the parent
// closes stdin (normal quit) or dies (re-parented to launchd), exit.
DispatchQueue.global(qos: .utility).async {
    let keys = ["playpause": 16, "next": 17, "previous": 18] // NX_KEYTYPE_PLAY / NEXT / PREVIOUS
    while let line = readLine() {
        let parts = line.split(separator: " ")
        if parts.count == 2, parts[0] == "media", let key = keys[String(parts[1])], AXIsProcessTrusted() {
            pressMediaKey(key)
        }
    }
    exit(0)
}

var last = ""
var burstUntil = Date.distantPast
var dock: [Int]? = nil
var ax = false
var lastDockCheck = Date.distantPast

while true {
    autoreleasepool {
        let now = Date()
        if now.timeIntervalSince(lastDockCheck) > 1.0 {
            ax = AXIsProcessTrusted()
            dock = ax ? dockFrame() : nil
            lastDockCheck = now
        }
        let line = snapshot(dock: dock, ax: ax)
        if line != last {
            print(line)
            last = line
            // Something moved: poll fast for a moment so drags feel immediate.
            burstUntil = now.addingTimeInterval(1.2)
        }
    }
    if getppid() == 1 { exit(0) }
    usleep(Date() < burstUntil ? 16_000 : 66_000)
}
