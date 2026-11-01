import Foundation

/// One socket generation owns its receive, heartbeat and reconnect tasks.
@MainActor
final class SocketChannel {
    var onMessage: (([String: Any]) -> Void)?
    var onConnection: ((Bool) -> Void)?
    var onFailure: ((String) -> Void)?
    private var runner: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var session = URLSession(configuration: .ephemeral)
    private var generation = 0
    private var ready = false
    private var lastPong = Date()

    func start(url: URL, roomHeartbeat: Bool, hello: @escaping @MainActor () async throws -> [String: Any]) {
        stop()
        let expected = generation
        runner = Task {
            var attempt = 0
            while !Task.isCancelled && expected == generation {
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                let current = session.webSocketTask(with: request)
                current.maximumMessageSize = 131_072
                socket = current
                ready = false
                lastPong = Date()
                current.resume()
                let watch = Task {
                    var elapsed = 0
                    while !Task.isCancelled && self.socket === current {
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }
                        guard self.socket === current else { return }
                        elapsed += 5
                        if (!self.ready && elapsed >= 20) || (roomHeartbeat && Date().timeIntervalSince(self.lastPong) > 30) {
                            current.cancel(with: .goingAway, reason: nil)
                            return
                        }
                        if roomHeartbeat {
                            self.send(["type": "ping", "timestamp": Int(Date().timeIntervalSince1970 * 1000)])
                        } else {
                            current.sendPing { error in
                                if error != nil { current.cancel(with: .goingAway, reason: nil) }
                            }
                        }
                    }
                }
                do {
                    let initial = try await hello()
                    guard expected == generation && socket === current else { watch.cancel(); return }
                    let encoded = try JSONSerialization.data(withJSONObject: initial)
                    try await current.send(.string(String(decoding: encoded, as: UTF8.self)))
                    while !Task.isCancelled && expected == generation && socket === current {
                        let frame = try await current.receive()
                        guard expected == generation && socket === current else { break }
                        let data: Data
                        switch frame { case .data(let bytes): data = bytes; case .string(let text): data = Data(text.utf8); @unknown default: continue }
                        guard data.count <= 131_072, let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                        let type = message["type"] as? String
                        if type == "pong" { lastPong = Date(); continue }
                        if type == "ready" || type == "joined-room" {
                            ready = true; attempt = 0; lastPong = Date(); onConnection?(true)
                        }
                        onMessage?(message)
                    }
                } catch {
                    if !Task.isCancelled && expected == generation { onFailure?(error.localizedDescription) }
                }
                watch.cancel()
                current.cancel(with: .goingAway, reason: nil)
                guard expected == generation && !Task.isCancelled else { return }
                socket = nil
                onConnection?(false)
                attempt += 1
                let delay = min(15.0, pow(1.6, Double(min(attempt, 8)))) + Double.random(in: 0...0.5)
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            }
        }
    }

    func send(_ message: [String: Any]) {
        guard let current = socket, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        Task {
            do { try await current.send(.string(String(decoding: data, as: UTF8.self))) }
            catch { if socket === current { current.cancel(with: .goingAway, reason: nil) } }
        }
    }

    func stop() {
        generation += 1
        runner?.cancel(); runner = nil
        socket?.cancel(with: .normalClosure, reason: nil); socket = nil
        ready = false
    }

    func finish(_ message: [String: Any]) {
        guard let current = socket, let data = try? JSONSerialization.data(withJSONObject: message) else { stop(); return }
        let expected = generation
        Task {
            try? await current.send(.string(String(decoding: data, as: UTF8.self)))
            if generation == expected && socket === current { stop() }
            else { current.cancel(with: .normalClosure, reason: nil) }
        }
        Task {
            try? await Task.sleep(for: .seconds(1))
            if generation == expected && socket === current { stop() }
        }
    }
}
