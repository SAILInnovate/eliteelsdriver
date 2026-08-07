export const HASTINGS_PRICING = {
    minimumFare: 3.5,
    firstMileFare: 4.0,
    mileTwoAndThreeRate: 2.5,
    afterThreeMilesRate: 2.1,
    waitingPerMinute: 0.2,
    airportDropoffFare: 32,
    airportPickupFare: 35,
    dogCharge: 2,
    estateCarCharge: 3
};

export const DEFAULT_DRIVER_RATE_PROFILE = {
    minimum_fare: HASTINGS_PRICING.minimumFare,
    first_mile_fare: HASTINGS_PRICING.firstMileFare,
    per_mile_2_3: HASTINGS_PRICING.mileTwoAndThreeRate,
    per_mile_after_3: HASTINGS_PRICING.afterThreeMilesRate,
    per_minute_waiting: HASTINGS_PRICING.waitingPerMinute,
    airport_dropoff_fare: HASTINGS_PRICING.airportDropoffFare,
    airport_pickup_fare: HASTINGS_PRICING.airportPickupFare,
    dog_charge: HASTINGS_PRICING.dogCharge,
    estate_car_charge: HASTINGS_PRICING.estateCarCharge
};

export const SERVICE_TYPES = {
    METERED: 'metered',
    AIRPORT_DROPOFF: 'airport_dropoff',
    AIRPORT_PICKUP: 'airport_pickup'
};

export function roundToPence(amount) {
    return Math.round(Number(amount || 0) * 100) / 100;
}

export function normalizeRateProfile(rawProfile = {}) {
    return {
        minimum_fare: Number(rawProfile.minimum_fare ?? DEFAULT_DRIVER_RATE_PROFILE.minimum_fare),
        first_mile_fare: Number(rawProfile.first_mile_fare ?? DEFAULT_DRIVER_RATE_PROFILE.first_mile_fare),
        per_mile_2_3: Number(rawProfile.per_mile_2_3 ?? DEFAULT_DRIVER_RATE_PROFILE.per_mile_2_3),
        per_mile_after_3: Number(rawProfile.per_mile_after_3 ?? DEFAULT_DRIVER_RATE_PROFILE.per_mile_after_3),
        per_minute_waiting: Number(rawProfile.per_minute_waiting ?? DEFAULT_DRIVER_RATE_PROFILE.per_minute_waiting),
        airport_dropoff_fare: Number(rawProfile.airport_dropoff_fare ?? DEFAULT_DRIVER_RATE_PROFILE.airport_dropoff_fare),
        airport_pickup_fare: Number(rawProfile.airport_pickup_fare ?? DEFAULT_DRIVER_RATE_PROFILE.airport_pickup_fare),
        dog_charge: Number(rawProfile.dog_charge ?? DEFAULT_DRIVER_RATE_PROFILE.dog_charge),
        estate_car_charge: Number(rawProfile.estate_car_charge ?? DEFAULT_DRIVER_RATE_PROFILE.estate_car_charge)
    };
}

export function calculateDistanceFareWithProfile(distanceMiles, rateProfile = DEFAULT_DRIVER_RATE_PROFILE) {
    const miles = Math.max(0, Number(distanceMiles || 0));
    const profile = normalizeRateProfile(rateProfile);

    if (miles <= 0.5) return profile.minimum_fare;
    if (miles <= 1) return profile.first_mile_fare;

    if (miles <= 3) {
        return roundToPence(
            profile.first_mile_fare + (miles - 1) * profile.per_mile_2_3
        );
    }

    return roundToPence(
        profile.first_mile_fare +
        (2 * profile.per_mile_2_3) +
        (miles - 3) * profile.per_mile_after_3
    );
}

export function calculateBaseFareWithProfile({
    distanceMiles = 0,
    serviceType = SERVICE_TYPES.METERED,
    includeDog = false,
    includeEstateCar = false,
    rateProfile = DEFAULT_DRIVER_RATE_PROFILE
}) {
    const profile = normalizeRateProfile(rateProfile);
    let fare = calculateDistanceFareWithProfile(distanceMiles, profile);

    if (serviceType === SERVICE_TYPES.AIRPORT_DROPOFF) {
        fare = profile.airport_dropoff_fare;
    } else if (serviceType === SERVICE_TYPES.AIRPORT_PICKUP) {
        fare = profile.airport_pickup_fare;
    }

    if (includeDog) fare += profile.dog_charge;
    if (includeEstateCar) fare += profile.estate_car_charge;

    return roundToPence(fare);
}

export function calculateLiveFareWithProfile({
    baseFare = 0,
    elapsedSeconds = 0,
    rateProfile = DEFAULT_DRIVER_RATE_PROFILE
}) {
    const profile = normalizeRateProfile(rateProfile);
    const timeFare = (Math.max(0, Number(elapsedSeconds || 0)) / 60) * profile.per_minute_waiting;
    return roundToPence(Number(baseFare || 0) + timeFare);
}

export function estimateRangeFromProfiles({
    rateProfiles = [],
    distanceMiles = 0,
    serviceType = SERVICE_TYPES.METERED,
    includeDog = false,
    includeEstateCar = false
}) {
    const profiles = (rateProfiles.length ? rateProfiles : [DEFAULT_DRIVER_RATE_PROFILE]).map(normalizeRateProfile);
    const fares = profiles
        .map((profile) => calculateBaseFareWithProfile({
            distanceMiles,
            serviceType,
            includeDog,
            includeEstateCar,
            rateProfile: profile
        }))
        .sort((left, right) => left - right);

    const minFare = fares[0];
    const maxFare = fares[fares.length - 1];
    const middleIndex = Math.floor(fares.length / 2);
    const medianFare = fares[middleIndex];
    const aboutFare = roundToPence((minFare + medianFare + maxFare) / 3);

    return {
        minFare,
        maxFare,
        medianFare,
        aboutFare,
        sourceCount: fares.length
    };
}

export function calculateDistanceFare(distanceMiles) {
    return calculateDistanceFareWithProfile(distanceMiles, DEFAULT_DRIVER_RATE_PROFILE);
}

export function calculateBaseFare({
    distanceMiles = 0,
    serviceType = SERVICE_TYPES.METERED,
    includeDog = false,
    includeEstateCar = false
}) {
    return calculateBaseFareWithProfile({
        distanceMiles,
        serviceType,
        includeDog,
        includeEstateCar,
        rateProfile: DEFAULT_DRIVER_RATE_PROFILE
    });
}

export function calculateLiveFare({ baseFare = 0, elapsedSeconds = 0 }) {
    return calculateLiveFareWithProfile({
        baseFare,
        elapsedSeconds,
        rateProfile: DEFAULT_DRIVER_RATE_PROFILE
    });
}
