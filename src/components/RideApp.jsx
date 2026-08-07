import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DriverApp from './DriverApp';
import { Stripe } from '@capacitor-community/stripe';
import { Geolocation } from '@capacitor/geolocation';
import { triggerNotificationHaptic } from '../lib/capacitor';
import {
    calculateBaseFare,
    DEFAULT_DRIVER_RATE_PROFILE,
    estimateRangeFromProfiles,
    HASTINGS_PRICING,
    normalizeRateProfile,
    SERVICE_TYPES,
    roundToPence
} from '../lib/ridePricing';

Stripe.initialize({
    publishableKey: 'pk_live_51NQVbRCL5tNrHZkRHN5LKeBomAiocyyQp0SD955RleTQH1Hh8sQFXVtbPseI18roSTClCzL1kxPF2wBHNzQFEsmz00DIoenxwx'
});

const pickupIcon = new L.Icon({
    iconUrl: '/assets/pin.png',
    iconSize: [48, 48],
    iconAnchor: [24, 48]
});

const destinationIcon = new L.Icon({
    iconUrl: '/assets/checkeredflag.png',
    iconSize: [48, 48],
    iconAnchor: [24, 48]
});

const drivingIcon = new L.Icon({
    iconUrl: '/assets/topdowncar.png',
    iconSize: [48, 48],
    iconAnchor: [24, 24]
});

const FALLBACK_CENTER = [53.4808, -2.2426];
const DRIVER_HERE_METERS = 100;
const DRIVER_ARRIVING_METERS = 300;

function formatMoney(value) {
    return `£${Number(value || 0).toFixed(2)}`;
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

function MapBackground({ step, pickupPos, dropoffPos, driverPos }) {
    const center = pickupPos || FALLBACK_CENTER;

    return (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
            <MapContainer
                center={center}
                zoom={15.5}
                style={{ width: '100%', height: '100%' }}
                zoomControl={false}
                attributionControl={false}
            >
                <TileLayer
                    url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                    attribution="&copy; Google Maps"
                />

                <Marker position={pickupPos || FALLBACK_CENTER} icon={pickupIcon} />

                {dropoffPos && <Marker position={dropoffPos} icon={destinationIcon} />}

                {(step === 'riding' || step === 'completed' || step === 'handshake') && (
                    <Marker position={driverPos || FALLBACK_CENTER} icon={drivingIcon} />
                )}
            </MapContainer>

            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, rgba(235, 245, 245, 1) 8%, transparent 60%)',
                zIndex: 400,
                pointerEvents: 'none'
            }} />
        </div>
    );
}

function RiderApp() {
    const { user } = useAuth();
    const [step, setStep] = useState('input');
    const [destination, setDestination] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [selectedDestinationPos, setSelectedDestinationPos] = useState(null);
    const [isSearchingDest, setIsSearchingDest] = useState(false);

    const [serviceType, setServiceType] = useState(SERVICE_TYPES.METERED);
    const [includeDog, setIncludeDog] = useState(false);
    const [includeEstateCar, setIncludeEstateCar] = useState(false);
    const [distanceMiles, setDistanceMiles] = useState(0);

    const [pickupPos, setPickupPos] = useState(FALLBACK_CENTER);
    const [driverPos, setDriverPos] = useState([53.485, -2.24]);

    const [activeRideId, setActiveRideId] = useState(null);
    const [activeClinchId, setActiveClinchId] = useState(null);
    const [driver, setDriver] = useState(null);
    const driverHereAlertedRideRef = useRef(null);
    const [matchingStatus, setMatchingStatus] = useState('Looking for nearby taxi...');
    const MotionDiv = motion.div;

    const baseFare = useMemo(() => {
        return calculateBaseFare({
            distanceMiles,
            serviceType,
            includeDog,
            includeEstateCar
        });
    }, [distanceMiles, serviceType, includeDog, includeEstateCar]);

    const [liveFare, setLiveFare] = useState(0);
    const [marketEstimate, setMarketEstimate] = useState({
        minFare: baseFare,
        maxFare: baseFare,
        aboutFare: baseFare,
        sourceCount: 0
    });
    const [showAdvancedFareOptions, setShowAdvancedFareOptions] = useState(false);
    const [monthlySummary, setMonthlySummary] = useState({
        ridesCount: 0,
        totalSpent: 0
    });
    const monthLabel = useMemo(
        () => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date()),
        []
    );
    const driverPickupMeters = useMemo(() => {
        if (!driver || !pickupPos || !driverPos) return null;
        return Math.round(calculateDistanceMiles(
            pickupPos[0],
            pickupPos[1],
            driverPos[0],
            driverPos[1]
        ) * 1609.344);
    }, [driver, pickupPos, driverPos]);
    const driverArrivalStage = useMemo(() => {
        if (!driver || (step !== 'handshake' && step !== 'riding')) return null;
        if (!Number.isFinite(driverPickupMeters)) return 'on_way';
        if (driverPickupMeters <= DRIVER_HERE_METERS) return 'here';
        if (driverPickupMeters <= DRIVER_ARRIVING_METERS) return 'arriving';
        return 'on_way';
    }, [driver, step, driverPickupMeters]);
    const driverArrivalMeta = useMemo(() => {
        if (driverArrivalStage === 'here') {
            return {
                label: 'Driver is here',
                subtitle: 'Please come outside now',
                background: 'rgba(34, 197, 94, 0.14)',
                border: '1px solid rgba(34, 197, 94, 0.45)',
                color: '#166534'
            };
        }

        if (driverArrivalStage === 'arriving') {
            return {
                label: 'Driver arriving',
                subtitle: Number.isFinite(driverPickupMeters) ? `~${driverPickupMeters}m away` : 'Very close',
                background: 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#92400E'
            };
        }

        if (driverArrivalStage === 'on_way') {
            return {
                label: 'On the way',
                subtitle: Number.isFinite(driverPickupMeters) ? `~${driverPickupMeters}m away` : 'Tracking driver',
                background: 'rgba(14, 165, 233, 0.14)',
                border: '1px solid rgba(14, 165, 233, 0.4)',
                color: '#0C4A6E'
            };
        }

        return null;
    }, [driverArrivalStage, driverPickupMeters]);

    const logClinchAuditEvent = useCallback(async (clinchId, eventLabel) => {
        if (!clinchId || !eventLabel) return;

        try {
            await supabase
                .from('clinch_history')
                .insert([{
                    clinch_id: clinchId,
                    previous_terms: 'RIDE_AUDIT_EVENT',
                    new_terms: eventLabel,
                    changed_by_phone: user?.phone || 'rider',
                    changed_at: new Date().toISOString()
                }]);
        } catch {
            // Keep ride flow resilient even if audit write fails.
        }
    }, [user]);

    const loadMonthlySummary = useCallback(async () => {
        if (!user?.id) {
            setMonthlySummary({ ridesCount: 0, totalSpent: 0 });
            return;
        }

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select('current_bid')
                .eq('rider_id', user.id)
                .eq('status', 'completed')
                .gte('created_at', monthStart);

            if (error) throw error;

            const rides = data || [];
            const totalSpent = roundToPence(
                rides.reduce((sum, ride) => sum + Number(ride.current_bid || 0), 0)
            );

            setMonthlySummary({
                ridesCount: rides.length,
                totalSpent
            });
        } catch {
            setMonthlySummary({ ridesCount: 0, totalSpent: 0 });
        }
    }, [user]);

    useEffect(() => {
        loadMonthlySummary();
    }, [loadMonthlySummary]);

    useEffect(() => {
        if (driverArrivalStage !== 'here' || !activeRideId) return;
        if (driverHereAlertedRideRef.current === activeRideId) return;

        driverHereAlertedRideRef.current = activeRideId;

        triggerNotificationHaptic();
    }, [driverArrivalStage, activeRideId]);

    useEffect(() => {
        const getRealLocation = async () => {
            try {
                const coordinates = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });

                setPickupPos([coordinates.coords.latitude, coordinates.coords.longitude]);
            } catch (error) {
                console.error('Error getting location, using fallback center:', error);
                setPickupPos(FALLBACK_CENTER);
            }
        };

        getRealLocation();
    }, []);

    useEffect(() => {
        if (!destination || destination.length < 1 || selectedDestinationPos) return;

        const timeoutId = setTimeout(async () => {
            setIsSearchingDest(true);
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&viewbox=-2.3,53.5,-2.1,53.4&bounded=1&limit=4&addressdetails=1`);
                const data = await response.json();
                setSuggestions(data);
            } catch (error) {
                console.error('Destination lookup failed:', error);
            }
            setIsSearchingDest(false);
        }, 220);

        return () => clearTimeout(timeoutId);
    }, [destination, selectedDestinationPos]);

    useEffect(() => {
        let cancelled = false;

        const loadMarketEstimate = async () => {
            const fallbackEstimate = {
                minFare: baseFare,
                maxFare: baseFare,
                aboutFare: baseFare,
                sourceCount: 0
            };

            if (!selectedDestinationPos || !pickupPos) {
                setMarketEstimate(fallbackEstimate);
                return;
            }

            try {
                const { data: onlineDrivers, error: driversError } = await supabase
                    .from('active_drivers')
                    .select('id, location, status')
                    .eq('status', 'online');

                if (driversError || !onlineDrivers?.length) {
                    if (!cancelled) setMarketEstimate(fallbackEstimate);
                    return;
                }

                const nearbyDriverIds = onlineDrivers
                    .map((driverRow) => ({
                        id: driverRow.id,
                        latLng: parsePointToLatLng(driverRow.location)
                    }))
                    .filter((driverRow) => driverRow.latLng)
                    .filter((driverRow) => calculateDistanceMiles(
                        pickupPos[0],
                        pickupPos[1],
                        driverRow.latLng[0],
                        driverRow.latLng[1]
                    ) <= 4)
                    .map((driverRow) => driverRow.id);

                if (!nearbyDriverIds.length) {
                    if (!cancelled) setMarketEstimate(fallbackEstimate);
                    return;
                }

                let rateProfiles = [];
                try {
                    const { data: profileRows } = await supabase
                        .from('driver_rate_profiles')
                        .select('*')
                        .in('driver_id', nearbyDriverIds)
                        .eq('is_active', true);

                    rateProfiles = (profileRows || []).map(normalizeRateProfile);
                } catch {
                    rateProfiles = [];
                }

                if (!rateProfiles.length) {
                    rateProfiles = nearbyDriverIds.map(() => DEFAULT_DRIVER_RATE_PROFILE);
                }

                const nextEstimate = estimateRangeFromProfiles({
                    rateProfiles,
                    distanceMiles,
                    serviceType,
                    includeDog,
                    includeEstateCar
                });

                if (!cancelled) setMarketEstimate(nextEstimate);
            } catch {
                if (!cancelled) setMarketEstimate(fallbackEstimate);
            }
        };

        loadMarketEstimate();

        return () => {
            cancelled = true;
        };
    }, [baseFare, distanceMiles, includeDog, includeEstateCar, pickupPos, selectedDestinationPos, serviceType]);

    useEffect(() => {
        if (!activeRideId) return;

        const rideChannel = supabase.channel(`ride_live_meter_${activeRideId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'ride_requests', filter: `id=eq.${activeRideId}` },
                async (payload) => {
                    const updatedRide = payload.new;
                    setLiveFare(roundToPence(updatedRide.current_bid));
                    if (updatedRide.clinch_id) {
                        setActiveClinchId(updatedRide.clinch_id);
                    }

                    if (updatedRide.status === 'searching' && step === 'matching') {
                        setMatchingStatus(`Driver bid update: ${formatMoney(updatedRide.current_bid)}`);
                    }

                    if (updatedRide.status === 'accepted' && step === 'matching') {
                        const { data: driverData } = await supabase
                            .from('active_drivers')
                            .select('id, rating, vehicle_details, location, phone_number')
                            .eq('id', updatedRide.assigned_driver_id)
                            .single();

                        setDriver({
                            id: driverData?.id || updatedRide.assigned_driver_id,
                            name: 'Taxi Driver',
                            rating: driverData?.rating || '5.0',
                            car: driverData?.vehicle_details || 'Taxi',
                            phone: driverData?.phone_number || ''
                        });

                        const parsed = parsePointToLatLng(driverData?.location);
                        if (parsed) setDriverPos(parsed);

                        setMatchingStatus('Driver found. Confirm your clinch.');
                        await logClinchAuditEvent(
                            updatedRide.clinch_id || activeClinchId,
                            `DRIVER_ACCEPTED ${formatMoney(updatedRide.current_bid)}`
                        );
                        setStep('handshake');
                    }

                    if (updatedRide.status === 'in_progress') {
                        setStep('riding');
                    }

                    if (updatedRide.status === 'completed') {
                        await logClinchAuditEvent(
                            updatedRide.clinch_id || activeClinchId,
                            `RIDE_COMPLETED ${formatMoney(updatedRide.current_bid)}`
                        );
                        setStep('completed');
                    }

                    if (updatedRide.status === 'cancelled') {
                        setStep('input');
                        setActiveRideId(null);
                        setDriver(null);
                        setMatchingStatus('Ride was cancelled.');
                        await logClinchAuditEvent(
                            updatedRide.clinch_id || activeClinchId,
                            'RIDE_CANCELLED'
                        );
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(rideChannel);
        };
    }, [activeRideId, step, activeClinchId, logClinchAuditEvent]);

    useEffect(() => {
        if (!driver?.id) return;

        const driverChannel = supabase.channel(`driver_live_location_${driver.id}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'active_drivers', filter: `id=eq.${driver.id}` },
                (payload) => {
                    const parsed = parsePointToLatLng(payload.new.location);
                    if (parsed) setDriverPos(parsed);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(driverChannel);
        };
    }, [driver?.id]);

    const handleSelectDestination = (place) => {
        const shortName = place.display_name.split(',')[0];
        const destinationLat = parseFloat(place.lat);
        const destinationLng = parseFloat(place.lon);

        setDestination(shortName);
        setSuggestions([]);
        setSelectedDestinationPos([destinationLat, destinationLng]);

        const miles = calculateDistanceMiles(
            pickupPos[0],
            pickupPos[1],
            destinationLat,
            destinationLng
        );

        setDistanceMiles(roundToPence(miles));
    };

    const createInitialRideClinch = async (startFare) => {
        const initialTerms = `Ride request to ${destination}. Starting estimate ${formatMoney(startFare)}. Final total follows shared live meter and is settled as a clinch.`;

        const { data, error } = await supabase
            .from('clinches')
            .insert([{
                sender_id: user?.id,
                sender_name: user?.user_metadata?.full_name,
                sender_phone: user?.phone || null,
                recipient_phone: 'Driver Phone',
                terms: initialTerms,
                status: 'pending'
            }])
            .select('id')
            .single();

        if (error || !data?.id) return null;

        await logClinchAuditEvent(data.id, `REQUEST_CREATED ${formatMoney(startFare)} • ${destination}`);
        return data.id;
    };

    const createRideRequestWithFallback = async (payload, fallbackPayload) => {
        const primaryResult = await supabase
            .from('ride_requests')
            .insert([payload])
            .select()
            .single();

        if (!primaryResult.error) return primaryResult;

        const fallbackResult = await supabase
            .from('ride_requests')
            .insert([fallbackPayload])
            .select()
            .single();

        return fallbackResult;
    };

    const handleRequestRide = async () => {
        if (!destination.trim() || !user?.id || !selectedDestinationPos) return;
        const requestedStartFare = roundToPence(
            selectedDestinationPos ? marketEstimate.aboutFare : baseFare
        );
        const estimatedMin = roundToPence(marketEstimate.minFare || requestedStartFare);
        const estimatedMax = roundToPence(marketEstimate.maxFare || requestedStartFare);
        const clinchId = await createInitialRideClinch(requestedStartFare);

        setLiveFare(requestedStartFare);
        setStep('matching');
        setMatchingStatus('Looking for nearby taxi...');

        const fullPayload = {
            rider_id: user.id,
            rider_name: user?.user_metadata?.full_name || 'Rider',
            pickup_location: `POINT(${pickupPos[1]} ${pickupPos[0]})`,
            dropoff_location: `POINT(${selectedDestinationPos[1]} ${selectedDestinationPos[0]})`,
            destination_text: destination,
            vehicle_type: includeEstateCar ? 'Estate Car' : 'Standard Taxi',
            current_bid: requestedStartFare,
            status: 'searching',
            estimated_min: estimatedMin,
            estimated_max: estimatedMax,
            about_price: requestedStartFare,
            estimated_distance_miles: distanceMiles,
            bid_window_ends_at: new Date(Date.now() + (30 * 1000)).toISOString(),
            payment_status: 'unpaid',
            clinch_id: clinchId
        };

        const fallbackPayload = {
            rider_id: fullPayload.rider_id,
            rider_name: fullPayload.rider_name,
            pickup_location: fullPayload.pickup_location,
            dropoff_location: fullPayload.dropoff_location,
            destination_text: fullPayload.destination_text,
            vehicle_type: fullPayload.vehicle_type,
            current_bid: fullPayload.current_bid,
            status: fullPayload.status,
            clinch_id: clinchId
        };

        const { data, error } = await createRideRequestWithFallback(fullPayload, fallbackPayload);

        if (error || !data) {
            console.error('Ride request failed:', error);
            if (clinchId) {
                await supabase.from('clinches').update({ status: 'rejected' }).eq('id', clinchId);
                await logClinchAuditEvent(clinchId, 'REQUEST_FAILED');
            }
            setStep('input');
            return;
        }

        setActiveRideId(data.id);
        setActiveClinchId(data.clinch_id || clinchId);
    };

    const handleCancelRequest = async () => {
        if (!activeRideId) {
            setStep('input');
            return;
        }

        await supabase
            .from('ride_requests')
            .update({ status: 'cancelled' })
            .eq('id', activeRideId);

        setStep('input');
        setActiveRideId(null);
        setDriver(null);

        if (activeClinchId) {
            await supabase.from('clinches').update({ status: 'rejected' }).eq('id', activeClinchId);
            await logClinchAuditEvent(activeClinchId, 'REQUEST_CANCELLED_BY_RIDER');
            setActiveClinchId(null);
        }
    };

    const confirmClinch = async () => {
        if (!activeRideId) return;

        let clinchId = activeClinchId;
        const clinchTerms = `Taxi ride clinch to ${destination}. Starting fare ${formatMoney(displayFare)}. Final total is the same live meter shown on both phones. Cash preferred. Stripe card payment optional.`;

        try {
            if (clinchId) {
                await supabase
                    .from('clinches')
                    .update({
                        terms: clinchTerms,
                        status: 'clinched',
                        agreed_at: new Date().toISOString(),
                        agreed_by: user?.phone || 'rider',
                        agreed_name: user?.user_metadata?.full_name || 'Rider'
                    })
                    .eq('id', clinchId);
            } else {
                const { data: createdClinch } = await supabase
                    .from('clinches')
                    .insert([{
                        sender_id: user?.id,
                        sender_name: user?.user_metadata?.full_name,
                        sender_phone: user?.phone || null,
                        recipient_phone: 'Driver Phone',
                        terms: clinchTerms,
                        status: 'clinched'
                    }])
                    .select('id')
                    .single();

                clinchId = createdClinch?.id || null;
            }
        } catch (error) {
            console.error('Failed to record ride clinch:', error);
        }

        if (clinchId) {
            setActiveClinchId(clinchId);
            await supabase
                .from('ride_requests')
                .update({ clinch_id: clinchId })
                .eq('id', activeRideId);
            await logClinchAuditEvent(clinchId, `RIDER_CLINCHED ${formatMoney(displayFare)}`);
        }

        setStep('riding');
    };

    const resetFlow = () => {
        setStep('input');
        setDestination('');
        setSuggestions([]);
        setSelectedDestinationPos(null);
        setDistanceMiles(0);
        setServiceType(SERVICE_TYPES.METERED);
        setIncludeDog(false);
        setIncludeEstateCar(false);
        setShowAdvancedFareOptions(false);
        setActiveRideId(null);
        setActiveClinchId(null);
        setDriver(null);
        driverHereAlertedRideRef.current = null;
        setLiveFare(0);
    };

    const callDriver = () => {
        const rawPhone = String(driver?.phone || '').trim();
        if (!rawPhone || typeof window === 'undefined') return;
        const dialPhone = rawPhone.replace(/\s+/g, '');
        window.location.href = `tel:${dialPhone}`;
    };

    const handleCashSettle = async () => {
        const paidAt = new Date().toISOString();

        if (activeRideId) {
            try {
                await supabase
                    .from('ride_requests')
                    .update({
                        payment_method: 'cash',
                        payment_status: 'rider_marked_paid',
                        rider_paid_at: paidAt
                    })
                    .eq('id', activeRideId);
            } catch {
                // Continue with rider flow even if payment status columns are not migrated yet.
            }
        }

        if (activeClinchId) await logClinchAuditEvent(activeClinchId, `RIDER_MARKED_CASH_PAID ${formatMoney(liveFare)}`);
        resetFlow();
        await loadMonthlySummary();
    };

    const handleStripePay = async () => {
        if (!activeRideId) {
            resetFlow();
            return;
        }

        try {
            const { data, error } = await supabase.functions.invoke('stripe-direct-charge', {
                body: { rideId: activeRideId, currentBid: liveFare }
            });

            if (error || !data?.clientSecret) {
                console.error('Stripe charge initialization failed:', error || data?.error);
                return;
            }

            await Stripe.createPaymentSheet({
                paymentIntentClientSecret: data.clientSecret,
                merchantDisplayName: 'Clinch Ride',
                enableApplePay: true,
                enableGooglePay: true,
                applePayMerchantId: 'merchant.com.clinch.app'
            });

            const { paymentResult } = await Stripe.presentPaymentSheet();
            if (paymentResult === 'PaymentCompleted') {
                const paidAt = new Date().toISOString();

                if (activeRideId) {
                    try {
                        await supabase
                            .from('ride_requests')
                            .update({
                                payment_method: 'stripe',
                                payment_status: 'stripe_paid',
                                rider_paid_at: paidAt,
                                driver_paid_at: paidAt
                            })
                            .eq('id', activeRideId);
                    } catch {
                        // Continue with rider flow even if payment status columns are not migrated yet.
                    }
                }

                if (activeClinchId) {
                    await supabase
                        .from('clinches')
                        .update({ resolved_at: paidAt })
                        .eq('id', activeClinchId);
                    await logClinchAuditEvent(activeClinchId, `SETTLED_STRIPE ${formatMoney(liveFare)}`);
                }
                resetFlow();
                await loadMonthlySummary();
            }
        } catch (error) {
            console.error('Stripe native payment failed/cancelled:', error);
        }
    };

    const serviceCards = [
        {
            id: SERVICE_TYPES.METERED,
            title: 'Local Meter',
            subtitle: 'Tiered miles + live time meter'
        },
        {
            id: SERVICE_TYPES.AIRPORT_DROPOFF,
            title: 'Airport Drop',
            subtitle: `${formatMoney(HASTINGS_PRICING.airportDropoffFare)} fixed start`
        },
        {
            id: SERVICE_TYPES.AIRPORT_PICKUP,
            title: 'Airport Pickup',
            subtitle: `${formatMoney(HASTINGS_PRICING.airportPickupFare)} fixed start`
        }
    ];

    const bookingStartFare = roundToPence(
        selectedDestinationPos ? marketEstimate.aboutFare : baseFare
    );
    const displayFare = step === 'input' ? bookingStartFare : (liveFare || bookingStartFare);

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%', borderRadius: '24px', overflow: 'hidden' }}>
            <MapBackground
                step={step}
                pickupPos={pickupPos}
                dropoffPos={selectedDestinationPos}
                driverPos={driverPos}
            />

            <div style={{ position: 'relative', zIndex: 10, height: '100%', display: 'flex', flexDirection: 'column', padding: '16px' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: 'rgba(0,0,0,0.95)',
                        backdropFilter: 'blur(10px)',
                        borderRadius: '30px',
                        padding: '10px 18px',
                        boxShadow: '0 4px 14px rgba(0,0,0,0.08)'
                    }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#D4CFC9' }} />
                        <span style={{ fontSize: '12px', fontWeight: '900', letterSpacing: '1px', color: '#D4CFC9' }}>ELS ELITE</span>
                    </div>
                </div>

                {driverArrivalMeta && (
                    <div style={{
                        marginTop: '10px',
                        alignSelf: 'center',
                        background: driverArrivalMeta.background,
                        border: driverArrivalMeta.border,
                        borderRadius: '14px',
                        padding: '10px 14px',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '15px', fontWeight: '900', color: driverArrivalMeta.color }}>{driverArrivalMeta.label}</div>
                        <div style={{ fontSize: '12px', fontWeight: '800', color: driverArrivalMeta.color }}>{driverArrivalMeta.subtitle}</div>
                    </div>
                )}

                <div style={{ marginTop: 'auto', zIndex: 20 }}>
                    <AnimatePresence mode="wait">
                        {step === 'input' && (
                            <MotionDiv
                                key="input"
                                initial={{ y: 50, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -50, opacity: 0 }}
                                style={{ background: '#FFFFFF', borderRadius: '24px', padding: '22px', boxShadow: '0 12px 40px rgba(0,0,0,0.1)' }}
                            >
                                <h2 style={{ fontSize: '24px', fontWeight: '900', marginBottom: '6px', color: '#FFFFFF' }}>Book Taxi</h2>
                                <p style={{ fontSize: '14px', color: '#757575', marginBottom: '14px' }}>One tap booking. Live meter shown on both phones.</p>

                                <div style={{ background: '#F7FAFA', border: '1px solid #DCEBEB', borderRadius: '14px', padding: '12px', marginBottom: '14px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                        <span style={{ fontSize: '12px', fontWeight: '800', color: '#757575', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{monthLabel}</span>
                                        <span style={{ fontSize: '26px', fontWeight: '900', color: '#D4CFC9' }}>{formatMoney(monthlySummary.totalSpent)}</span>
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#5B6470', fontWeight: '700' }}>
                                        You spent this month • {monthlySummary.ridesCount} completed ride{monthlySummary.ridesCount === 1 ? '' : 's'}
                                    </div>
                                </div>

                                <div style={{ background: '#F5F5F5', borderRadius: '16px', padding: '14px', marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#D4CFC9' }} />
                                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}>Current Location</span>
                                    </div>
                                    <div style={{ height: 1, background: '#E2E2E2', marginLeft: 22, marginBottom: '12px' }} />

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: 10, height: 10, background: '#FFFFFF' }} />
                                        <input
                                            value={destination}
                                            onChange={(event) => {
                                                const nextDestination = event.target.value;
                                                setDestination(nextDestination);
                                                if (selectedDestinationPos) setSelectedDestinationPos(null);
                                                if (!nextDestination.trim()) setSuggestions([]);
                                            }}
                                            placeholder="Where to?"
                                            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '17px', fontWeight: '700', color: '#FFFFFF' }}
                                        />
                                    </div>

                                    {isSearchingDest && (
                                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#757575', fontWeight: '600' }}>Searching...</div>
                                    )}

                                    {suggestions.length > 0 && (
                                        <div style={{ marginTop: '8px', borderRadius: '12px', overflow: 'hidden', background: '#FFFFFF', boxShadow: '0 6px 14px rgba(0,0,0,0.08)' }}>
                                            {suggestions.map((place, index) => (
                                                <div
                                                    key={`${place.place_id}-${index}`}
                                                    onClick={() => handleSelectDestination(place)}
                                                    style={{
                                                        padding: '12px 14px',
                                                        borderBottom: index === suggestions.length - 1 ? 'none' : '1px solid #F0F0F0',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#FFFFFF' }}>{place.display_name.split(',')[0]}</div>
                                                    <div style={{ fontSize: '11px', color: '#757575', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.display_name}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div style={{ background: '#FAFAFA', border: '1px solid #EEEEEE', borderRadius: '14px', padding: '12px', marginBottom: '12px' }}>
                                    <div style={{ fontSize: '13px', fontWeight: '900', color: '#FFFFFF', marginBottom: '8px' }}>What You Get</div>
                                    <div style={{ fontSize: '13px', color: '#374151', fontWeight: '700', marginBottom: '4px' }}>- You see the same live meter as driver</div>
                                    <div style={{ fontSize: '13px', color: '#374151', fontWeight: '700', marginBottom: '4px' }}>- Cash payment is first option</div>
                                    <div style={{ fontSize: '13px', color: '#374151', fontWeight: '700' }}>- Card payment is optional backup</div>
                                </div>

                                <button
                                    onClick={() => setShowAdvancedFareOptions((current) => !current)}
                                    style={{
                                        width: '100%',
                                        border: '1px solid #E5E7EB',
                                        borderRadius: '12px',
                                        padding: '10px',
                                        background: '#000000',
                                        color: '#374151',
                                        fontWeight: '800',
                                        cursor: 'pointer',
                                        marginBottom: '10px'
                                    }}
                                >
                                    {showAdvancedFareOptions ? 'Hide More Options' : 'More Options'}
                                </button>

                                {showAdvancedFareOptions && (
                                    <>
                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{ fontSize: '12px', fontWeight: '800', color: '#757575', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Fare Mode</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                                {serviceCards.map((card) => (
                                                    <button
                                                        key={card.id}
                                                        onClick={() => setServiceType(card.id)}
                                                        style={{
                                                            textAlign: 'left',
                                                            border: serviceType === card.id ? '2px solid #D4CFC9' : '1px solid #E4E4E4',
                                                            background: serviceType === card.id ? 'rgba(0,128,128,0.06)' : '#000000',
                                                            borderRadius: '14px',
                                                            padding: '12px 14px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        <div style={{ fontSize: '15px', fontWeight: '800', color: '#FFFFFF' }}>{card.title}</div>
                                                        <div style={{ fontSize: '12px', color: '#757575', marginTop: '2px' }}>{card.subtitle}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                            <button
                                                onClick={() => setIncludeDog((value) => !value)}
                                                style={{
                                                    border: includeDog ? '2px solid #D4CFC9' : '1px solid #E4E4E4',
                                                    background: includeDog ? 'rgba(0,128,128,0.06)' : '#000000',
                                                    borderRadius: '12px',
                                                    padding: '12px',
                                                    fontWeight: '800',
                                                    color: '#FFFFFF',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Dog +£2
                                            </button>

                                            <button
                                                onClick={() => setIncludeEstateCar((value) => !value)}
                                                style={{
                                                    border: includeEstateCar ? '2px solid #D4CFC9' : '1px solid #E4E4E4',
                                                    background: includeEstateCar ? 'rgba(0,128,128,0.06)' : '#000000',
                                                    borderRadius: '12px',
                                                    padding: '12px',
                                                    fontWeight: '800',
                                                    color: '#FFFFFF',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Estate +£3
                                            </button>
                                        </div>
                                    </>
                                )}

                                <div style={{ background: '#F7FAFA', border: '1px solid #DCEBEB', borderRadius: '16px', padding: '14px', marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#757575' }}>About Price</span>
                                        <span style={{ fontSize: '30px', fontWeight: '900', color: '#D4CFC9' }}>{formatMoney(bookingStartFare)}</span>
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#757575', fontWeight: '600' }}>
                                        {selectedDestinationPos
                                            ? `Range ${formatMoney(marketEstimate.minFare)} - ${formatMoney(marketEstimate.maxFare)} from ${marketEstimate.sourceCount || 1} active driver rate${(marketEstimate.sourceCount || 1) > 1 ? 's' : ''}.`
                                            : 'Set destination for estimate.'}
                                    </div>
                                </div>

                                <div style={{
                                    background: 'rgba(34, 197, 94, 0.1)',
                                    border: '1px solid rgba(34, 197, 94, 0.35)',
                                    borderRadius: '14px',
                                    padding: '12px',
                                    fontSize: '13px',
                                    color: '#166534',
                                    fontWeight: '800',
                                    marginBottom: '14px'
                                }}>
                                    Cash clinch is default. Card is optional after the ride.
                                </div>

                                <button
                                    onClick={handleRequestRide}
                                    disabled={!destination.trim() || !selectedDestinationPos}
                                    style={{
                                        width: '100%',
                                        border: 'none',
                                        borderRadius: '16px',
                                        padding: '17px',
                                        fontSize: '18px',
                                        fontWeight: '900',
                                        background: destination.trim() && selectedDestinationPos ? '#D4CFC9' : '#E0E0E0',
                                        color: destination.trim() && selectedDestinationPos ? '#000000' : '#9A9A9A',
                                        cursor: destination.trim() && selectedDestinationPos ? 'pointer' : 'default'
                                    }}
                                >
                                    Get Taxi (Cash) • {formatMoney(bookingStartFare)}
                                </button>
                            </MotionDiv>
                        )}

                        {step === 'matching' && (
                            <MotionDiv
                                key="matching"
                                initial={{ scale: 0.94, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.94, opacity: 0 }}
                                style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px 22px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}
                            >
                                <img src="/assets/searching.png" alt="Looking for taxi" style={{ width: '98px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }} />
                                <h3 style={{ fontSize: '22px', marginBottom: '8px', color: '#FFFFFF' }}>{matchingStatus}</h3>
                                <p style={{ fontSize: '14px', color: '#757575', marginBottom: '18px' }}>You see every price update before you confirm.</p>

                                <div style={{ fontSize: '42px', fontWeight: '900', color: '#D4CFC9' }}>{formatMoney(displayFare)}</div>
                                <div style={{ fontSize: '12px', fontWeight: '700', color: '#9A9A9A', marginTop: '6px', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '1px' }}>Starting Meter</div>

                                <button
                                    onClick={handleCancelRequest}
                                    style={{ border: 'none', borderRadius: '12px', padding: '13px 18px', background: '#F5F5F5', color: '#666666', fontWeight: '800', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                            </MotionDiv>
                        )}

                        {step === 'handshake' && (
                            <MotionDiv
                                key="handshake"
                                initial={{ y: 40, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -40, opacity: 0 }}
                                style={{ background: '#FFFFFF', borderRadius: '24px', padding: '22px', boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}
                            >
                                <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                                    <img src="/assets/geometric-handshake.png" alt="Clinch" style={{ width: '92px', marginBottom: '8px' }} />
                                    <h3 style={{ fontSize: '24px', marginBottom: '4px', color: '#FFFFFF' }}>Clinch the Ride</h3>
                                    <p style={{ fontSize: '13px', color: '#757575', margin: 0 }}>Both sides see the same live meter.</p>
                                </div>

                                <div style={{ background: '#FAFAFA', border: '1px solid #EEEEEE', borderRadius: '14px', padding: '14px', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                        <span style={{ color: '#757575', fontWeight: '700' }}>Driver</span>
                                        <span style={{ fontWeight: '800', color: '#FFFFFF' }}>{driver?.name || 'Taxi Driver'} • ⭐ {driver?.rating || '5.0'}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                        <span style={{ color: '#757575', fontWeight: '700' }}>Car</span>
                                        <span style={{ fontWeight: '800', color: '#FFFFFF' }}>{driver?.car || 'Taxi'}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                                        <span style={{ color: '#757575', fontWeight: '700' }}>Starting Fare</span>
                                        <span style={{ fontWeight: '900', color: '#D4CFC9', fontSize: '20px' }}>{formatMoney(displayFare)}</span>
                                    </div>
                                </div>

                                <div style={{
                                    background: 'rgba(34, 197, 94, 0.1)',
                                    border: '1px solid rgba(34, 197, 94, 0.35)',
                                    borderRadius: '12px',
                                    padding: '10px 12px',
                                    fontSize: '13px',
                                    color: '#166534',
                                    fontWeight: '800',
                                    marginBottom: '12px'
                                }}>
                                    Cash clinch first. Card is backup only.
                                </div>

                                {driverArrivalMeta && (
                                    <div style={{
                                        background: driverArrivalMeta.background,
                                        border: driverArrivalMeta.border,
                                        borderRadius: '12px',
                                        padding: '10px 12px',
                                        fontSize: '14px',
                                        color: driverArrivalMeta.color,
                                        fontWeight: '900',
                                        marginBottom: '10px',
                                        textAlign: 'center'
                                    }}>
                                        {driverArrivalMeta.label}
                                    </div>
                                )}

                                {driver?.phone && (
                                    <button
                                        onClick={callDriver}
                                        style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '12px', padding: '13px', background: '#FFFFFF', color: '#000', fontSize: '14px', fontWeight: '800', cursor: 'pointer', marginBottom: '10px' }}
                                    >
                                        Call Driver
                                    </button>
                                )}

                                <button
                                    onClick={confirmClinch}
                                    style={{ width: '100%', border: 'none', borderRadius: '15px', padding: '17px', background: '#D4CFC9', color: '#000000', fontSize: '18px', fontWeight: '900', cursor: 'pointer' }}
                                >
                                    Clinch Ride
                                </button>
                            </MotionDiv>
                        )}

                        {step === 'riding' && (
                            <MotionDiv
                                key="riding"
                                initial={{ y: 40, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -40, opacity: 0 }}
                                style={{ background: '#FFFFFF', borderRadius: '24px', padding: '22px', boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}
                            >
                                <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                                    <div style={{ fontSize: '13px', fontWeight: '800', color: '#757575', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '5px' }}>Live Meter</div>
                                    <div style={{ fontSize: '52px', fontWeight: '900', color: '#D4CFC9', lineHeight: 1 }}>{formatMoney(liveFare)}</div>
                                </div>

                                <div style={{ background: '#FAFAFA', border: '1px solid #EEEEEE', borderRadius: '14px', padding: '10px 12px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <img src="/assets/topdowncar.png" alt="Taxi icon" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                                    <div>
                                        <div style={{ fontSize: '11px', color: '#757575', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{driverArrivalMeta?.label || 'Coming your way'}</div>
                                        <div style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: '800' }}>{driver?.car || 'Taxi details'}</div>
                                    </div>
                                </div>

                                {driver?.phone && (
                                    <button
                                        onClick={callDriver}
                                        style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '12px', padding: '12px', background: '#FFFFFF', color: '#000', fontSize: '14px', fontWeight: '800', cursor: 'pointer', marginBottom: '10px' }}
                                    >
                                        Call Driver
                                    </button>
                                )}

                                <div style={{
                                    background: '#F7FAFA',
                                    border: '1px solid #DCEBEB',
                                    borderRadius: '14px',
                                    padding: '12px',
                                    marginBottom: '12px',
                                    fontSize: '13px',
                                    color: '#FFFFFF',
                                    fontWeight: '700',
                                    textAlign: 'center'
                                }}>
                                    Driver controls the meter. You see the same number in real-time.
                                </div>

                                <div style={{
                                    background: 'rgba(34, 197, 94, 0.1)',
                                    border: '1px solid rgba(34, 197, 94, 0.35)',
                                    borderRadius: '12px',
                                    padding: '12px',
                                    fontSize: '15px',
                                    color: '#166534',
                                    fontWeight: '900',
                                    textAlign: 'center'
                                }}>
                                    Cash Clinch Active
                                </div>
                            </MotionDiv>
                        )}

                        {step === 'completed' && (
                            <MotionDiv
                                key="completed"
                                initial={{ scale: 0.94, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.94, opacity: 0 }}
                                style={{ background: '#FFFFFF', borderRadius: '24px', padding: '24px 22px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}
                            >
                                <h2 style={{ fontSize: '28px', color: '#FFFFFF', marginBottom: '6px' }}>Ride Complete</h2>
                                <p style={{ fontSize: '14px', color: '#757575', marginBottom: '14px' }}>Settle this clinch now.</p>

                                <div style={{ background: '#FAFAFA', border: '1px solid #EEEEEE', borderRadius: '16px', padding: '18px', marginBottom: '14px' }}>
                                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#757575', marginBottom: '4px' }}>Final Meter</div>
                                    <div style={{ fontSize: '46px', fontWeight: '900', color: '#FFFFFF' }}>{formatMoney(liveFare)}</div>
                                </div>

                                <button
                                    onClick={handleCashSettle}
                                    style={{
                                        width: '100%',
                                        border: 'none',
                                        borderRadius: '16px',
                                        padding: '18px',
                                        background: '#D4CFC9',
                                        color: '#000000',
                                        fontSize: '18px',
                                        fontWeight: '900',
                                        cursor: 'pointer',
                                        marginBottom: '10px'
                                    }}
                                >
                                    Pay Driver in Cash
                                </button>
                                <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: '700', marginBottom: '10px' }}>
                                    Driver confirms cash received on their phone.
                                </div>

                                <button
                                    onClick={handleStripePay}
                                    style={{
                                        width: '100%',
                                        border: 'none',
                                        borderRadius: '16px',
                                        padding: '16px',
                                        background: '#FFFFFF',
                                        color: '#000000',
                                        fontSize: '15px',
                                        fontWeight: '800',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Pay by Card (Stripe)
                                </button>
                            </MotionDiv>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <style>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); opacity: 0.8; }
                    50% { transform: scale(1.05); opacity: 1; }
                    100% { transform: scale(0.95); opacity: 0.8; }
                }
            `}</style>
        </div>
    );
}

export default function RideApp() {
    const [mode, setMode] = useState('customer');

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px' }}>
            <div style={{
                background: '#FFFFFF', borderRadius: '16px',
                padding: '8px',
                boxShadow: '0 6px 16px rgba(0,0,0,0.06)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px'
            }}>
                <button
                    onClick={() => setMode('customer')}
                    style={{
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px',
                        fontSize: '16px',
                        fontWeight: '900',
                        cursor: 'pointer',
                        background: mode === 'customer' ? '#D4CFC9' : '#F3F4F6',
                        color: mode === 'customer' ? '#000000' : '#4B5563'
                    }}
                >
                    Customer
                </button>

                <button
                    onClick={() => setMode('taxi')}
                    style={{
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px',
                        fontSize: '16px',
                        fontWeight: '900',
                        cursor: 'pointer',
                        background: mode === 'taxi' ? '#D4CFC9' : '#F3F4F6',
                        color: mode === 'taxi' ? '#000000' : '#4B5563'
                    }}
                >
                    Taxi
                </button>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
                {mode === 'customer' ? <RiderApp /> : <DriverApp />}
            </div>
        </div>
    );
}
