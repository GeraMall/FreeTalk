import Foundation

public struct CallTileFrame: Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
}

/// Equal-area video tiles. Odd participant counts do not leave an empty cell.
public struct CallTileLayout: Sendable {
    public let frames: [CallTileFrame]
    public let canvasHeight: Double
    public let needsScroll: Bool

    public init(width: Double, height: Double, count: Int) {
        let width = max(1, width.isFinite ? width : 1)
        let height = max(1, height.isFinite ? height : 1)
        let count = max(1, count)
        let gap = 10.0
        let possibleColumns = max(1, Int(width / 122))
        let minimumRows = Int(ceil(Double(count) / Double(possibleColumns)))
        canvasHeight = max(height, Double(minimumRows) * 112 + Double(minimumRows - 1) * gap)
        needsScroll = canvasHeight > height + 1
        var best: [CallTileFrame] = []
        var bestScore = Double.infinity
        for rows in 1...count {
            let counts = (0..<rows).map { count / rows + ($0 < count % rows ? 1 : 0) }
            let widths = counts.map { (width - gap * Double($0 - 1)) / Double($0) }
            guard widths.allSatisfy({ $0 > 0 }), canvasHeight > gap * Double(rows - 1) else { continue }
            let area = (canvasHeight - gap * Double(rows - 1)) / widths.reduce(0.0) { $0 + 1 / $1 }
            var candidate: [CallTileFrame] = [], y = 0.0
            var score = 0.0, worst = 0.0
            for row in 0..<rows {
                let tileWidth = widths[row], tileHeight = area / widths[row]
                let distortion = abs(log(tileWidth / tileHeight))
                worst = max(worst, distortion)
                score += distortion * Double(counts[row])
                if min(tileWidth, tileHeight) < 90 { score += 20 }
                for column in 0..<counts[row] {
                    candidate.append(CallTileFrame(x: Double(column) * (tileWidth + gap), y: y, width: tileWidth, height: tileHeight))
                }
                y += tileHeight + gap
            }
            score = score / Double(count) + worst * 0.3
            if score < bestScore { bestScore = score; best = candidate }
        }
        frames = best
    }
}
