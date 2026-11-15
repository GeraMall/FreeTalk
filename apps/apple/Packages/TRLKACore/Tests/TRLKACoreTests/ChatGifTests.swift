import XCTest
@testable import TRLKACore

final class ChatGifTests: XCTestCase {
    func testKlipyUsesTrustedAnimatedRenditionAndPreservesDeliveryQuery() throws {
        let response = #"{"result":true,"data":{"has_next":true,"data":[{"id":10,"title":"Привет","file":{"md":{"gif":{"url":"https://other.example/test.gif"}},"sm":{"gif":{"url":"https://static.klipy.com/small.gif?x=2","width":220}},"xs":{"gif":{"url":"https://static.klipy.com/thumb.gif"}}}}]}}"#
        let result = try JSONDecoder().decode(KlipyFeed.self, from: Data(response.utf8))
        let gif = try XCTUnwrap(result.data.data.first?.gif())
        XCTAssertEqual(gif.providerId, "10")
        XCTAssertEqual(gif.url, "https://static.klipy.com/small.gif?x=2")
        XCTAssertEqual(gif.remoteImage(preview: true)?.lastPathComponent, "thumb.gif")
        XCTAssertEqual(gif.width, 220)
        XCTAssertEqual(gif.attribution.provider, "KLIPY")
    }

    func testPrivateAndExternalGifAssetsRemainIsolated() throws {
        let payload = #"{"id":"m","kind":"text","body":"Привет","created_at":"2026-11-01","metadata":{"gif":{"assetId":"c6e5fcd1-effd-4d93-9cb5-64ea3dadec87","url":"https://trlka.com/api/v1/gifs/assets/test","alt":"Привет","attribution":{"provider":"TRLKA","title":"Привет","pageUrl":"https://trlka.com"}}}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(payload.utf8))
        let gif = try XCTUnwrap(message.metadata?.gif)
        XCTAssertNotNil(gif.assetId)
        XCTAssertNil(gif.remoteImage(preview: false))
        for url in ["http://static.klipy.com/1.gif", "https://static.klipy.com:443/1.gif",
                    "https://static.klipy.com@elsewhere.example/1.gif", "https://u:p@static.klipy.com/1.gif"] {
            XCTAssertNil(ChatGif.trusted(url, host: "static.klipy.com"))
        }
    }
}
