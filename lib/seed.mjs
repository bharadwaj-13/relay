export function seed(service) {
  const s = service.store;
  if (s.meta('seeded')) return;
  const residents = [
    ['Ananya Rao', 'Riverside School', 'water', 48, 12, 'high', 'Families on the first floor. Main gate accessible on foot.', 12.975, 77.618],
    ['Imran Khan', 'Eastbank Apartments', 'food', 24, 24, 'high', 'Prepared meals needed. Two households with young children.', 12.967, 77.636],
    ['Meera Das', 'Lakeview Community Hall', 'shelter', 8, 8, 'normal', 'Eight adults seeking accessible temporary accommodation.', 12.986, 77.628],
    ['Dev Patel', 'Old Market Road', 'transport', 4, 4, 'urgent', 'Caller reports rising water. Requires immediate human review.', 12.961, 77.61],
    ['Sara Thomas', 'Northside Library', 'water', 30, 10, 'normal', 'Drinking water for temporary gathering point.', 12.995, 77.612],
    ['Arjun Nair', 'Garden Street', 'food', 15, 15, 'normal', 'Afternoon meal request for residents.', 12.981, 77.602]
  ];
  const requests = residents.map(([name, location, category, quantity, people, priority, notes, lat, lng]) => service.run('create_request', { name, phone: '', location, category, quantity, people, priority, notes, lat, lng }).request);
  for (const r of requests.filter(r => !r.urgentReview)) service.run('update_request', { request_id: r.id, verification: 'verified' });
  const volunteers = [
    ['Aisha Malik', '+10000000001', 'Westbank Hub', 'Utility van', 12.975, 77.604, ['supplies', 'transport']],
    ['Rohan Shah', '+10000000002', 'Central Relief Hub', 'Cargo bike', 12.98, 77.622, ['supplies']],
    ['Nadia Ali', '+10000000003', 'Northside Library', 'Car', 12.993, 77.615, ['transport']],
    ['Vikram Sen', '+10000000004', 'Eastbank Hub', 'Pickup truck', 12.97, 77.639, ['supplies', 'transport']]
  ].map(([name, phone, location, vehicle, lat, lng, skills]) => service.run('register_volunteer', { name, phone, location, vehicle, lat, lng, skills }).volunteer);
  const resources = [
    ['Bottled drinking water', 'water', 240, 'litres', 'Central Relief Hub', 'Community Response Team', 12.98, 77.622],
    ['Prepared meal boxes', 'food', 160, 'meals', 'Westbank Kitchen', 'Neighbors Kitchen', 12.976, 77.602],
    ['Temporary shelter places', 'shelter', 32, 'beds', 'Northside Shelter', 'Community Shelter Team', 12.998, 77.62],
    ['Passenger transport', 'transport', 12, 'seats', 'Eastbank Hub', 'Volunteer Fleet', 12.97, 77.639]
  ].map(([name, category, quantity, unit, location, provider, lat, lng]) => service.run('add_resource', { name, category, quantity, unit, location, provider, lat, lng }).resource);
  const a = service.run('propose_assignment', { request_id: requests[1].id, resource_id: resources[1].id, volunteer_id: volunteers[0].id }).assignment;
  service.run('transition_assignment', { assignment_id: a.id, status: 'approved' });
  service.run('transition_assignment', { assignment_id: a.id, status: 'in_progress' });
  const b = service.run('propose_assignment', { request_id: requests[5].id, resource_id: resources[1].id, volunteer_id: volunteers[1].id }).assignment;
  service.run('transition_assignment', { assignment_id: b.id, status: 'approved' });
  service.run('transition_assignment', { assignment_id: b.id, status: 'in_progress' });
  service.run('transition_assignment', { assignment_id: b.id, status: 'awaiting_confirmation' });
  service.run('transition_assignment', { assignment_id: b.id, status: 'delivered', confirmation: 'Demo recipient confirmed all 15 meals received.' });
  const hours = n => new Date(Date.now() + n * 3600000).toISOString();
  service.run('add_advisory', { title: 'Eastbank underpass reported closed', body: 'Illustrative exercise: do not propose the Eastbank underpass as a delivery route. Check access with the coordinator before any assignment.', source: 'Exercise control · simulated report', location: 'Eastbank', severity: 'warning', expiresAt: hours(4) });
  service.run('add_advisory', { title: 'Northside shelter accepting requests', body: 'Illustrative exercise: Northside has accessible spaces. Capacity must be confirmed with the shelter coordinator; this update does not reserve a bed.', source: 'Exercise control · simulated shelter update', location: 'Northside', severity: 'info', expiresAt: hours(8) });
  s.atomic(() => {
    s.put('shelters', { id: 'SHL-NORTH', name: 'Northside Community Shelter', location: 'Northside', capacity: 80, occupied: 48, accessible: true, contact: 'Shelter coordinator', lat: 12.998, lng: 77.62, source: 'Simulated shelter registry', updatedAt: new Date().toISOString() });
    s.put('shelters', { id: 'SHL-WEST', name: 'Westbank Sports Center', location: 'Westbank', capacity: 120, occupied: 94, accessible: true, contact: 'Shelter coordinator', lat: 12.974, lng: 77.599, source: 'Simulated shelter registry', updatedAt: new Date().toISOString() });
    s.meta('seeded', '1');
  });
}
