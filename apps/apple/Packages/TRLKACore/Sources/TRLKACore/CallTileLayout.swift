import Foundation

public struct CallTileFrame: Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
}

/// Tiles have equal dimensions, with an incomplete final row centered in the canvas.
public struct CallTileLayout: Sendable {
    public let frames: [CallTileFrame]
    public let canvasHeight: Double
    public let needsScroll: Bool

    public init(width: Double, height: Double, count: Int) {
        let width = max(1, width.isFinite ? width : 1)
        let height = max(1, height.isFinite ? height : 1)
        guard count > 0 else {
            frames = []
            canvasHeight = height
            needsScroll = false
            return
        }
        let gap = 10.0
        let wide = width >= 640
        let possibleColumns = min(wide ? 4 : 2, max(1, Int(width / 122)))
        let targetAspectRatio = wide ? 1.6 : 1.0
        let minimumRows = Int(ceil(Double(count) / Double(possibleColumns)))
        canvasHeight = max(height, Double(minimumRows) * 112 + Double(minimumRows - 1) * gap)
        needsScroll = canvasHeight > height + 1
        var best: [CallTileFrame] = []
        var bestScore = Double.infinity
        for columns in 1...min(possibleColumns, count) {
            let rows = (count + columns - 1) / columns
            let tileWidth = (width - gap * Double(columns - 1)) / Double(columns)
            let tileHeight = (canvasHeight - gap * Double(rows - 1)) / Double(rows)
            guard tileWidth > 0, tileHeight > 0 else { continue }
            let unused = Double(rows * columns - count) / Double(rows * columns)
            let tooSmall = min(tileWidth, tileHeight) < 90 ? 20.0 : 0
            let score = abs(log(tileWidth / tileHeight / targetAspectRatio)) + unused * 0.2 + tooSmall
            guard score < bestScore else { continue }
            bestScore = score
            best = (0..<count).map { index in
                let row = index / columns
                let column = index % columns
                let rowCount = min(columns, count - row * columns)
                let rowWidth = tileWidth * Double(rowCount) + gap * Double(rowCount - 1)
                return CallTileFrame(
                    x: (width - rowWidth) / 2 + Double(column) * (tileWidth + gap),
                    y: Double(row) * (tileHeight + gap),
                    width: tileWidth,
                    height: tileHeight
                )
            }
        }
        frames = best
    }
}
