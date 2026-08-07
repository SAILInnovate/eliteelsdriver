import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Browser } from '@capacitor/browser';
import { Geolocation } from '@capacitor/geolocation';
import {
    calculateBaseFareWithProfile,
    calculateLiveFareWithProfile,
    DEFAULT_DRIVER_RATE_PROFILE,
    normalizeRateProfile,
    roundToPence
} from '../lib/ridePricing';

const driverIcon = new L.Icon({
    iconUrl: '/assets/topdowncar.png',
    iconSize: [48, 48],
    iconAnchor: [24, 24]
});

const pickupIcon = new L.Icon({
    iconUrl: '/assets/pin.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});

const FALLBACK_LOCATION = [53.4808, -2.2426];

function formatMoney(value) {
    return `£${Number(value || 0).toFixed(2)}`;
}

function formatClock(seconds) {
    const totalSeconds = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function parsePointToLatLng(pointValue) {
    if (!pointValue) return null;

    if (typeof pointValue === 'object' && Array.isArray(pointValue.coordinates)) {
        return [pointValue.coordinates[1], pointValue.coordinates[0]];
    }

    if (typeof pointValue === 'string') {
        const match = pointValue.match(/POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/);
        if (match) {
            return [parseFloat(match[2]), parseFloat(match[1])];
        }
    }

    return null;
}

function calculateDistanceMiles(fromLat, fromLng, toLat, toLng) {
    const radius = 3958.8;
    const dLat = (toLat - fromLat) * (Math.PI / 180);
    const dLng = (toLng - fromLng) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(fromLat * (Math.PI / 180)) * Math.cos(toLat * (Math.PI / 180)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return radius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function inferVehicleType(rawType) {
    const normalized = String(rawType || '').toLowerCase();

    if (!normalized) return 'Clinch Standard';
    if (normalized.includes('electric') || normalized.includes('ev')) return 'Clinch Electric';
    if (normalized.includes('estate') || normalized.includes('wagon') || normalized.includes('suv') || normalized.includes('van') || normalized.includes('mpv')) {
        return 'Clinch Large';
    }

    return 'Clinch Standard';
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) return null;
    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:(.*?);base64/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
}

export default function DriverApp() {
    const { user } = useAuth();

    const [isOnline, setIsOnline] = useState(false);
    const [setupComplete, setSetupComplete] = useState(false);
    const [driverDetails, setDriverDetails] = useState({
        vehicle_type: 'Clinch Standard',
        car_model: '',
        license_plate: '',
        car_color: ''
    });

    const [vehiclePhotos, setVehiclePhotos] = useState({
        plate: '',
        front: '',
        back: '',
        side: ''
    });

    const [isAnalyzingVehicle, setIsAnalyzingVehicle] = useState(false);
    const [vehicleAnalysisError, setVehicleAnalysisError] = useState('');
    const [useCustomRates, setUseCustomRates] = useState(false);
    const [driverRateProfile, setDriverRateProfile] = useState(DEFAULT_DRIVER_RATE_PROFILE);

    const [driverRowId, setDriverRowId] = useState(null);
    const [rideRequests, setRideRequests] = useState([]);
    const [activeRide, setActiveRide] = useState(null);

    const [location, setLocation] = useState(FALLBACK_LOCATION);
    const locationRef = useRef(FALLBACK_LOCATION);
    const [hasFix, setHasFix] = useState(false);
    const hasFixRef = useRef(false);
    useEffect(() => { hasFixRef.current = hasFix; }, [hasFix]);

    const [meterRunning, setMeterRunning] = useState(false);
    const [meterStartedAt, setMeterStartedAt] = useState(null);
    const [meterBaseFare, setMeterBaseFare] = useState(0);
    const [meterElapsedSeconds, setMeterElapsedSeconds] = useState(0);
    const rateSnapshotRef = useRef(DEFAULT_DRIVER_RATE_PROFILE);

    const [isConnectingStripe, setIsConnectingStripe] = useState(false);
    const [showBidToolsForRideId, setShowBidToolsForRideId] = useState(null);
    const [monthlySummary, setMonthlySummary] = useState({
        ridesCount: 0,
        totalEarned: 0
    });

    const MotionDiv = motion.div;
    const hasAllVehiclePhotos = Boolean(vehiclePhotos.plate && vehiclePhotos.front && vehiclePhotos.back && vehiclePhotos.side);
    const monthLabel = useMemo(
        () => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date()),
        []
    );

    const logRideAuditEvent = useCallback(async (rideOrClinchId, eventLabel) => {
        if (!eventLabel) return;

        const clinchId = typeof rideOrClinchId === 'string'
            ? rideOrClinchId
            : rideOrClinchId?.clinch_id;

        if (!clinchId) return;

        try {
            await supabase
                .from('clinch_history')
                .insert([{
                    clinch_id: clinchId,
                    previous_terms: 'RIDE_AUDIT_EVENT',
                    new_terms: eventLabel,
                    changed_by_phone: user?.phone || 'driver',
                    changed_at: new Date().toISOString()
                }]);
        } catch {
            // Do not block ride workflow for audit logging failures.
        }
    }, [user]);

    const loadMonthlySummary = useCallback(async () => {
        if (!user?.id) {
            setMonthlySummary({ ridesCount: 0, totalEarned: 0 });
            return;
        }

        let resolvedDriverId = driverRowId;
        if (!resolvedDriverId) {
            const { data: existingDriver } = await supabase
                .from('active_drivers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            resolvedDriverId = existingDriver?.id || null;
            if (resolvedDriverId) {
                setDriverRowId((current) => current || resolvedDriverId);
            }
        }

        if (!resolvedDriverId) {
            setMonthlySummary({ ridesCount: 0, totalEarned: 0 });
            return;
        }

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select('current_bid')
                .eq('assigned_driver_id', resolvedDriverId)
                .eq('status', 'completed')
                .gte('created_at', monthStart);

            if (error) throw error;

            const rides = data || [];
            const totalEarned = roundToPence(
                rides.reduce((sum, ride) => sum + Number(ride.current_bid || 0), 0)
            );

            setMonthlySummary({
                ridesCount: rides.length,
                totalEarned
            });
        } catch {
            setMonthlySummary({ ridesCount: 0, totalEarned: 0 });
        }
    }, [user, driverRowId]);

    useEffect(() => {
        loadMonthlySummary();
    }, [loadMonthlySummary]);

    useEffect(() => {
        const savedCar = user?.user_metadata?.car_1;
        if (savedCar) {
            setDriverDetails((current) => ({
                ...current,
                car_model: savedCar.model || current.car_model,
                license_plate: savedCar.plate || current.license_plate,
                car_color: savedCar.color || current.car_color,
                vehicle_type: savedCar.vehicle_type || current.vehicle_type
            }));
        }

        const savedRate = user?.user_metadata?.driver_rate_profile;
        if (savedRate) {
            setUseCustomRates(true);
            setDriverRateProfile(normalizeRateProfile(savedRate));
        }
    }, [user?.user_metadata]);

    useEffect(() => {
        if (!isOnline) return;

        const fetchSearchingRides = async () => {
            const { data } = await supabase
                .from('ride_requests')
                .select('*')
                .eq('status', 'searching')
                .order('created_at', { ascending: false });

            setRideRequests(data || []);
        };

        fetchSearchingRides();

        const ridesChannel = supabase.channel('driver_searching_rides')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'ride_requests' },
                (payload) => {
                    if (payload.eventType === 'INSERT' && payload.new.status === 'searching') {
                        setRideRequests((current) => {
                            if (current.some((ride) => ride.id === payload.new.id)) return current;
                            return [payload.new, ...current];
                        });
                        return;
                    }

                    if (payload.eventType === 'UPDATE') {
                        if (payload.new.status === 'searching') {
                            setRideRequests((current) => current.map((ride) => (
                                ride.id === payload.new.id ? payload.new : ride
                            )));
                        } else {
                            setRideRequests((current) => current.filter((ride) => ride.id !== payload.new.id));
                        }
                        return;
                    }

                    if (payload.eventType === 'DELETE') {
                        setRideRequests((current) => current.filter((ride) => ride.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(ridesChannel);
        };
    }, [isOnline]);

    useEffect(() => {
        if (!isOnline || !driverRowId) return;

        let currentLocation = [...locationRef.current];

        const pushLocation = async () => {
            let gotRealFix = false;
            try {
                const gps = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 3000
                });

                currentLocation = [gps.coords.latitude, gps.coords.longitude];
                gotRealFix = true;
            } catch {
                // GPS temporarily unavailable — keep the last REAL position.
                // Never fabricate coordinates or nudge a fallback location.
            }

            if (gotRealFix) {
                locationRef.current = currentLocation;
                setLocation(currentLocation);
                setHasFix(true);
            }

            // Don't publish a position we've never actually measured
            if (!locationRef.current || (!gotRealFix && !hasFixRef.current)) return;

            await supabase
                .from('active_drivers')
                .update({
                    location: `POINT(${currentLocation[1]} ${currentLocation[0]})`,
                    last_updated: new Date().toISOString()
                })
                .eq('id', driverRowId);
        };

        pushLocation();
        const watcher = setInterval(pushLocation, 3000);

        return () => clearInterval(watcher);
    }, [isOnline, driverRowId]);

    useEffect(() => {
        rateSnapshotRef.current = normalizeRateProfile(activeRide?.rate_snapshot || DEFAULT_DRIVER_RATE_PROFILE);
    }, [activeRide?.id, activeRide?.rate_snapshot]);

    useEffect(() => {
        if (!activeRide?.id) return;

        const activeRideChannel = supabase.channel(`driver_active_ride_${activeRide.id}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'ride_requests', filter: `id=eq.${activeRide.id}` },
                (payload) => {
                    setActiveRide((current) => (current ? { ...current, ...payload.new } : current));

                    if (payload.new.status === 'cancelled') {
                        logRideAuditEvent(payload.new.clinch_id, 'RIDE_CANCELLED');
                        setMeterRunning(false);
                        setMeterStartedAt(null);
                        setMeterElapsedSeconds(0);
                        setActiveRide(null);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(activeRideChannel);
        };
    }, [activeRide?.id, logRideAuditEvent]);

    useEffect(() => {
        if (!meterRunning || !meterStartedAt || !activeRide?.id) return;

        const interval = setInterval(async () => {
            const elapsedSeconds = Math.floor((Date.now() - meterStartedAt) / 1000);
            const nextFare = calculateLiveFareWithProfile({
                baseFare: meterBaseFare,
                elapsedSeconds,
                rateProfile: rateSnapshotRef.current
            });

            setMeterElapsedSeconds(elapsedSeconds);
            setActiveRide((current) => (current ? { ...current, current_bid: nextFare, status: 'in_progress' } : current));

            await supabase
                .from('ride_requests')
                .update({
                    status: 'in_progress',
                    current_bid: nextFare
                })
                .eq('id', activeRide.id);
        }, 1000);

        return () => clearInterval(interval);
    }, [meterRunning, meterStartedAt, meterBaseFare, activeRide?.id]);

    const handleVehiclePhotoCapture = async (slot, file) => {
        if (!file) return;

        try {
            const dataUrl = await fileToDataUrl(file);
            setVehiclePhotos((current) => ({ ...current, [slot]: dataUrl }));
            setVehicleAnalysisError('');
        } catch (error) {
            console.error('Failed to read photo:', error);
        }
    };

    const autoFillVehicleDetails = async () => {
        if (!hasAllVehiclePhotos || isAnalyzingVehicle) return;

        setIsAnalyzingVehicle(true);
        setVehicleAnalysisError('');

        try {
            const { data, error } = await supabase.functions.invoke('vehicle-vision', {
                body: {
                    plateImage: vehiclePhotos.plate,
                    frontImage: vehiclePhotos.front,
                    backImage: vehiclePhotos.back,
                    sideImage: vehiclePhotos.side
                }
            });

            if (error) throw error;

            const vehicle = data?.vehicle || data || {};
            const inferredModel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ').trim();

            setDriverDetails((current) => ({
                ...current,
                car_model: inferredModel || vehicle.car_model || current.car_model,
                license_plate: String(vehicle.license_plate || current.license_plate || '').toUpperCase(),
                car_color: vehicle.color || current.car_color,
                vehicle_type: inferVehicleType(vehicle.vehicle_type || vehicle.body_style || current.vehicle_type)
            }));
        } catch (error) {
            console.error('Vehicle AI autofill failed:', error);
            setVehicleAnalysisError('Could not auto-fill this time. You can still edit manually.');
        } finally {
            setIsAnalyzingVehicle(false);
        }
    };

    const saveSetup = async () => {
        if (!driverDetails.car_model.trim() || !driverDetails.license_plate.trim()) return;

        const photoPaths = {
            plate: '',
            front: '',
            back: '',
            side: ''
        };

        try {
            if (user?.id) {
                for (const [slot, dataUrl] of Object.entries(vehiclePhotos)) {
                    if (!dataUrl) continue;
                    const blob = dataUrlToBlob(dataUrl);
                    if (!blob) continue;

                    const path = `${user.id}/car_1/${slot}.jpg`;
                    const { error: uploadError } = await supabase
                        .storage
                        .from('vehicle-images')
                        .upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });

                    if (!uploadError) photoPaths[slot] = path;
                }
            }

            await supabase.auth.updateUser({
                data: {
                    car_1: {
                        model: driverDetails.car_model,
                        plate: driverDetails.license_plate,
                        color: driverDetails.car_color,
                        vehicle_type: driverDetails.vehicle_type,
                        photos: photoPaths,
                        updated_at: new Date().toISOString()
                    },
                    driver_rate_profile: normalizeRateProfile(
                        useCustomRates ? driverRateProfile : DEFAULT_DRIVER_RATE_PROFILE
                    )
                }
            });
        } catch (error) {
            console.error('Could not store car_1 metadata:', error);
        }

        setSetupComplete(true);
    };

    const getEffectiveDriverRateProfile = () => {
        if (useCustomRates) return normalizeRateProfile(driverRateProfile);
        return normalizeRateProfile(DEFAULT_DRIVER_RATE_PROFILE);
    };

    const fetchDriverRateProfile = async (driverId) => {
        try {
            const { data, error } = await supabase
                .from('driver_rate_profiles')
                .select('*')
                .eq('driver_id', driverId)
                .eq('is_active', true)
                .maybeSingle();

            if (error || !data) return normalizeRateProfile(DEFAULT_DRIVER_RATE_PROFILE);
            return normalizeRateProfile(data);
        } catch {
            return normalizeRateProfile(DEFAULT_DRIVER_RATE_PROFILE);
        }
    };

    const upsertDriverRateProfile = async (driverId) => {
        const effectiveProfile = getEffectiveDriverRateProfile();

        try {
            await supabase
                .from('driver_rate_profiles')
                .upsert({
                    driver_id: driverId,
                    is_active: true,
                    ...effectiveProfile
                }, { onConflict: 'driver_id' });
        } catch {
            // Keep default-first flow working even before SQL migration is run.
        }

        return effectiveProfile;
    };

    const updateRideWithFallback = async (rideId, payload, fallbackPayload = null) => {
        const { error } = await supabase
            .from('ride_requests')
            .update(payload)
            .eq('id', rideId);

        if (error && fallbackPayload) {
            await supabase
                .from('ride_requests')
                .update(fallbackPayload)
                .eq('id', rideId);
        }
    };

    const ensureDriverRowOnline = async () => {
        if (!user?.id) {
            alert('Please log in before going online.');
            return null;
        }

        const driverName = user?.user_metadata?.full_name || 'Driver Assigned';
        const vehicleLabel = `${driverDetails.car_color ? `${driverDetails.car_color} ` : ''}${driverDetails.car_model}`.trim();
        const vehicleDetails = `${driverName} ||| ${vehicleLabel} • ${driverDetails.license_plate}`;

        const { data: existingDriver } = await supabase
            .from('active_drivers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (existingDriver?.id) {
            await supabase
                .from('active_drivers')
                .update({
                    phone_number: user?.phone || '00000000000',
                    vehicle_type: driverDetails.vehicle_type,
                    vehicle_details: vehicleDetails,
                    status: 'online',
                    location: `POINT(${FALLBACK_LOCATION[1]} ${FALLBACK_LOCATION[0]})`
                })
                .eq('id', existingDriver.id);

            setDriverRowId(existingDriver.id);
            return existingDriver.id;
        }

        const { data: insertedDriver } = await supabase
            .from('active_drivers')
            .insert([{
                user_id: user.id,
                phone_number: user?.phone || '00000000000',
                vehicle_type: driverDetails.vehicle_type,
                vehicle_details: vehicleDetails,
                status: 'online',
                location: `POINT(${FALLBACK_LOCATION[1]} ${FALLBACK_LOCATION[0]})`
            }])
            .select('id')
            .single();

        if (!insertedDriver?.id) return null;

        setDriverRowId(insertedDriver.id);
        return insertedDriver.id;
    };

    const handleGoOnline = async () => {
        if (!setupComplete) return;
        const rowId = await ensureDriverRowOnline();
        if (rowId) {
            await upsertDriverRateProfile(rowId);
            setIsOnline(true);
            await loadMonthlySummary();
        }
    };

    const handleGoOffline = async () => {
        setIsOnline(false);
        setRideRequests([]);
        setMeterRunning(false);
        setMeterStartedAt(null);
        setMeterElapsedSeconds(0);
        setActiveRide(null);
        setShowBidToolsForRideId(null);

        if (driverRowId) {
            await supabase
                .from('active_drivers')
                .update({ status: 'offline' })
                .eq('id', driverRowId);
        }
    };

    const connectStripe = async () => {
        if (isConnectingStripe) return;

        setIsConnectingStripe(true);

        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect', {});

            if (error || !data?.url) {
                console.error('Stripe onboarding failed:', error || data?.error);
                return;
            }

            await Browser.open({ url: data.url });
        } catch (error) {
            console.error('Stripe connect failed:', error);
        } finally {
            setIsConnectingStripe(false);
        }
    };

    const acceptRide = async (ride) => {
        if (!driverRowId) return;

        const rateProfile = await fetchDriverRateProfile(driverRowId);
        const pickupPos = parsePointToLatLng(ride.pickup_location);
        const dropoffPos = parsePointToLatLng(ride.dropoff_location);
        const rideDistanceMiles = pickupPos && dropoffPos
            ? roundToPence(calculateDistanceMiles(pickupPos[0], pickupPos[1], dropoffPos[0], dropoffPos[1]))
            : Number(ride.estimated_distance_miles || 0);
        const includeEstateCar = String(ride.vehicle_type || '').toLowerCase().includes('estate');
        const startFare = calculateBaseFareWithProfile({
            distanceMiles: rideDistanceMiles,
            includeEstateCar,
            rateProfile
        });

        const matchedRide = {
            ...ride,
            current_bid: startFare,
            status: 'accepted',
            assigned_driver_id: driverRowId,
            rate_snapshot: rateProfile,
            estimated_distance_miles: rideDistanceMiles
        };

        setActiveRide(matchedRide);
        setMeterBaseFare(startFare);
        setMeterElapsedSeconds(0);
        setMeterStartedAt(null);
        setMeterRunning(false);

        await updateRideWithFallback(
            ride.id,
            {
                status: 'accepted',
                assigned_driver_id: driverRowId,
                current_bid: startFare,
                rate_snapshot: rateProfile,
                estimated_distance_miles: rideDistanceMiles,
                matched_by: 'accept'
            },
            {
                status: 'accepted',
                assigned_driver_id: driverRowId,
                current_bid: startFare
            }
        );
        await logRideAuditEvent(ride, `DRIVER_ACCEPTED ${formatMoney(startFare)}`);

        await supabase
            .from('active_drivers')
            .update({ status: 'busy' })
            .eq('id', driverRowId);

        setRideRequests((current) => current.filter((item) => item.id !== ride.id));
        setShowBidToolsForRideId(null);
    };

    const rejectRide = async (ride) => {
        if (!driverRowId) return;

        await supabase
            .from('ride_rejections')
            .insert([{ ride_id: ride.id, driver_id: driverRowId }]);

        setRideRequests((current) => current.filter((item) => item.id !== ride.id));
        if (showBidToolsForRideId === ride.id) {
            setShowBidToolsForRideId(null);
        }
    };

    const placeBid = async (ride, increment) => {
        if (!driverRowId) return;

        const bidAmount = roundToPence(Number(ride.current_bid || 0) + Number(increment || 0));

        try {
            await supabase
                .from('driver_bids')
                .insert([{
                    ride_id: ride.id,
                    driver_id: driverRowId,
                    bid_amount: bidAmount,
                    status: 'pending',
                    expires_at: new Date(Date.now() + (30 * 1000)).toISOString()
                }]);
        } catch {
            // Keep UX working even if bids table hasn't been migrated yet.
        }

        await updateRideWithFallback(
            ride.id,
            {
                current_bid: bidAmount,
                bid_window_ends_at: new Date(Date.now() + (30 * 1000)).toISOString()
            },
            { current_bid: bidAmount }
        );

        setRideRequests((current) => current.map((item) => (
            item.id === ride.id ? { ...item, current_bid: bidAmount } : item
        )));

        await logRideAuditEvent(ride, `DRIVER_BID ${formatMoney(bidAmount)}`);
    };

    const startMeter = async () => {
        if (!activeRide?.id || meterRunning) return;

        setMeterBaseFare(Number(activeRide.current_bid || 0));
        setMeterElapsedSeconds(0);
        setMeterStartedAt(Date.now());
        setMeterRunning(true);

        await supabase
            .from('ride_requests')
            .update({ status: 'in_progress' })
            .eq('id', activeRide.id);
        await logRideAuditEvent(activeRide, `METER_STARTED ${formatMoney(activeRide.current_bid)}`);
    };

    const addOneWaitingMinute = async () => {
        if (!activeRide?.id) return;

        const waitingRate = Number(
            activeRide?.rate_snapshot?.per_minute_waiting ?? DEFAULT_DRIVER_RATE_PROFILE.per_minute_waiting
        );
        const nextBase = roundToPence(meterBaseFare + waitingRate);
        const nextFare = roundToPence(Number(activeRide.current_bid || 0) + waitingRate);

        setMeterBaseFare(nextBase);
        setActiveRide((current) => (current ? { ...current, current_bid: nextFare } : current));

        await supabase
            .from('ride_requests')
            .update({ current_bid: nextFare })
            .eq('id', activeRide.id);
        await logRideAuditEvent(activeRide, `WAITING_INCREMENT ${formatMoney(nextFare)}`);
    };

    const completeRideAndCollectCash = async () => {
        if (!activeRide?.id) return;

        const finalFare = Number(activeRide.current_bid || meterBaseFare);
        const completedAt = new Date().toISOString();

        setMeterRunning(false);
        setMeterStartedAt(null);
        setMeterElapsedSeconds(0);

        const { error: paymentStatusError } = await supabase
            .from('ride_requests')
            .update({
                status: 'completed',
                current_bid: finalFare,
                payment_status: 'unpaid'
            })
            .eq('id', activeRide.id);

        if (paymentStatusError) {
            await supabase
                .from('ride_requests')
                .update({
                    status: 'completed',
                    current_bid: finalFare
                })
                .eq('id', activeRide.id);
        }
        await logRideAuditEvent(activeRide, `DRIVER_MARKED_COMPLETED ${formatMoney(finalFare)} @ ${completedAt}`);

        if (driverRowId) {
            await supabase
                .from('active_drivers')
                .update({ status: 'online' })
                .eq('id', driverRowId);
        }

        setActiveRide((current) => (current
            ? { ...current, status: 'completed', current_bid: finalFare, payment_status: current.payment_status || 'unpaid' }
            : current
        ));
    };

    const confirmCashReceived = async () => {
        if (!activeRide?.id) return;

        const paidAt = new Date().toISOString();

        try {
            await supabase
                .from('ride_requests')
                .update({
                    payment_method: 'cash',
                    payment_status: 'driver_confirmed',
                    driver_paid_at: paidAt
                })
                .eq('id', activeRide.id);
        } catch {
            // Keep payout confirmation resilient if columns are not migrated yet.
        }

        if (activeRide?.clinch_id) {
            await supabase
                .from('clinches')
                .update({ resolved_at: paidAt })
                .eq('id', activeRide.clinch_id);
            await logRideAuditEvent(activeRide, `DRIVER_CONFIRMED_CASH_RECEIVED ${formatMoney(activeRide.current_bid)}`);
        }

        setActiveRide(null);
        setMeterRunning(false);
        setMeterStartedAt(null);
        setMeterElapsedSeconds(0);
        await loadMonthlySummary();
    };

    const closeSettledRide = async () => {
        if (activeRide?.clinch_id) {
            await logRideAuditEvent(activeRide, `RIDE_SETTLEMENT_CLOSED ${formatMoney(activeRide.current_bid)}`);
        }
        setActiveRide(null);
        setMeterRunning(false);
        setMeterStartedAt(null);
        setMeterElapsedSeconds(0);
        await loadMonthlySummary();
    };

    const effectiveRatePreview = getEffectiveDriverRateProfile();
    const activeWaitingRate = Number(
        activeRide?.rate_snapshot?.per_minute_waiting ?? effectiveRatePreview.per_minute_waiting
    );
    const activePaymentStatus = activeRide?.payment_status || 'unpaid';
    const isCompletedRide = activeRide?.status === 'completed';
    const updateRateField = (field, rawValue) => {
        const numericValue = Number(rawValue);
        setDriverRateProfile((current) => ({
            ...current,
            [field]: Number.isFinite(numericValue) ? numericValue : 0
        }));
    };

    if (!setupComplete) {
        const captureSteps = [
            { id: 'plate', title: '1. Plate Photo', hint: 'Close photo of number plate' },
            { id: 'front', title: '2. Front Photo', hint: 'Whole front of the car' },
            { id: 'back', title: '3. Back Photo', hint: 'Whole back of the car' },
            { id: 'side', title: '4. Side Photo', hint: 'Whole side of the car' }
        ];

        return (
            <div style={{ padding: '18px', background: '#FFFFFF', borderRadius: '24px', height: '100%', overflowY: 'auto' }}>
                <h2 style={{ fontSize: '24px', fontWeight: '900', color: '#FFFFFF', marginBottom: '6px' }}>Add Car in 60 Seconds</h2>
                <p style={{ fontSize: '14px', color: '#757575', marginBottom: '14px' }}>Take 4 photos. AI fills your car details automatically.</p>

                <div style={{ display: 'grid', gap: '10px', marginBottom: '12px' }}>
                    {captureSteps.map((step) => (
                        <div key={step.id} style={{ border: '1px solid #E5E7EB', borderRadius: '14px', padding: '12px' }}>
                            <div style={{ fontSize: '14px', fontWeight: '900', color: '#FFFFFF' }}>{step.title}</div>
                            <div style={{ fontSize: '12px', color: '#757575', marginTop: '2px', marginBottom: '8px' }}>{step.hint}</div>

                            {vehiclePhotos[step.id] ? (
                                <img
                                    src={vehiclePhotos[step.id]}
                                    alt={step.title}
                                    style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', marginBottom: '8px' }}
                                />
                            ) : (
                                <div style={{ width: '100%', height: '120px', borderRadius: '10px', background: '#F3F4F6', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontWeight: '700' }}>
                                    No photo yet
                                </div>
                            )}

                            <label style={{ display: 'block', width: '100%', textAlign: 'center', background: '#F3F4F6', borderRadius: '10px', padding: '11px', fontSize: '13px', fontWeight: '800', color: '#374151', cursor: 'pointer' }}>
                                {vehiclePhotos[step.id] ? 'Retake Photo' : 'Take Photo'}
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    style={{ display: 'none' }}
                                    onChange={(event) => handleVehiclePhotoCapture(step.id, event.target.files?.[0])}
                                />
                            </label>
                        </div>
                    ))}
                </div>

                <button
                    onClick={autoFillVehicleDetails}
                    disabled={!hasAllVehiclePhotos || isAnalyzingVehicle}
                    style={{
                        width: '100%',
                        border: 'none',
                        borderRadius: '14px',
                        padding: '16px',
                        fontSize: '17px',
                        fontWeight: '900',
                        background: hasAllVehiclePhotos ? '#008080' : '#E0E0E0',
                        color: hasAllVehiclePhotos ? '#000000' : '#9A9A9A',
                        cursor: hasAllVehiclePhotos ? 'pointer' : 'default',
                        marginBottom: '10px'
                    }}
                >
                    {isAnalyzingVehicle ? 'AI Reading Photos...' : 'Auto-fill Car Details'}
                </button>

                {vehicleAnalysisError && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: '12px', padding: '10px', fontSize: '12px', fontWeight: '700', marginBottom: '10px' }}>
                        {vehicleAnalysisError}
                    </div>
                )}

                <div style={{ display: 'grid', gap: '8px', marginBottom: '10px' }}>
                    <input
                        value={driverDetails.car_color}
                        onChange={(event) => setDriverDetails((current) => ({ ...current, car_color: event.target.value }))}
                        placeholder="Color (e.g. Black)"
                        style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '12px', fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}
                    />
                    <input
                        value={driverDetails.car_model}
                        onChange={(event) => setDriverDetails((current) => ({ ...current, car_model: event.target.value }))}
                        placeholder="Car model (e.g. Toyota Prius)"
                        style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '12px', fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}
                    />
                    <input
                        value={driverDetails.license_plate}
                        onChange={(event) => setDriverDetails((current) => ({ ...current, license_plate: event.target.value.toUpperCase() }))}
                        placeholder="Plate (e.g. XY71 ABC)"
                        style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '12px', fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}
                    />
                    <select
                        value={driverDetails.vehicle_type}
                        onChange={(event) => setDriverDetails((current) => ({ ...current, vehicle_type: event.target.value }))}
                        style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '12px', fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}
                    >
                        <option>Clinch Standard</option>
                        <option>Clinch Electric</option>
                        <option>Clinch Large</option>
                    </select>
                </div>

                <div style={{ border: '1px solid #E5E7EB', borderRadius: '14px', padding: '12px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '900', color: '#FFFFFF', marginBottom: '6px' }}>Driver Rate Mode</div>
                    <button
                        onClick={() => setUseCustomRates((current) => !current)}
                        style={{
                            width: '100%',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '11px',
                            fontSize: '13px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: useCustomRates ? 'rgba(0,128,128,0.08)' : '#F3F4F6',
                            color: '#FFFFFF'
                        }}
                    >
                        {useCustomRates ? 'Using My Custom Rates' : 'Using Default Rates (Recommended)'}
                    </button>

                    {useCustomRates && (
                        <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={driverRateProfile.first_mile_fare}
                                onChange={(event) => updateRateField('first_mile_fare', event.target.value)}
                                placeholder="First mile fare"
                                style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: '700', color: '#FFFFFF' }}
                            />
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={driverRateProfile.per_mile_2_3}
                                onChange={(event) => updateRateField('per_mile_2_3', event.target.value)}
                                placeholder="Per mile (2-3 miles)"
                                style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: '700', color: '#FFFFFF' }}
                            />
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={driverRateProfile.per_mile_after_3}
                                onChange={(event) => updateRateField('per_mile_after_3', event.target.value)}
                                placeholder="Per mile (after 3 miles)"
                                style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: '700', color: '#FFFFFF' }}
                            />
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={driverRateProfile.per_minute_waiting}
                                onChange={(event) => updateRateField('per_minute_waiting', event.target.value)}
                                placeholder="Waiting per minute"
                                style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: '700', color: '#FFFFFF' }}
                            />
                        </div>
                    )}
                </div>

                <button
                    onClick={saveSetup}
                    disabled={!driverDetails.car_model.trim() || !driverDetails.license_plate.trim()}
                    style={{
                        width: '100%',
                        border: 'none',
                        borderRadius: '14px',
                        padding: '16px',
                        fontSize: '17px',
                        fontWeight: '900',
                        background: driverDetails.car_model.trim() && driverDetails.license_plate.trim() ? '#98FF98' : '#E0E0E0',
                        color: driverDetails.car_model.trim() && driverDetails.license_plate.trim() ? '#055E5E' : '#9A9A9A',
                        cursor: driverDetails.car_model.trim() && driverDetails.license_plate.trim() ? 'pointer' : 'default',
                        marginBottom: '10px'
                    }}
                >
                    Save Car 1
                </button>

                <button
                    onClick={connectStripe}
                    disabled={isConnectingStripe}
                    style={{
                        width: '100%',
                        border: '1px solid #D1D5DB',
                        borderRadius: '14px',
                        padding: '14px',
                        fontSize: '15px',
                        fontWeight: '800',
                        background: '#000000',
                        color: '#1F2937',
                        cursor: 'pointer'
                    }}
                >
                    {isConnectingStripe ? 'Opening Stripe...' : 'Connect Stripe (Optional)'}
                </button>

                <div style={{ marginTop: '12px', fontSize: '12px', color: '#16A34A', fontWeight: '800', textAlign: 'center' }}>
                    Saved to your identity by phone + account. Cash collection stays default.
                </div>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%', borderRadius: '24px', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
                <MapContainer
                    center={location}
                    zoom={15}
                    style={{ width: '100%', height: '100%' }}
                    zoomControl={false}
                    attributionControl={false}
                >
                    <TileLayer
                        url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                        attribution="&copy; Google Maps"
                    />

                    {isOnline && hasFix && <Marker position={location} icon={driverIcon} />}

                    {isOnline && !activeRide && rideRequests.map((ride) => {
                        const pickupPos = parsePointToLatLng(ride.pickup_location) || FALLBACK_LOCATION;
                        return <Marker key={ride.id} position={pickupPos} icon={pickupIcon} />;
                    })}

                    {isOnline && activeRide && (
                        <>
                            {activeRide.pickup_location && <Marker position={parsePointToLatLng(activeRide.pickup_location) || FALLBACK_LOCATION} icon={pickupIcon} />}
                            {activeRide.dropoff_location && (
                                <Marker 
                                    position={parsePointToLatLng(activeRide.dropoff_location) || FALLBACK_LOCATION} 
                                    icon={L.divIcon({
                                        className: '',
                                        html: '<div style="width:12px;height:12px;background:#D4CFC9;border-radius:50%;border:2px solid #FFF;box-shadow:0 0 8px rgba(212,207,201,0.4);"></div>',
                                        iconSize: [12, 12], 
                                        iconAnchor: [6, 6]
                                    })} 
                                />
                            )}
                        </>
                    )}
                </MapContainer>

                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(235, 245, 245, 1) 15%, transparent 60%)', zIndex: 400, pointerEvents: 'none' }} />
            </div>

            <div style={{ position: 'absolute', top: 14, left: 14, right: 14, zIndex: 20 }}>
                <div style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '14px', boxShadow: '0 6px 14px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '900', color: '#FFFFFF', fontSize: '14px' }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: isOnline ? '#00FA9A' : '#E5E7EB' }} />
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </div>
                            <div style={{ fontSize: '12px', color: '#757575', marginTop: '2px' }}>
                                {`${driverDetails.car_color ? `${driverDetails.car_color} ` : ''}${driverDetails.car_model || 'Taxi'} • ${driverDetails.license_plate || 'Plate'}`}
                            </div>
                        </div>

                        <button
                            onClick={isOnline ? handleGoOffline : handleGoOnline}
                            style={{
                                border: 'none',
                                borderRadius: '10px',
                                padding: '10px 16px',
                                fontWeight: '800',
                                color: '#000000',
                                background: isOnline ? '#EF4444' : '#008080',
                                cursor: 'pointer'
                            }}
                        >
                            {isOnline ? 'Go Offline' : 'Go Online'}
                        </button>
                    </div>

                    <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '12px 14px', boxShadow: '0 6px 14px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '12px', fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.7px' }}>{monthLabel}</span>
                            <span style={{ fontSize: '24px', fontWeight: '900', color: '#008080' }}>{formatMoney(monthlySummary.totalEarned)}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#4B5563', fontWeight: '700' }}>
                            Earnings this month • {monthlySummary.ridesCount} completed ride{monthlySummary.ridesCount === 1 ? '' : 's'}
                        </div>
                    </div>
                </div>
            </div>

            {isOnline && !activeRide && (
                <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 20 }}>
                    <div style={{ background: '#FFFFFF', borderRadius: '22px', padding: '18px', boxShadow: '0 12px 40px rgba(0,0,0,0.16)', maxHeight: '360px', overflowY: 'auto' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: '900', color: '#FFFFFF', marginBottom: '4px' }}>Ride Queue ({rideRequests.length})</h3>
                        <p style={{ fontSize: '12px', color: '#757575', fontWeight: '700', marginBottom: '12px' }}>Tap Accept to take a job. Cash is default.</p>

                        {rideRequests.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '18px 0' }}>
                                <img src="/assets/searching.png" alt="Waiting for rides" style={{ width: '58px', opacity: 0.55, marginBottom: '10px' }} />
                                <div style={{ fontSize: '13px', color: '#757575', fontWeight: '700' }}>Waiting for nearby requests...</div>
                            </div>
                        ) : (
                            <AnimatePresence>
                                {rideRequests.map((ride) => (
                                    <MotionDiv
                                        key={ride.id}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '14px', marginBottom: '10px' }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <div style={{ fontSize: '25px', fontWeight: '900', color: '#008080' }}>{formatMoney(ride.current_bid)}</div>
                                            <div style={{ fontSize: '11px', fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                                                Start Fare
                                            </div>
                                        </div>

                                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#FFFFFF', marginBottom: '2px' }}>{ride.destination_text}</div>
                                        <div style={{ fontSize: '11px', color: '#757575', marginBottom: '10px' }}>{ride.vehicle_type} • +{formatMoney(effectiveRatePreview.per_minute_waiting)}/min meter</div>

                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={() => rejectRide(ride)}
                                                style={{ flex: 1, border: 'none', borderRadius: '11px', padding: '11px', background: '#F3F4F6', color: '#6B7280', fontWeight: '800', cursor: 'pointer' }}
                                            >
                                                Skip
                                            </button>
                                            <button
                                                onClick={() => acceptRide(ride)}
                                                style={{ flex: 1, border: 'none', borderRadius: '11px', padding: '11px', background: '#008080', color: '#000000', fontWeight: '900', cursor: 'pointer' }}
                                            >
                                                Accept
                                            </button>
                                        </div>

                                        <button
                                            onClick={() => setShowBidToolsForRideId((current) => (current === ride.id ? null : ride.id))}
                                            style={{
                                                width: '100%',
                                                border: '1px solid #E5E7EB',
                                                borderRadius: '10px',
                                                padding: '9px',
                                                background: '#000000',
                                                color: '#4B5563',
                                                fontWeight: '800',
                                                cursor: 'pointer',
                                                fontSize: '12px',
                                                marginTop: '8px'
                                            }}
                                        >
                                            {showBidToolsForRideId === ride.id ? 'Hide Bid Options' : 'More Options (Bid)'}
                                        </button>

                                        {showBidToolsForRideId === ride.id && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '8px' }}>
                                                <button
                                                    onClick={() => placeBid(ride, 1)}
                                                    style={{ border: '1px solid #D1D5DB', borderRadius: '10px', padding: '9px', background: '#FFFFFF', color: '#000', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
                                                >
                                                    Bid +£1
                                                </button>
                                                <button
                                                    onClick={() => placeBid(ride, 2)}
                                                    style={{ border: '1px solid #D1D5DB', borderRadius: '10px', padding: '9px', background: '#FFFFFF', color: '#000', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
                                                >
                                                    Bid +£2
                                                </button>
                                                <button
                                                    onClick={() => placeBid(ride, 3)}
                                                    style={{ border: '1px solid #D1D5DB', borderRadius: '10px', padding: '9px', background: '#FFFFFF', color: '#000', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
                                                >
                                                    Bid +£3
                                                </button>
                                            </div>
                                        )}
                                    </MotionDiv>
                                ))}
                            </AnimatePresence>
                        )}
                    </div>
                </div>
            )}

            {activeRide && (
                <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 20 }}>
                    <div style={{ background: '#FFFFFF', borderRadius: '22px', padding: '20px', boxShadow: '0 12px 40px rgba(0,0,0,0.16)' }}>
                        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                            <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                {isCompletedRide ? 'Trip Ended' : 'Live Meter'}
                            </div>
                            <div style={{ fontSize: '48px', fontWeight: '900', color: '#008080', lineHeight: 1 }}>{formatMoney(activeRide.current_bid)}</div>
                            {!isCompletedRide && (
                                <div style={{ fontSize: '14px', fontWeight: '800', color: '#FFFFFF', marginTop: '4px' }}>Timer {formatClock(meterElapsedSeconds)}</div>
                            )}
                        </div>

                        <div style={{ background: '#F7FAFA', border: '1px solid #DCEBEB', borderRadius: '12px', padding: '12px', marginBottom: '10px', fontSize: '13px', color: '#FFFFFF', fontWeight: '700' }}>
                            Rider: {activeRide.rider_name || 'Rider'}
                            <br />
                            Destination: {activeRide.destination_text}
                        </div>

                        <div style={{
                            background: 'rgba(34, 197, 94, 0.1)',
                            border: '1px solid rgba(34, 197, 94, 0.35)',
                            borderRadius: '12px',
                            padding: '10px',
                            marginBottom: '10px',
                            fontSize: '13px',
                            color: '#166534',
                            fontWeight: '900',
                            textAlign: 'center'
                        }}>
                            {isCompletedRide
                                ? 'Payment confirmation step.'
                                : 'Cash clinch default. Collect cash when ride ends.'}
                        </div>

                        {!isCompletedRide ? (
                            !meterRunning ? (
                                <button
                                    onClick={startMeter}
                                    style={{ width: '100%', border: 'none', borderRadius: '14px', padding: '16px', background: '#008080', color: '#000000', fontSize: '18px', fontWeight: '900', cursor: 'pointer', marginBottom: '8px' }}
                                >
                                    Start Meter
                                </button>
                            ) : (
                                <button
                                    onClick={addOneWaitingMinute}
                                    style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '13px', background: '#000000', color: '#FFFFFF', fontSize: '14px', fontWeight: '800', cursor: 'pointer', marginBottom: '8px' }}
                                >
                                    +1 Waiting Minute (+{formatMoney(activeWaitingRate)})
                                </button>
                            )
                        ) : (
                            <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '10px', marginBottom: '10px', fontSize: '13px', fontWeight: '800', color: '#334155' }}>
                                {activePaymentStatus === 'unpaid' && 'Waiting for rider to mark payment.'}
                                {activePaymentStatus === 'rider_marked_paid' && 'Rider says cash paid. Confirm you received it.'}
                                {activePaymentStatus === 'driver_confirmed' && 'Cash confirmed and clinch settled.'}
                                {activePaymentStatus === 'stripe_paid' && 'Card payment completed and clinch settled.'}
                            </div>
                        )}

                        {!isCompletedRide ? (
                            <button
                                onClick={completeRideAndCollectCash}
                                style={{ width: '100%', border: 'none', borderRadius: '14px', padding: '16px', background: '#98FF98', color: '#055E5E', fontSize: '17px', fontWeight: '900', cursor: 'pointer' }}
                            >
                                End Ride
                            </button>
                        ) : (
                            <>
                                {(activePaymentStatus === 'unpaid' || activePaymentStatus === 'rider_marked_paid') && (
                                    <button
                                        onClick={confirmCashReceived}
                                        style={{ width: '100%', border: 'none', borderRadius: '14px', padding: '16px', background: '#98FF98', color: '#055E5E', fontSize: '17px', fontWeight: '900', cursor: 'pointer', marginBottom: '8px' }}
                                    >
                                        Confirm Cash Received
                                    </button>
                                )}
                                {(activePaymentStatus === 'driver_confirmed' || activePaymentStatus === 'stripe_paid') && (
                                    <button
                                        onClick={closeSettledRide}
                                        style={{ width: '100%', border: 'none', borderRadius: '14px', padding: '16px', background: '#008080', color: '#000000', fontSize: '17px', fontWeight: '900', cursor: 'pointer' }}
                                    >
                                        Done
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
