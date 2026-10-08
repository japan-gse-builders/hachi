import { describe, expect, it } from 'vitest';
import {
  claimCall,
  classifyGatewayFailure,
  DEFAULT_GATEWAY_POLICY,
  gatewayVerdict,
  healthyGateway,
  parseGatewayPolicy,
  recordGatewayFailure,
  recordGatewaySuccess,
  type GatewayBreaker,
} from '../src/gateway.js';

const NOW = new Date('2026-10-08T09:21:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const POLICY = DEFAULT_GATEWAY_POLICY;

/** Verbatim from the production close that caused this; the whole classifier exists for it. */
const SPEND_CAP =
  'closed: 1008 Spend cap breached for project: projects/871712096742 for service: aiplatform.googleapis.com. Correlation id: 8710404284673';

describe('classifyGatewayFailure', () => {
  it('reads the faults that will meet every call the same way', () => {
    for (const reason of [
      SPEND_CAP,
      'closed: 1008 policy',
      'error: Billing account disabled',
      // Both separators, because the gRPC status and the prose message spell these differently and
      // either can be what reaches us.
      'error: 429 RESOURCE_EXHAUSTED',
      'error: Resource exhausted: please retry',
      'error: 403 PERMISSION_DENIED on aiplatform.googleapis.com',
      'error: Permission denied on resource project hachicall-nao',
      'error: UNAUTHENTICATED',
      'error: NOT_FOUND: model gemini-3.8-live',
      'error: Publisher Model `gemini-3.8-live` was not found or your project does not have access to it',
    ]) {
      expect(classifyGatewayFailure(reason)).toBe('systemic');
    }
  });

  it('treats an unrecognized or absent fault as transient', () => {
    // Being wrong this way costs a few rings. Being wrong the other way stops a care service over
    // something we had merely never seen before.
    for (const reason of ['closed: 1011 internal error', 'error: socket hang up', 'closed: 1006', '', undefined]) {
      expect(classifyGatewayFailure(reason)).toBe('transient');
    }
  });
});

describe('the gateway breaker', () => {
  it('stops new calls on the first systemic fault', () => {
    const b = recordGatewayFailure(healthyGateway(NOW.toISOString()), SPEND_CAP, NOW);
    expect(b).toMatchObject({ failures: 1, fault: 'systemic', since: NOW.toISOString() });
    expect(b.reason).toContain('Spend cap breached');
    expect(gatewayVerdict(b, NOW, POLICY)).toBe('down');
  });

  it('tolerates transient faults up to the threshold, because one dropped socket is ordinary', () => {
    let b: GatewayBreaker = healthyGateway(NOW.toISOString());
    for (let i = 1; i < POLICY.transientFailures; i++) {
      b = recordGatewayFailure(b, 'closed: 1006', at(i * 1000));
      expect(gatewayVerdict(b, at(i * 1000), POLICY)).toBe('working');
    }
    b = recordGatewayFailure(b, 'closed: 1006', at(9000));
    expect(b.failures).toBe(POLICY.transientFailures);
    expect(gatewayVerdict(b, at(9000), POLICY)).toBe('down');
  });

  it('keeps the start of the run while the failures continue', () => {
    const first = recordGatewayFailure(healthyGateway(NOW.toISOString()), 'closed: 1006', NOW);
    const second = recordGatewayFailure(first, 'closed: 1006', at(60_000));
    expect(second.since).toBe(NOW.toISOString());
    expect(second.lastFailedAt).toBe(at(60_000).toISOString());
  });

  it('is unknown-safe: no record at all means dial', () => {
    expect(gatewayVerdict(null, NOW, POLICY)).toBe('working');
    expect(gatewayVerdict(undefined, NOW, POLICY)).toBe('working');
    expect(claimCall(null, NOW, POLICY)).not.toBeNull();
  });

  it('lets exactly one call through after the cooldown, and refuses the rest', () => {
    const down = recordGatewayFailure(healthyGateway(NOW.toISOString()), SPEND_CAP, NOW);
    const later = at(POLICY.cooldownMs);
    expect(gatewayVerdict(down, later, POLICY)).toBe('probe');

    const probing = claimCall(down, later, POLICY)!;
    expect(probing.probedAt).toBe(later.toISOString());
    // The claim is what makes it one call rather than all of them: a second worker reading the same
    // expired cooldown now sees a probe already taken.
    expect(gatewayVerdict(probing, later, POLICY)).toBe('down');
    expect(claimCall(probing, later, POLICY)).toBeNull();
  });

  it('starts the wait again when the probe also failed', () => {
    const down = recordGatewayFailure(healthyGateway(NOW.toISOString()), SPEND_CAP, NOW);
    const first = at(POLICY.cooldownMs);
    const probing = claimCall(down, first, POLICY)!;
    const failedAgain = recordGatewayFailure(probing, SPEND_CAP, first);
    expect(failedAgain.failures).toBe(2);
    expect(gatewayVerdict(failedAgain, at(POLICY.cooldownMs + 1000), POLICY)).toBe('down');
    expect(gatewayVerdict(failedAgain, at(2 * POLICY.cooldownMs), POLICY)).toBe('probe');
  });

  it('reopens on one call that worked, rather than counting back down', () => {
    let b = recordGatewayFailure(healthyGateway(NOW.toISOString()), SPEND_CAP, NOW);
    b = claimCall(b, at(POLICY.cooldownMs), POLICY)!;
    const recovered = recordGatewaySuccess(b, at(POLICY.cooldownMs + 5000));
    expect(recovered).toMatchObject({ failures: 0 });
    expect(recovered.fault).toBeUndefined();
    expect(recovered.probedAt).toBeUndefined();
    expect(gatewayVerdict(recovered, at(POLICY.cooldownMs + 5000), POLICY)).toBe('working');
  });

  it('leaves a healthy breaker untouched, so an ordinary call is not a write', () => {
    const healthy = healthyGateway(NOW.toISOString());
    expect(recordGatewaySuccess(healthy, at(1000))).toBe(healthy);
    expect(claimCall(healthy, at(1000), POLICY)).toBe(healthy);
  });
});

describe('parseGatewayPolicy', () => {
  it('defaults, and reads seconds from the environment', () => {
    expect(parseGatewayPolicy({})).toEqual(POLICY);
    expect(parseGatewayPolicy({ GATEWAY_COOLDOWN_SEC: '300', GATEWAY_TRANSIENT_FAILURES: '2' })).toEqual({
      cooldownMs: 300_000,
      transientFailures: 2,
    });
    expect(parseGatewayPolicy({ GATEWAY_COOLDOWN_SEC: '' })).toEqual(POLICY);
  });

  it('refuses values that would turn the breaker off by accident', () => {
    expect(() => parseGatewayPolicy({ GATEWAY_COOLDOWN_SEC: '0' })).toThrow(/GATEWAY_COOLDOWN_SEC/);
    expect(() => parseGatewayPolicy({ GATEWAY_COOLDOWN_SEC: '1.5' })).toThrow(/GATEWAY_COOLDOWN_SEC/);
    expect(() => parseGatewayPolicy({ GATEWAY_TRANSIENT_FAILURES: '0' })).toThrow(/GATEWAY_TRANSIENT_FAILURES/);
    expect(() => parseGatewayPolicy({ GATEWAY_TRANSIENT_FAILURES: 'lots' })).toThrow(/GATEWAY_TRANSIENT_FAILURES/);
  });
});
