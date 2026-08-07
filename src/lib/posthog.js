import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_SHYClGPSfS3dPtI9hzffRrLmiQ9dmqQ7QcqtQP4AWnI'; // Placeholder - user should replace this
const POSTHOG_HOST = 'https://us.i.posthog.com';

export const initPostHog = () => {
    if (typeof window !== 'undefined') {
        posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            loaded: (ph) => {
                if (import.meta.env.DEV) ph.debug();
            },
            capture_pageview: true,
            persistence: 'localStorage',
            autocapture: true,
        });
    }
};

export const trackEvent = (eventName, properties = {}) => {
    posthog.capture(eventName, properties);
};

export const identifyUser = (userId, traits = {}) => {
    posthog.identify(userId, traits);
};

export const resetPostHog = () => {
    posthog.reset();
};

export default posthog;
