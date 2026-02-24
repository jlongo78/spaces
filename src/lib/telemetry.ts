import posthog from 'posthog-js';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let initialized = false;
let optedOut = false;

const isDev = process.env.NODE_ENV === 'development'
  && !process.env.NEXT_PUBLIC_SPACES_TELEMETRY_DEV;

function shouldTrack(): boolean {
  return initialized && !optedOut && !isDev;
}

export function initTelemetry(installId: string, telemetryOptOut: boolean) {
  if (isDev || initialized || !POSTHOG_KEY) return;
  optedOut = telemetryOptOut;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'memory',
    disable_session_recording: true,
    bootstrap: { distinctID: installId },
    sanitize_properties(properties) {
      // Strip local dev URLs from properties
      if (properties['$current_url']) {
        properties['$current_url'] = properties['$current_url']
          .replace(/https?:\/\/127\.0\.0\.1:\d+/, '');
      }
      if (properties['$pathname']) {
        properties['$pathname'] = properties['$pathname']
          .replace(/https?:\/\/127\.0\.0\.1:\d+/, '');
      }
      return properties;
    },
  });

  posthog.identify(installId);

  if (telemetryOptOut) {
    posthog.opt_out_capturing();
  }

  initialized = true;
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!shouldTrack()) return;
  posthog.capture(event, properties);
}

export function trackPageView(page: string) {
  if (!shouldTrack()) return;
  posthog.capture('$pageview', { page });
}

export function setOptOut(out: boolean) {
  optedOut = out;
  if (!initialized) return;
  if (out) {
    posthog.opt_out_capturing();
  } else {
    posthog.opt_in_capturing();
  }
}

export function shutdownTelemetry() {
  if (!initialized) return;
  posthog.reset();
  initialized = false;
}
