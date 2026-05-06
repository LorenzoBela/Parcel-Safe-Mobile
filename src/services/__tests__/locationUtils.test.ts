import { consolidateLocation } from "../locationUtils";
import type { LocationData } from "../../types";

const NOW = 1_700_000_000_000;

const makeLocation = (overrides: Partial<LocationData>): LocationData => ({
    latitude: 14,
    longitude: 120,
    timestamp: NOW,
    source: "box",
    ...overrides,
});

describe("consolidateLocation", () => {
    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(NOW);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("prefers fresh phone GPS over fresh box GPS", () => {
        const box = makeLocation({ longitude: 120.001, source: "box" });
        const phone = makeLocation({ longitude: 120.002, source: "phone" });

        expect(consolidateLocation(box, phone)).toBe(phone);
    });

    it("uses box GPS when the phone location is stale", () => {
        const box = makeLocation({ longitude: 120.001, source: "box" });
        const phone = makeLocation({
            longitude: 120.002,
            timestamp: NOW - 31_000,
            source: "phone_background",
        });

        expect(consolidateLocation(box, phone)).toBe(box);
    });
});
