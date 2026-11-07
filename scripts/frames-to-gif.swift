// Turns frames from scripts/demo-recorder.html into a looping animated GIF using macOS's
// own ImageIO (no dependencies).
//
//   swift scripts/frames-to-gif.swift frames.json [more.json ...] docs/assets/demo.gif
//
// Each JSON file is an array of PNG data URLs, in order. Set FPS=12 (default 15) to change speed.
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    print("usage: swift frames-to-gif.swift <frames.json>... <out.gif>")
    exit(1)
}

var images: [CGImage] = []
for path in args.dropLast() {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    guard let urls = try JSONSerialization.jsonObject(with: data) as? [String] else {
        print("\(path): expected a JSON array of data URLs")
        exit(1)
    }
    for url in urls {
        guard let comma = url.firstIndex(of: ","),
              let bytes = Data(base64Encoded: String(url[url.index(after: comma)...])),
              let source = CGImageSourceCreateWithData(bytes as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            print("\(path): could not decode a frame")
            exit(1)
        }
        images.append(image)
    }
}

let fps = Double(ProcessInfo.processInfo.environment["FPS"] ?? "15") ?? 15
let out = URL(fileURLWithPath: args.last!)
guard let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.gif.identifier as CFString, images.count, nil) else {
    print("could not create \(out.path)")
    exit(1)
}
CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
let frame = [kCGImagePropertyGIFDictionary: [
    kCGImagePropertyGIFDelayTime: 1.0 / fps,
    kCGImagePropertyGIFUnclampedDelayTime: 1.0 / fps,
]] as CFDictionary
for image in images { CGImageDestinationAddImage(destination, image, frame) }
guard CGImageDestinationFinalize(destination) else {
    print("could not write \(out.path)")
    exit(1)
}
let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
print("wrote \(images.count) frames to \(out.path) (\(size / 1024) KB)")
