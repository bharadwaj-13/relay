import { randomUUID } from 'node:crypto';
import { AppError } from './domain.mjs';
export const scenarios = [
  { id: 'water', name: 'A request becomes action', description: 'A resident requests water, corrects the group size, and confirms the request.', steps: 5 },
  { id: 'duplicate', name: 'Two calls. One location.', description: 'A second caller reports the same need. Relay flags the overlap for review.', steps: 4 },
  { id: 'volunteer', name: 'An offer of help', description: 'A volunteer shares their vehicle, area and availability.', steps: 4 },
  { id: 'urgent', name: 'An urgent human handoff', description: 'A caller reports immediate danger. Relay flags human review without promising rescue.', steps: 4 }
];
export function demoStep(service, input) {
  const s = service.store;
  const scenario = scenarios.find(x => x.id === input.scenario);
  if (!scenario) throw new AppError('Unknown scenario.');
  const step = Number(input.step);
  if (!Number.isInteger(step) || step < 0 || step >= scenario.steps) throw new AppError('Invalid scenario step.');
  let call;
  if (step === 0 && !input.call_id) {
    call = { id: `DEMO-${randomUUID().slice(0, 8)}`, source: 'simulation', name: { water: 'Leela Rao', duplicate: 'Kiran Rao', volunteer: 'Samira Ahmed', urgent: 'Ravi Kumar' }[scenario.id], scenario: scenario.id, status: 'active', transcript: [], nextStep: 0, createdAt: new Date().toISOString() };
  } else {
    call = s.get('calls', input.call_id);
    if (!call || call.source !== 'simulation' || call.scenario !== scenario.id) throw new AppError('Demo call not found.', 404);
    if (call.nextStep !== step) throw new AppError('This step was already processed or is out of sequence.', 409);
  }
  // Each step is a real persisted action, never a fabricated Vaani connection.
  const lines = {
    water: [
      ['agent', "This is a relief exercise. I’m Relay, the AI coordination assistant. What do you need?"],
      ['user', 'We are twelve people at Palm Court, near the community garden. We need 36 litres of drinking water.'],
      ['user', 'Actually, four people have left. There are eight of us now. We still need 36 litres.'],
      ['agent', 'Eight people at Palm Court, requesting 36 litres of drinking water. Is that correct?'],
      ['user', 'Yes, that is correct. Please record it.']
    ],
    duplicate: [
      ['agent', 'This is a relief exercise. What would you like to report?'],
      ['user', 'Twelve people at Riverside School need drinking water. Someone may have already called.'],
      ['agent', 'I will record your confirmed report and flag any matching location for coordinator review. I won’t assume it is the same group. Shall I proceed?'],
      ['user', 'Yes. We need 48 litres, for twelve people. My name is Kiran.']
    ],
    volunteer: [
      ['agent', 'This is a relief exercise. Are you offering help today?'],
      ['user', 'Yes. My name is Samira Ahmed. I have a small van at Central Relief Hub and can carry water.'],
      ['agent', 'May I register your availability and your test contact number for the coordinator? This will not assign a delivery yet.'],
      ['user', 'Yes, register me. My test number is +10000000009.']
    ],
    urgent: [
      ['agent', 'This is a relief exercise. Tell me what is happening.'],
      ['user', 'Water is rising near the entrance at Southbank House. There are three of us and we need urgent transport.'],
      ['agent', 'I cannot dispatch emergency responders. If possible, contact the local official emergency service. May I record Southbank House and three people for urgent coordinator review?'],
      ['user', 'Yes. My name is Ravi Kumar. Please flag it.']
    ]
  };
  const [speaker, message] = lines[scenario.id][step];
  call.transcript.push({ speaker, text: message, timestamp: new Date().toISOString() });
  const done = step === scenario.steps - 1;
  if (done) {
    const action_id = `demo:${call.id}:final`;
    if (scenario.id === 'volunteer') {
      const result = service.run('register_volunteer', { action_id, name: 'Samira Ahmed', phone: '+10000000009', location: 'Central Relief Hub', vehicle: 'Small van', skills: ['supplies'], lat: 12.98, lng: 77.622 }, 'Demo agent');
      call.transcript.push({ speaker: 'tool', text: `register_volunteer → ${result.volunteer.id}`, timestamp: new Date().toISOString() });
      call.summary = 'Consented volunteer registration saved. No delivery assigned.';
    } else {
      const values = scenario.id === 'water' ? { name: 'Leela Rao', location: 'Palm Court', category: 'water', quantity: 36, people: 8, priority: 'high', lat: 12.984, lng: 77.615 } : scenario.id === 'duplicate' ? { name: 'Kiran Rao', location: 'Riverside School', category: 'water', quantity: 48, people: 12, priority: 'high', lat: 12.975, lng: 77.618 } : { name: 'Ravi Kumar', location: 'Southbank House', category: 'transport', quantity: 3, people: 3, priority: 'urgent', lat: 12.957, lng: 77.626 };
      const result = service.run('create_request', { action_id, ...values, caller_confirmed: true, notes: 'Simulated caller report from the interactive demo.' }, 'Demo agent');
      call.requestId = result.request.id;
      call.transcript.push({ speaker: 'tool', text: `create_request → ${result.request.id}${result.duplicateCandidates.length ? ' · duplicate review required' : ''}`, timestamp: new Date().toISOString() });
      call.summary = `Request saved for ${values.people} people. ${result.requiresCoordinator ? 'Coordinator review required.' : 'Awaiting coordination.'}`;
      call.transcript.push({ speaker: 'agent', text: `Your reference is ${result.request.id}. ${call.summary} No assistance has been dispatched.`, timestamp: new Date().toISOString() });
    }
    call.status = 'completed';
  }
  call.nextStep = step + 1;
  s.atomic(() => { s.put('calls', call); s.audit(`Exercise call · ${scenario.name}${done ? ' · completed' : ''}`, call.id, 'Demo simulator'); });
  return { call, done, nextStep: step + 1 };
}
