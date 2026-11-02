import SwiftUI

// Mobile web tokens apply to non-call screens. Existing call tokens stay independent.
extension Brand {
    static let webBackground = Color(red: 4/255, green: 11/255, blue: 20/255)
    static let chatCanvas = Color(red: 7/255, green: 17/255, blue: 29/255)
    static let webHeader = Color(red: 10/255, green: 22/255, blue: 35/255)
    static let incoming = Color(red: 16/255, green: 30/255, blue: 46/255)
    static let outgoing = Color(red: 26/255, green: 44/255, blue: 72/255)
    static let webStroke = Color(red: 41/255, green: 56/255, blue: 78/255)
    static let input = Color(red: 5/255, green: 13/255, blue: 24/255)
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
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let author { Text(author).font(.system(size: 11, weight: .semibold)).foregroundStyle(Brand.accent) }
            Text(text).font(.system(size: CGFloat(14 * textScale))).lineSpacing(3).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if let date { Text(date, style: .time).font(.system(size: 10)).foregroundStyle(Brand.muted) }
        }.padding(.vertical, 10).padding(.horizontal, 12).foregroundStyle(Color.white.opacity(0.95))
            .background(own ? Brand.outgoing : Brand.incoming)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: own ? 14 : 0, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: own ? 0 : 14))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: own ? 14 : 0, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: own ? 0 : 14).stroke(own ? Color(red: 61/255, green: 80/255, blue: 115/255) : Brand.webStroke))
    }
}
struct ChatDestinationKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}
