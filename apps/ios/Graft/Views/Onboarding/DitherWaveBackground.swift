import MetalKit
import SwiftUI

/// Keeps continuous GPU drawing outside the welcome content's invalidation boundary.
struct DitherWaveBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var dark: Bool

    var body: some View {
        DitherWaveMetalView(
            dark: dark,
            reduceMotion: reduceMotion,
            isActive: scenePhase == .active
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct DitherWaveMetalView: UIViewRepresentable {
    var dark: Bool
    var reduceMotion: Bool
    var isActive: Bool

    func makeCoordinator() -> DitherWaveRenderer? {
        guard let device = MTLCreateSystemDefaultDevice() else { return nil }
        do {
            return try DitherWaveRenderer(device: device)
        } catch {
            NSLog("Could not load welcome background: %@", String(describing: error))
            return nil
        }
    }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: context.coordinator?.device)
        view.colorPixelFormat = .bgra8Unorm
        (view.layer as? CAMetalLayer)?.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        view.preferredFramesPerSecond = 60
        view.enableSetNeedsDisplay = false
        view.isOpaque = true
        view.isUserInteractionEnabled = false
        view.delegate = context.coordinator
        updateUIView(view, context: context)
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        let surface = dark ? 14.0 / 255.0 : 252.0 / 255.0
        view.clearColor = MTLClearColor(red: surface, green: surface, blue: surface, alpha: 1)
        view.backgroundColor = UIColor(white: surface, alpha: 1)
        context.coordinator?.configure(dark: dark, reduceMotion: reduceMotion, isActive: isActive)
        view.isPaused = reduceMotion || !isActive || context.coordinator == nil
        if view.isPaused {
            view.draw()
        }
    }

    static func dismantleUIView(_ view: MTKView, coordinator: DitherWaveRenderer?) {
        view.isPaused = true
        view.delegate = nil
    }
}

/// Two GPU passes reproduce the exported scene without a network dependency.
/// The render entry point also supports fixed-time comparisons with desktop frames.
final class DitherWaveRenderer: NSObject, MTKViewDelegate {
    let device: MTLDevice
    let commandQueue: MTLCommandQueue

    private let fieldPipeline: MTLRenderPipelineState
    private let compositePipeline: MTLRenderPipelineState
    private let glyphs: MTLTexture
    private var field: MTLTexture?
    private var dark = false
    private var reduceMotion = false
    private var isActive = true
    private var elapsed: CFTimeInterval = 0
    private var previousFrame: CFTimeInterval?

    private struct Uniforms {
        var resolution: SIMD2<Float>
        var time: Float
        var dark: Float
    }

    private enum RendererError: Error {
        case missingResource
    }

    init(device: MTLDevice) throws {
        self.device = device
        guard let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary(),
              let vertex = library.makeFunction(name: "ditherWaveVertex"),
              let fieldFunction = library.makeFunction(name: "ditherWaveField"),
              let compositeFunction = library.makeFunction(name: "ditherWaveComposite"),
              let glyphURL = Bundle.main.url(forResource: "DitherGlyphs", withExtension: "png")
        else { throw RendererError.missingResource }
        commandQueue = queue
        glyphs = try MTKTextureLoader(device: device).newTexture(URL: glyphURL, options: [
            .SRGB: false,
            .origin: MTKTextureLoader.Origin.bottomLeft,
            .generateMipmaps: false,
        ])
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fieldFunction
        descriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
        fieldPipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        descriptor.fragmentFunction = compositeFunction
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        compositePipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        super.init()
    }

    func configure(dark: Bool, reduceMotion: Bool, isActive: Bool) {
        if self.reduceMotion != reduceMotion || self.isActive != isActive {
            previousFrame = nil
        }
        self.dark = dark
        self.reduceMotion = reduceMotion
        self.isActive = isActive
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        field = nil
    }

    func draw(in view: MTKView) {
        guard let drawable = view.currentDrawable,
              let commands = commandQueue.makeCommandBuffer() else { return }
        let now = CACurrentMediaTime()
        if isActive && !reduceMotion {
            if let previousFrame { elapsed += now - previousFrame }
            previousFrame = now
        }
        guard encode(into: drawable.texture, commands: commands,
                     seconds: reduceMotion ? 0 : elapsed, dark: dark) else { return }
        commands.present(drawable)
        commands.commit()
    }

    @discardableResult
    func encode(into target: MTLTexture, commands: MTLCommandBuffer,
                seconds: TimeInterval, dark: Bool) -> Bool {
        if field?.width != target.width || field?.height != target.height {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .rgba8Unorm, width: target.width, height: target.height,
                mipmapped: false
            )
            descriptor.usage = [.renderTarget, .shaderRead]
            descriptor.storageMode = .private
            field = device.makeTexture(descriptor: descriptor)
        }
        guard let field else { return false }
        // UnicornStudio increments uTime by speed once per 60 Hz frame.
        var uniforms = Uniforms(resolution: SIMD2(Float(target.width), Float(target.height)),
                                time: Float(seconds * 60 * 0.11), dark: dark ? 1 : 0)
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = field
        pass.colorAttachments[0].loadAction = .dontCare
        pass.colorAttachments[0].storeAction = .store
        guard let fieldEncoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return false }
        fieldEncoder.setRenderPipelineState(fieldPipeline)
        fieldEncoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
        fieldEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        fieldEncoder.endEncoding()

        pass.colorAttachments[0].texture = target
        guard let compositeEncoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return false }
        compositeEncoder.setRenderPipelineState(compositePipeline)
        compositeEncoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
        compositeEncoder.setFragmentTexture(field, index: 0)
        compositeEncoder.setFragmentTexture(glyphs, index: 1)
        compositeEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        compositeEncoder.endEncoding()
        return true
    }
}
