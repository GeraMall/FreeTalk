import SwiftUI

// Mobile web tokens apply to non-call screens. Existing call tokens stay independent.
extension Brand {
    static var webBackground: Color { palette.color(0x040b14, 0xf1f4f9, 0x000000) }
    static var chatCanvas: Color { palette.color(0x07111d, 0xf4f7fb, 0x060606) }
    static var webHeader: Color { palette.color(0x0a1623, 0xffffff, 0x101010) }
    static var incoming: Color { palette.color(0x101e2e, 0xffffff, 0x171717) }
    static var outgoing: Color { palette.color(0x1a2c48, 0xdbe7ff, 0x26262b) }
    static var webStroke: Color { palette.color(0x29384e, 0xcbd5e3, 0x373737) }
    static var input: Color { palette.color(0x050d18, 0xffffff, 0x0c0c0c) }
}
struct WebPanel: ViewModifier {
    var radius: CGFloat = 16
    func body(content: Content) -> some View {
        content.background(Brand.incoming, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Brand.webStroke, lineWidth: 1))
    }
}
extension View {
    func webPanel(_ radius: CGFloat = 16) -> some View { modifier(WebPanel(radius: radius)) }
    func webInput() -> some View {
        textFieldStyle(.plain).font(.system(size: 16)).padding(.horizontal, 13).padding(.vertical, 12)
            .background(Brand.input, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Brand.webStroke))
    }
}
struct WebSearchField: View {
    let placeholder: String
    @Binding var text: String
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
            TextField(placeholder, text: $text).textFieldStyle(.plain).font(.system(size: 16))
                #if os(iOS)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                #endif
            if !text.isEmpty { Button { text = "" } label: { Image(systemName: "xmark").font(.system(size: 12)) }.buttonStyle(.plain).accessibilityLabel("Очистить поиск") }
        }.padding(12).background(Brand.input, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Brand.webStroke))
    }
}
struct WebMessageBubble: View {
    @AppStorage("trlka.chatTextScale") private var textScale = 1.0
    let text: String
    let date: Date?
    let own: Bool
    var author: String? = nil
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    private var messageText: AttributedString {
        var linked = AttributedString(text)
        let range = NSRange(text.startIndex..., in: text)
        for item in Self.linkDetector?.matches(in: text, range: range) ?? [] {
            guard let url = item.url, ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
                  let original = Range(item.range, in: text),
                  let match = Range(original, in: linked) else { continue }
            linked[match].link = url
        }
        return linked
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let author { Text(author).font(.system(size: 11, weight: .semibold)).foregroundStyle(Brand.accent) }
            Text(messageText).font(.system(size: CGFloat(14 * textScale))).lineSpacing(3).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if let date { Text(date, style: .time).font(.system(size: 10)).foregroundStyle(Brand.muted) }
        }.padding(.vertical, 10).padding(.horizontal, 12).foregroundStyle(.primary)
            .background(own ? Brand.outgoing : Brand.incoming)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: own ? 14 : 0, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: own ? 0 : 14))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: own ? 14 : 0, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: own ? 0 : 14).stroke(own ? Color(red: 61/255, green: 80/255, blue: 115/255) : Brand.webStroke))
    }
}
struct ChatDestinationKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}
