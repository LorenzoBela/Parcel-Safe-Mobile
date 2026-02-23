import * as turf from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';

// Define a type for our restricted zones
export interface RestrictedZone {
    id: string;
    name: string;
    polygon: any;
    accessNodes: any[];
}

// Example 1: De La Salle University (DLSU) Manila Campus
// Approximate polygon covering the campus
const dlsuPolygon = turf.polygon([[
    [120.9918, 14.5658],
    [120.9935, 14.5650],
    [120.9942, 14.5662],
    [120.9925, 14.5670],
    [120.9918, 14.5658] // Close the polygon
]]);

// Valid access nodes for DLSU
const dlsuAccessNodes = [
    turf.point([120.9930, 14.5653], { name: "South Gate (Taft Ave)" }),
    turf.point([120.9922, 14.5665], { name: "North Gate (Taft Ave)" }),
    turf.point([120.9938, 14.5658], { name: "Fidel Reyes St. Gate" })
];

// Combine into our restricted zones array
export const restrictedZones: RestrictedZone[] = [
    {
        id: "dlsu_manila",
        name: "De La Salle University Manila",
        polygon: dlsuPolygon,
        accessNodes: dlsuAccessNodes
    }
];

/**
 * Checks if a given coordinate is inside a restricted zone.
 * If true, returns the closest valid access node for that zone.
 * If false, returns the original coordinate.
 */
export const snapToValidNode = (
    lat: number,
    lng: number
): { lat: number; lng: number; snapped: boolean; reason?: string; nodeName?: string } => {
    const userPoint = turf.point([lng, lat]);

    for (const zone of restrictedZones) {
        // Check if the point falls inside the current restricted zone's polygon
        if (booleanPointInPolygon(userPoint, zone.polygon)) {
            // Find the closest access node for this specific zone
            let closestNode: any = null;
            let minDistance = Infinity;

            for (const node of zone.accessNodes) {
                const dist = distance(userPoint, node, { units: 'meters' });
                if (dist < minDistance) {
                    minDistance = dist;
                    closestNode = node;
                }
            }

            if (closestNode) {
                return {
                    lat: closestNode.geometry.coordinates[1],
                    lng: closestNode.geometry.coordinates[0],
                    snapped: true,
                    reason: `Location is inside a restricted zone (${zone.name}).`,
                    nodeName: closestNode.properties?.name || 'Nearest Access Point'
                };
            }
        }
    }

    // If not in any restricted zone, return original coordinates
    return { lat, lng, snapped: false };
};
