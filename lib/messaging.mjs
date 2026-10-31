export async function sendSms(env, phone, message) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) return { status: 'configuration_required' };
  if (env.enqueueSms) return env.enqueueSms(phone,message);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: env.TWILIO_FROM_NUMBER, Body: message }), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.sid ? { status: 'submitted', providerId: data.sid } : { status: 'send_uncertain' };
  } catch { return { status: 'send_uncertain' }; }
}
