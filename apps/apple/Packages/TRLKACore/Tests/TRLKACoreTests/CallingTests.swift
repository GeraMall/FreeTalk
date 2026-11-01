import XCTest
@testable import TRLKACore

final class CallingTests: XCTestCase {
    func testRoomCodesMatchExistingServerContract() throws {
        for _ in 0..<100 {
            let code = RoomCode.generate()
            XCTAssertEqual(code.count, 12)
            XCTAssertEqual(try RoomCode.parse(code.lowercased()), code)
            XCTAssertEqual(try RoomCode.parse("https://trlka.com/join/\(code)"), code)
            XCTAssertEqual(try RoomCode.parse("https://trlka.com/app/?room=\(code)"), code)
        }
        for value in ["", "AAAAAAAAAAA", "000000000000", "IIIIIIIIIIII", "../../secret", "https://example.com/"] {
            XCTAssertThrowsError(try RoomCode.parse(value))
        }
    }

    func testIncomingInvitationAndCallMessagesDecodeExistingWireFormat() throws {
        let data = Data(#"{"type":"incoming-call","invitationId":"inv","roomId":"ABCDEFGHJKLM","inviter":{"id":"user","displayName":"Друг","avatarUrl":null},"expiresAt":"2026-11-01T15:00:00.000Z"}"#.utf8)
        let call = try JSONDecoder().decode(IncomingCall.self, from: data)
        XCTAssertEqual(call.inviter.displayName, "Друг")
        XCTAssertNotNil(WireDate.parse(call.expiresAt))
        let message = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m","kind":"call","body":"Звонок","sender_id":null,"created_at":"2026-11-01T12:00:00Z","metadata":{"roomId":"ABCDEFGHJKLM","ended":true}}"#.utf8))
        XCTAssertEqual(message.metadata?.ended, true)
        XCTAssertEqual(message.metadata?.roomId, "ABCDEFGHJKLM")
    }

    func testWebsocketOriginsFollowConfiguredAPIWithoutLeakingCredentials() async throws {
        let client = try AccountClient(baseURL: URL(string: "https://trlka.com/api")!)
        let realtime = await client.realtimeURL()
        let signal = try await client.signalingURL(roomID: "ABCDEFGHJKLM")
        XCTAssertEqual(realtime.absoluteString, "wss://trlka.com/api/v1/chats/realtime")
        XCTAssertEqual(signal.absoluteString, "wss://trlka.com/ws?room=ABCDEFGHJKLM")
        XCTAssertFalse(realtime.absoluteString.contains("token"))
        do { _ = try await client.signalingURL(roomID: "../../../bad"); XCTFail("Invalid room accepted") }
        catch {}
    }
}
