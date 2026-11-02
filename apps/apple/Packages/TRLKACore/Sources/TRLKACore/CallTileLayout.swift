import Foundation

/// A stable square footprint for both avatar and camera states.
public struct CallTileLayout: Sendable {
    public let columns: Int
    public let side: Double
    public let rows: Int
    public let needsScroll: Bool
    public let spacing: Double = 10

    public init(width: Double, height: Double, count: Int) {
        let width = max(1, width.isFinite ? width : 1)
        let height = max(1, height.isFinite ? height : 1)
        let count = max(1, count)
        columns = min(count, width >= 900 ? 4 : width >= 600 ? 3 : 2)
        rows = (count + columns - 1) / columns
        let availableWidth = max(1, (width - spacing * Double(columns - 1)) / Double(columns))
        let availableHeight = max(1, (height - spacing * Double(rows - 1)) / Double(rows))
        let minimum = min(112, availableWidth)
        side = max(minimum, min(count == 1 ? 240 : 260, availableWidth, availableHeight))
        needsScroll = side * Double(rows) + spacing * Double(rows - 1) > height + 1
    }
}
