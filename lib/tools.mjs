// These schemas describe OUR REST endpoints. Import the generated cURL examples
// in Vaani Training > Tools. Vaani's provider-specific actions shape is not guessed.
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'integer', description, minimum: 1 });
const action = { action_id: str('A unique ID for this confirmed action. Reuse exactly on retries; change it for a different action.') };
export const toolDefinitions = [
  ['request_help', 'Preferred short intake: save the confirmed need AND prepare/send the location SMS in one operation. Collect only name, SMS number, supply, quantity and unit; do NOT ask group size or an address before sending the location link. Ask only for missing essentials. confirmed and consent must be true after one brief readback plus SMS permission. Unknown group size stays unknown. Read the returned say sentence only; never read request_id aloud.', { ...action, call_id:str('Trusted platform call ID if available'),phone:str('Confirmed SMS number when no trusted caller number exists'),name:str('Caller name'),category:{type:'string',enum:['water','food','shelter','transport','medical','other']},quantity:num('Requested amount'),unit:str('Confirmed unit, e.g. litres or meals'),confirmed:{type:'boolean'},consent:{type:'boolean'},people:num('Only if already volunteered; never ask just to fill this field'),location:str('Only if already volunteered; otherwise omit and use SMS location link'),priority:{type:'string',enum:['urgent','high','normal','low']},notes:str('Relevant supplied context only') }, ['action_id','name','category','quantity','unit','confirmed','consent']],
  ['cancel_my_request', 'Cancel the resident own exact request after explicit confirmation. Active deliveries cannot be cancelled here: request a coordinator callback instead. Never claim cancellation on an error.', { call_id: str('Trusted call ID if available'), phone: str('Confirmed callback number'), name: str('Name on the request'), request_id: str('Exact reference'), confirmed: { type: 'boolean' } }, ['name','request_id','confirmed']],
  ['request_coordinator_callback', 'Record a callback request after consent, with the caller name, phone and reason. It is a queue entry, not a connected human or an emergency dispatch. No callback time is guaranteed.', { call_id: str('Trusted call ID if available'), phone: str('Confirmed callback number'), name: str('Caller name'), reason: str('Why the resident needs a coordinator'), consent: { type: 'boolean' } }, ['name','reason','consent']],
  ['get_call_menu', 'At call start, recognize repeat callers using authenticated call metadata where available. Return a short spoken menu. Recognition is not identity verification. If the transport number is absent, ask for the callback number.', { call_id: str('Call/room ID from trusted Vaani metadata, not invented'), phone: str('Caller-confirmed number with country code, if no transport number is available') }, []],
  ['track_my_requests', 'Read a resident request status over the same phone line. Ask the name used on their request. Use trusted call metadata or a confirmed phone number. Read only returned status facts; never invent an ETA.', { call_id: str('Trusted call/room ID if available'), phone: str('Confirmed callback number if needed'), name: str('Name used on the request'), request_id: str('Optional exact reference to select one of several requests') }, ['name']],
  ['send_location_link', 'AFTER consent, text a private GPS-sharing link for the resident own request. Confirm their name and number/reference. Do not claim sent/delivered if status is configuration_required or send_uncertain. A browser permission and landmark confirmation are still required.', { call_id: str('Trusted call ID if available'), phone: str('Confirmed callback number'), name: str('Name used on the request'), request_id: str('Exact request reference'), consent: { type: 'boolean' } }, ['name','request_id','consent']],
  ['confirm_resident_receipt', 'AFTER the resident explicitly confirms receiving the stated supplies, record receipt for their own exact request. A volunteer delivery report alone is not sufficient.', { call_id: str('Trusted call ID if available'), phone: str('Confirmed callback number'), name: str('Name used on the request'), request_id: str('Exact request reference'), confirmed: { type: 'boolean' } }, ['name','request_id','confirmed']],
  ['create_request', 'Record a relief request AFTER reading back the name, location, category, quantity, unit and receiving confirmation. Never claim help dispatched. Duplicate candidates require review.', {
    ...action, caller_confirmed: { type: 'boolean', description: 'True ONLY after the caller explicitly confirms the complete readback. This does not mean coordinator verification.' }, name: str('Caller name'), phone: str('Contact phone, or empty if declined'), location: str('Confirmed address or landmark; never infer coordinates'), category: { type: 'string', enum: ['water','food','shelter','transport','medical','other'] }, quantity: num('Amount requested'), unit: str('Exact unit: litres, meals, beds, seats, or units'), people: num('Number of people'), priority: { type: 'string', enum: ['urgent','high','normal','low'] }, notes: str('Caller-reported context. No invented facts.'), lat: { type: 'number' }, lng: { type: 'number' }
  }, ['action_id','name','location','category','quantity','unit','people','priority']],
  ['find_requests', 'Look up a request by reference. For contact-based lookup the caller must supply their exact name plus contact. Do not reveal other callers or enumerate requests.', { request_id: str('Exact request reference'), name: str('Caller-provided name for contact verification'), phone: str('Caller-provided exact contact for contact verification') }, []],
  ['update_request', 'Correct a caller request AFTER readback and confirmation. Caller must provide exact reference. Assigned destination or quantity changes need coordinator cancellation first.', { ...action, request_id: str('Exact request reference'), name: str('Corrected name'), phone: str('Corrected contact'), location: str('Corrected confirmed location'), quantity: num('Corrected quantity'), people: num('Corrected group size'), notes: str('Updated full notes'), priority: { type: 'string', enum: ['urgent','high','normal','low'] } }, ['action_id','request_id']],
  ['register_volunteer', 'Register a consenting volunteer AFTER confirming their details. This does not approve or assign a delivery.', { ...action, name: str('Volunteer name'), phone: str('Contact number'), location: str('Current area'), vehicle: str('Vehicle and carrying limitations'), skills: { type: 'array', items: { type: 'string' } } }, ['action_id','name','phone','location']],
  ['offer_supplies', 'Record a confirmed supply offer as UNVERIFIED. A coordinator must verify it before it can be matched or promised. Confirm exact quantity, units, pickup location and provider.', { ...action, name: str('Supply description'), category: { type: 'string', enum: ['water','food','shelter','transport','medical','other'] }, quantity: num('Available quantity'), unit: str('Exact unit, for example litres or meals'), location: str('Pickup location'), provider: str('Offering person or organization') }, ['action_id','name','category','quantity','unit','location','provider']],
  ['report_availability', 'A registered volunteer can pause availability when blocked. An active assignment is flagged for coordinator review and retains stock until cancelled. Never claim automatic reassignment.', { ...action, volunteer_id: str('Volunteer reference supplied at registration'), status: { type: 'string', enum: ['available','paused'] }, reason: str('Reason or access blocker') }, ['action_id','volunteer_id','status','reason']],
  ['find_matches', 'Get candidate matches for a request. These are proximity suggestions, not safe routes or dispatch guarantees. No supplies are reserved.', { request_id: str('Exact request reference') }, ['request_id']],
  ['propose_assignment', 'Propose a candidate match. Only a human coordinator can approve it. Never tell a resident a volunteer is dispatched based on this response.', { ...action, request_id: str('Request reference'), resource_id: str('Resource ID from find_matches'), volunteer_id: str('Volunteer ID from find_matches'), notes: str('Access and capacity information to review') }, ['action_id','request_id','resource_id','volunteer_id']],
  ['get_advisories', 'Read current coordinator-reviewed advisories and shelter reports. Say when information was updated. Never infer an evacuation route or medical advice. Expired reports are not usable.', { area: str('Optional area filter') }, []],
  ['report_assignment', 'Record a volunteer progress report, inability to proceed, or claimed delivery. A delivery report only requests confirmation; it never closes the request. Cancellation releases reserved stock.', { ...action, assignment_id: str('Exact assignment reference'), status: { type: 'string', enum: ['in_progress','awaiting_confirmation','cancelled'] }, reason: str('Required for cancellation; explain the blocker') }, ['action_id','assignment_id','status']]
].map(([name, description, properties, required]) => ({ name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }));

const intake=toolDefinitions.find(t=>t.name==='request_help');
intake.description='Short intake: confirm the need, then ask the final delivery address or landmark. Save with location_method=spoken, location, confirmed=true and consent=true. No GPS is inferred and no SMS is sent for spoken intake. Unknown group size stays omitted. Optional SMS link intake requires explicit texting permission. Read only returned say, never IDs.';
intake.parameters.properties.location_method={type:'string',enum:['spoken','sms'],description:'spoken saves the caller-confirmed address/landmark without sending SMS; sms prepares the optional permissioned location link.'};
intake.parameters.properties.location=str('Delivery address or landmark stated and confirmed by the caller at the end of intake. Required with location_method=spoken. Never invent coordinates.');


export function invokeTool(service, name, input) {
  const definition = toolDefinitions.find(t => t.name === name);
  if (!definition) throw Object.assign(new Error('Unknown tool.'), { status: 404 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Expected a JSON object.'), { status: 400 });
  for (const field of definition.parameters.required) if (input[field] === undefined) throw Object.assign(new Error(`Missing ${field}.`), { status: 400 });
  for (const field of Object.keys(input)) if (!Object.hasOwn(definition.parameters.properties, field)) throw Object.assign(new Error(`Unexpected field: ${field}.`), { status: 400 });
  const residentOperations = { request_help:'requestHelp', get_call_menu: 'context', track_my_requests: 'track', send_location_link: 'locationLink', confirm_resident_receipt: 'confirmReceipt', cancel_my_request: 'cancel', request_coordinator_callback: 'callback' };
  if (residentOperations[name]) {
    if (!service.residents) throw Object.assign(new Error('Resident phone services are not configured.'), { status: 503 });
    return service.residents[residentOperations[name]](input);
  }
  if (name === 'find_requests') {
    let requests;
    if (input.request_id) requests = service.findRequests({ request_id: input.request_id });
    else {
      if (!input.name?.trim() || !input.phone?.trim()) throw Object.assign(new Error('Provide a request reference or the exact name and contact number.'), { status: 400 });
      const normalize = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
      requests = service.store.list('requests').filter(r => normalize(r.phone) === normalize(input.phone) && normalize(r.name) === normalize(input.name));
    }
    return { requests: requests.map(({ phone, ...r }) => r) };
  }
  if (name === 'find_matches') {
    const result = service.matches(input.request_id);
    return { ...result, matches: result.matches.map(m => ({ ...m, volunteer: { id: m.volunteer.id, name: m.volunteer.name, vehicle: m.volunteer.vehicle, status: m.volunteer.status, location: m.volunteer.location } })) };
  }
  if (name === 'get_advisories') return {
    advisories: service.store.list('advisories').filter(a => Date.parse(a.expiresAt) > Date.now() && (!input.area || a.location.toLowerCase().includes(String(input.area).toLowerCase()))),
    shelters: service.store.list('shelters').filter(s => !input.area || s.location.toLowerCase().includes(String(input.area).toLowerCase())),
    caution: 'Shelter counts are reports, not reservations. No route safety is implied. Confirm stale availability with a coordinator.'
  };
  const operations = { report_assignment: 'transition_assignment', offer_supplies: 'add_resource', report_availability: 'update_volunteer' };
  return service.run(operations[name] || name, input, 'Vaani agent');
}

// A portable Vaani custom-tool adapter. The operation still goes through the
// same strict individual schema and domain permissions; no coordinator actions
// are added to the agent's surface.
export function invokeVoiceAction(service, input) {
  if (Object.keys(input).some(k => !['operation','arguments_json'].includes(k))) throw Object.assign(new Error('Unexpected gateway field.'), { status: 400 });
  if (typeof input.operation !== 'string' || typeof input.arguments_json !== 'string' || input.arguments_json.length > 128000) throw Object.assign(new Error('Provide operation and arguments_json strings.'), { status: 400 });
  let args;
  try { args = JSON.parse(input.arguments_json); } catch { throw Object.assign(new Error('arguments_json must contain a valid JSON object.'), { status: 400 }); }
  return invokeTool(service, input.operation, args);
}
