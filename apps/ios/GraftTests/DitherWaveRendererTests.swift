import MetalKit
import Testing
import UIKit
@testable import Graft

struct DitherWaveRendererTests {
    /// Independent reference frames come from the unmodified desktop WebGL shaders.
    /// Comparing both themes at two times catches glyph, compositing, UV, and speed drift.
    @Test(arguments: [false, true], [0.0, 4.0])
    func matchesDesktopFrame(dark: Bool, seconds: Double) throws {
        let device = try #require(MTLCreateSystemDefaultDevice())
        let renderer = try DitherWaveRenderer(device: device)
        let name = "\(dark ? "dark" : "light")-\(Int(seconds))"
        let bundle = Bundle(for: FixtureBundle.self)
        let fixture = try #require(
            bundle.url(forResource: name, withExtension: "png", subdirectory: "Fixtures/DitherWave")
                ?? bundle.url(forResource: name, withExtension: "png")
        )
        let reference = try #require(UIImage(contentsOfFile: fixture.path)?.cgImage)
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: reference.width, height: reference.height,
            mipmapped: false
        )
        descriptor.storageMode = .shared
        descriptor.usage = [.renderTarget]
        let target = try #require(device.makeTexture(descriptor: descriptor))
        let commands = try #require(renderer.commandQueue.makeCommandBuffer())
        #expect(renderer.encode(into: target, commands: commands, seconds: seconds, dark: dark))
        commands.commit()
        commands.waitUntilCompleted()
        #expect(commands.status == .completed)

        let width = reference.width
        let height = reference.height
        var actual = [UInt8](repeating: 0, count: width * height * 4)
        target.getBytes(&actual, bytesPerRow: width * 4,
                        from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        var expected = [UInt8](repeating: 0, count: actual.count)
        let colorSpace = try #require(CGColorSpace(name: CGColorSpace.sRGB))
        try expected.withUnsafeMutableBytes { bytes in
            let context = try #require(CGContext(
                data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.draw(reference, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var totalDifference = 0
        var largeDifferences = 0
        for pixel in 0..<(width * height) {
            let difference = abs(Int(actual[pixel * 4]) - Int(expected[pixel * 4]))
            totalDifference += difference
            if difference > 12 { largeDifferences += 1 }
        }
        let meanDifference = Double(totalDifference) / Double(width * height)
        let outlierFraction = Double(largeDifferences) / Double(width * height)
        // Grain hashes float-bit UV coordinates, so WebGL interpolation precision
        // changes individual glyph selections across GPUs. Keep mean error near 1%
        // of the color range and require 95% of pixels to be within 12/255.
        #expect(meanDifference < 3.0, "\(name): mean pixel difference \(meanDifference)/255")
        #expect(outlierFraction < 0.05, "\(name): differing pixels \(outlierFraction)")
    }
}

private final class FixtureBundle: NSObject {}
