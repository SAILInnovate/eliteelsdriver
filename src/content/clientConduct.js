// ELS Elite — Client Conduct acknowledgment
// Shown to a driver when a booking is dispatched, BEFORE the booking details
// are revealed. The driver must accept it to view the job.
// Bump CONDUCT_VERSION whenever the wording changes.

export const CONDUCT_VERSION = '2026-07';

export const CONDUCT_TITLE = 'Client Conduct';

export const CONDUCT_INTRO =
    'Before you view this booking, please read and accept the following condition.';

// The legally-worded version supplied by ELS Elite.
export const CONDUCT_BODY = [
    'By accepting this booking, you expressly acknowledge and agree that neither you nor any employee, agent, subcontractor, or representative acting on your behalf shall initiate or engage in photography, request autographs, or enter into personal conversation with any client, guest, or affiliated party, except where strictly necessary for the performance of the services.',
    'Any breach of this provision shall constitute a material breach of contract and shall entitle us, without prejudice to any other rights or remedies, to terminate the engagement with immediate effect, remove you from site, exclude you from future bookings, and withhold payment where such breach results in our inability to invoice or recover payment from our client.',
];
