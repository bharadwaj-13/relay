export async function captureGps() {
  if (!navigator.geolocation) throw new Error('Location capture is unavailable on this device. Enter a landmark instead.');
  if (!window.isSecureContext) throw new Error('Location capture requires HTTPS or localhost. You can still enter a landmark.');
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Location could not be captured. Check permission or enter a landmark manually.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
  return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, locationConsent: true };
}
