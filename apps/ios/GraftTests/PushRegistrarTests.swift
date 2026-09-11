import Foundation
import XCTest
@testable import Graft

final class PushRegistrarTests: XCTestCase {
    func testFeatureFlagDefaultsToDisabled() {
        XCTAssertFalse(PushRegistrationFeature.isEnabled(in: [:]))
        XCTAssertFalse(
            PushRegistrationFeature.isEnabled(
                in: [PushRegistrationFeature.infoDictionaryKey: false]
            )
        )
    }

    func testFeatureFlagAcceptsOnlyExplicitBooleanTrue() {
        XCTAssertTrue(
            PushRegistrationFeature.isEnabled(
                in: [PushRegistrationFeature.infoDictionaryKey: true]
            )
        )
        XCTAssertFalse(
            PushRegistrationFeature.isEnabled(
                in: [PushRegistrationFeature.infoDictionaryKey: "true"]
            )
        )
    }

    func testDeviceTokenEncodingIsLowercaseAndZeroPadded() {
        let token = PushRegistrar.hexEncodedDeviceToken(Data([0x00, 0x01, 0xab, 0xff]))

        XCTAssertEqual(token, "0001abff")
    }

    func testDeviceTokenEncodingDoesNotAssumeFixedTokenLength() {
        XCTAssertEqual(PushRegistrar.hexEncodedDeviceToken(Data([0x7f])).count, 2)
        XCTAssertEqual(PushRegistrar.hexEncodedDeviceToken(Data(repeating: 0xaa, count: 64)).count, 128)
    }

    func testRegistrationRequestDoesNotContainDeviceIdentity() throws {
        let request = PushRegistrationRequest(
            apnsToken: "00ab",
            apnsEnvironment: .sandbox,
            bundleId: "studio.graft.mobile"
        )

        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(Set(json.keys), ["apnsToken", "apnsEnvironment", "bundleId"])
        XCTAssertNil(json["deviceId"])
    }
}
