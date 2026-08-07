-- ==============================================================================
-- CLINCH RIDE - BACKEND ARCHITECTURE
-- The Zero-Commission Hyperlocal Ride-Hailing Extension
-- ==============================================================================

-- 1. Enable PostGIS Extension (The Scalable Spatial Engine)
-- This is critical. It turns PostgreSQL into a geospatial database capable of
-- calculating real-time distances between thousands of points instantly.
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==============================================================================
-- 2. ACTIVE DRIVERS TABLE (Live Location Streaming)
-- ==============================================================================
-- This table is designed for high-frequency updates. As drivers drive, their phone
-- pings this table every 5 seconds with their new coordinates.

DROP TABLE IF EXISTS public.active_drivers CASCADE;

CREATE TABLE public.active_drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Links to the driver's auth account
    phone_number TEXT NOT NULL, -- Used to link to the Clinch agreement later
    vehicle_type TEXT NOT NULL, -- e.g., 'Clinch Standard', 'Clinch Electric'
    vehicle_details TEXT NOT NULL, -- e.g., 'Toyota Prius - Black - XY71 ABC'
    rating DECIMAL(3, 2) DEFAULT 5.00,
    status TEXT NOT NULL DEFAULT 'offline', -- 'online', 'busy' (on a ride), 'offline'
    
    -- Finance: Stripe Connect Integration (Direct Charges)
    stripe_account_id TEXT,
    
    -- PostGIS Geography Point: Stores Longitude/Latitude securely
    -- 4326 is the spatial reference system for GPS coordinates (WGS84)
    location geography(POINT, 4326), 
    
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ⚡ SCALABILITY CRITICAL: The GIST Index
-- This guarantees that when a rider in Manchester requests a car, the DB doesn't 
-- scan every driver globally. It geometrically isolating nearby drivers in milliseconds.
CREATE INDEX active_drivers_gix ON public.active_drivers USING GIST (location);

-- ==============================================================================
-- 3. RIDE REQUESTS TABLE (The Real-Time Order Book)
-- ==============================================================================
-- The core bidding engine. Riders post a request here, and drivers subscribe 
-- to this table via WebSockets to see new jobs pop up around them.

DROP TABLE IF EXISTS public.ride_requests CASCADE;

CREATE TABLE public.ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL,
    rider_name TEXT NOT NULL,
    
    pickup_location geography(POINT, 4326) NOT NULL,
    dropoff_location geography(POINT, 4326) NOT NULL,
    destination_text TEXT NOT NULL,
    
    vehicle_type TEXT NOT NULL,
    current_bid DECIMAL(10, 2) NOT NULL, -- Starts at base, algorithm increases this
    
    -- Status pipeline: 'searching' -> 'accepted' -> 'in_progress' -> 'completed' -> 'cancelled'
    status TEXT NOT NULL DEFAULT 'searching', 
    
    assigned_driver_id UUID REFERENCES public.active_drivers(id),
    
    -- THE TROJAN HORSE: Linking the ride physically to the Clinch Trust Database
    clinch_id UUID REFERENCES public.clinches(id), 
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for quickly grabbing all rides that are currently looking for a driver
CREATE INDEX ride_requests_status_idx ON public.ride_requests(status) WHERE status = 'searching';

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.active_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

-- 🛡 DRIVERS: Anyone can see online drivers (Rider maps need this)
CREATE POLICY "Anyone can see online drivers" 
ON public.active_drivers FOR SELECT TO public
USING (status = 'online');

-- 🛡 DRIVERS: Only the authenticated driver can update their own GPS location
CREATE POLICY "Drivers update own location" 
ON public.active_drivers FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 🛡 RIDES: Riders have full control over their own ride requests
CREATE POLICY "Riders manage own requests" 
ON public.ride_requests FOR ALL TO authenticated
USING (auth.uid() = rider_id)
WITH CHECK (auth.uid() = rider_id);

-- 🛡 RIDES: Drivers can see ANY 'searching' request (to bid/accept)
CREATE POLICY "Drivers view searching requests" 
ON public.ride_requests FOR SELECT TO authenticated
USING (status = 'searching');

-- 🛡 RIDES: Assigned drivers can update the rides they accepted (e.g. mark 'completed')
CREATE POLICY "Assigned drivers update their rides" 
ON public.ride_requests FOR UPDATE TO authenticated
USING (
    assigned_driver_id IN (
        SELECT id FROM public.active_drivers WHERE user_id = auth.uid()
    )
);

-- ==============================================================================
-- 5. MATCHING ALGORITHM FUNCTION (Server-Side RPC)
-- ==============================================================================
-- Instead of doing heavy computation on the frontend, the app calls this single 
-- function: "Give me the closest 20 drivers to this latitude/longitude".
-- It uses PostGIS ST_DWithin to mathematically draw a circle around the rider.

CREATE OR REPLACE FUNCTION get_nearby_drivers(
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    search_radius_meters DOUBLE PRECISION DEFAULT 5000, -- 5km radius default
    v_type TEXT DEFAULT NULL -- Optional filter for 'Clinch Electric' etc.
)
RETURNS TABLE (
    driver_id UUID,
    vehicle_type TEXT,
    vehicle_details TEXT,
    rating DECIMAL,
    distance_meters DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.vehicle_type,
        d.vehicle_details,
        d.rating,
        -- Calculate exact distance in meters over the curvature of the earth
        ST_Distance(
            d.location, 
            ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography
        ) AS distance_meters,
        ST_Y(d.location::geometry) AS lat,
        ST_X(d.location::geometry) AS lng
    FROM 
        public.active_drivers d
    WHERE 
        d.status = 'online'
        AND (v_type IS NULL OR d.vehicle_type = v_type)
        -- The geometric boundary check (runs instantly due to GIST index)
        AND ST_DWithin(
            d.location, 
            ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography, 
            search_radius_meters
        )
    ORDER BY 
        -- Nearest drivers returned at the top of the array
        d.location <-> ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography
    LIMIT 20;
END;
$$;

-- ==============================================================================
-- 6. RIDE REJECTIONS (Marketplace Logic)
-- ==============================================================================
-- Tracks which drivers have declined a specific job. This prevents the same
-- job from spamming a driver who said no, and allows the system to calculate
-- when to increase the bid price (surge) based on rejections.

DROP TABLE IF EXISTS public.ride_rejections CASCADE;

CREATE TABLE public.ride_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.ride_requests(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.active_drivers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.ride_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can insert their rejections" 
ON public.ride_rejections FOR INSERT TO authenticated
WITH CHECK (
    driver_id IN (
        SELECT id FROM public.active_drivers WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Riders can see rejections for their rides" 
ON public.ride_rejections FOR SELECT TO authenticated
USING (
    ride_id IN (
        SELECT id FROM public.ride_requests WHERE rider_id = auth.uid()
    )
);

-- ==============================================================================
-- 7. REALTIME WEBSOCKET ENABLEMENT
-- ==============================================================================
-- By enabling supabase_realtime, changes to these tables (like a driver moving,
-- or a new ride being requested) are instantly pushed to the clients securely.

-- Uncomment and run this in your Supabase SQL editor to enable streaming:
-- BEGIN;
--   DROP PUBLICATION IF EXISTS supabase_realtime;
--   CREATE PUBLICATION supabase_realtime;
-- COMMIT;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.active_drivers;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_rejections;
