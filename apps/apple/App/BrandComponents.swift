import SwiftUI
import TRLKACore

extension Brand {
    static var surface: Color { palette.color(0x0d1626, 0xffffff, 0x111111) }
    static var stroke: Color { palette.color(0x293648, 0xc8d2e0, 0x353535) }
    static var muted: Color { palette.color(0x9aabc1, 0x516277, 0xaaaaaf) }
}

struct Panel: ViewModifier {
    var radius: CGFloat = 18
    func body(content: Content) -> some View {
        content.background(Brand.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Brand.stroke, lineWidth: 1))
    }
}
extension View { func trlkaPanel(_ radius: CGFloat = 18) -> some View { modifier(Panel(radius: radius)) } }

struct PrimaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.black).frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 13))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct CompactControlStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.78 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct ProfileAvatar: View {
    let name: String
    var url: String?
    let client: AccountClient
    var size: CGFloat = 44
    @State private var image: Image?
    var body: some View {
        ZStack {
            Circle().fill(Brand.background)
            Circle().fill(Brand.gradient.opacity(0.4))
            if let image { image.resizable().scaledToFill() }
            else { Text(String(name.prefix(1)).uppercased()).font(.system(size: size * 0.38, weight: .bold)) }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .overlay(Circle().stroke(Brand.accent.opacity(0.3), lineWidth: 1))
        .task(id: url) {
            image = nil
            guard let url, let address = URL(string: url) else { return }
            do {
                let bytes: Data
                if address.scheme == "data", let value = url.split(separator: ",", maxSplits: 1).last, let decoded = Data(base64Encoded: String(value)) { bytes = decoded }
                else { bytes = try await client.avatarData(url: address) }
                try Task.checkCancellation()
                #if os(iOS)
                if let decoded = UIImage(data: bytes) { image = Image(uiImage: decoded) }
                #else
                if let decoded = NSImage(data: bytes) { image = Image(nsImage: decoded) }
                #endif
            } catch {}
        }
        .accessibilityLabel(name)
    }
}

struct SectionCaption: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 11, weight: .bold)).tracking(1.2).foregroundStyle(Brand.accent) }
}

struct ProfileCover: View {
    let url: String?
    let client: AccountClient
    @State private var image: Image?
    var body: some View {
        ZStack {
            Brand.gradient.opacity(0.25)
            if let image { image.resizable().scaledToFill() }
        }
        .frame(height: 90).clipped().clipShape(RoundedRectangle(cornerRadius: 18))
        .task(id: url) {
            image = nil
            guard let url, let address = URL(string: url), let data = try? await client.avatarData(url: address), !Task.isCancelled else { return }
            #if os(iOS)
            if let decoded = UIImage(data: data) { image = Image(uiImage: decoded) }
            #else
            if let decoded = NSImage(data: data) { image = Image(nsImage: decoded) }
            #endif
        }
    }
}
